// server/game/aiPlayer.ts
import type {
  Game,
  Round,
  Player,
  Submission,
  Vote,
  AIMemory,
  AIRoundSummary,
} from "./gameTypes";

import OpenAI from "openai";
import logger from "../config/loggerWinston";
import type { ToxicityAssessment } from "./gameTypes";

type TeamMemory = NonNullable<Game["aiTeamMemory"]>[string];

const TOXICITY_URL = process.env.TOXICITY_URL?.trim() || "http://toxicity:8080";

const openaiClientCache = new Map<string, OpenAI>();

function normalizeOptString(s: string | undefined): string | undefined {
  const t = s?.trim();
  return t && t.length > 0 ? t : undefined;
}

function pickRandom<T>(arr: readonly T[]): T {
  if (arr.length === 0) throw new Error("pickRandom called with empty array");
  const idx = Math.floor(Math.random() * arr.length);
  return (arr[idx] ?? arr[0]) as T;
}

function makeEmptyMemory(): AIMemory {
  return { kickedPlayers: [], roundsSummary: [], notes: [] };
}

function getOpenAIClient(apiKey?: string): OpenAI | null {
  const key =
    normalizeOptString(apiKey) ??
    normalizeOptString(process.env.OPENAI_API_KEY);

  if (!key) return null;

  let client = openaiClientCache.get(key);
  if (!client) {
    client = new OpenAI({ apiKey: key });
    openaiClientCache.set(key, client);
  }
  return client;
}

function makeSubmissionId(gameCode: string, playerId: string, roundNumber: number) {
  return `ai-${gameCode}-${playerId}-${roundNumber}-${Date.now()}`;
}

function ensureMem(p: Player): AIMemory {
  p.aiData = p.aiData ?? {};
  p.aiData.memory = p.aiData.memory ?? makeEmptyMemory();
  return p.aiData.memory;
}

function ensureTeamMem(game: Game, teamId: string): TeamMemory {
  game.aiTeamMemory = game.aiTeamMemory ?? {};
  game.aiTeamMemory[teamId] =
    game.aiTeamMemory[teamId] ??
    ({
      ...makeEmptyMemory(),
      roundPlans: {},
    } satisfies TeamMemory);

  return game.aiTeamMemory[teamId]!;
}

function upsertRoundSummary(mem: AIMemory, round: Round): AIRoundSummary {
  const existing = mem.roundsSummary.find((r) => r.roundNumber === round.roundNumber);
  if (existing) return existing;

  const created: AIRoundSummary = {
    roundNumber: round.roundNumber,
    targetAlias: round.targetAlias,
    submissions: [],
    votes: [],
    eliminatedPlayerIds: [],
  };
  mem.roundsSummary.push(created);
  return created;
}

function addOrReplaceSubmission(sum: AIRoundSummary, submission: Submission, sanitized = false) {
  const idx = sum.submissions.findIndex((s) => s.playerId === submission.playerId);
  const entry = { playerId: submission.playerId, content: submission.content, sanitized } as const;
  if (idx >= 0) sum.submissions[idx] = entry;
  else sum.submissions.push(entry);
}

function addOrReplaceVote(sum: AIRoundSummary, vote: Vote) {
  const idx = sum.votes.findIndex((v) => v.voterId === vote.voterId);
  if (idx >= 0) sum.votes[idx] = vote;
  else sum.votes.push(vote);
}

function allHumanParticipantsSubmitted(game: Game, round: Round): boolean {
  const humanParticipantIds = (round.participantIds ?? []).filter((pid) => {
    const pl = game.players.find((p) => p.playerId === pid);
    return !!pl && !pl.isAI;
  });
  if (humanParticipantIds.length === 0) return false;
  return humanParticipantIds.every((pid) => round.submissions.some((s) => s.playerId === pid));
}

async function getHumanSubmissionsSanitized(
  game: Game,
  round: Round,
  aiPlayer: Player
): Promise<Array<{ alias: string; color: string; content: string; sanitized: boolean }>> {
  const out: Array<{ alias: string; color: string; content: string; sanitized: boolean }> = [];
  for (const s of round.submissions) {
    const pl = game.players.find((p) => p.playerId === s.playerId);
    if (!pl || pl.isAI) continue;
    const { text: content, sanitized } = await sanitizeContentForAI(game, aiPlayer, s.content);
    if (sanitized) {
      const assessment = getAssessmentFromCaches(game, aiPlayer, s.content);
      logger.debug(
        `Sanitized (generation prompt) for AI ${aiPlayer.alias} round ${round.roundNumber} from ${pl.playerId} :: ${assessment?.summary ?? "toxic"}`
      );
    }
    out.push({ alias: pl.alias ?? "unknown", color: pl.colorId ?? "", content, sanitized });
  }
  return out;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return Math.floor(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
  return sorted[mid] ?? 0;
}

function styleProfile(contents: string[], targetAlias: string) {
  const cleaned = contents.map((s) => (s ?? "").toString());
  const lengths = cleaned.map((s) => s.length);
  const med = median(lengths);
  const minLen = lengths.length ? Math.min(...lengths) : 0;
  const maxLen = lengths.length ? Math.max(...lengths) : 0;

  const punctRe = /[.?!,;:"'()[\]{}]/;
  const emojiRe = /[\u{1F300}-\u{1FAFF}]/u;

  let noPunct = 0;
  let allLower = 0;
  let hasEmoji = 0;
  let mentionsTarget = 0;

  const target = (targetAlias ?? "").trim().toLowerCase();

  for (const s of cleaned) {
    if (!punctRe.test(s)) noPunct += 1;
    if (s === s.toLowerCase()) allLower += 1;
    if (emojiRe.test(s)) hasEmoji += 1;
    if (target && s.toLowerCase().includes(target)) mentionsTarget += 1;
  }

  const n = cleaned.length || 1;

  return {
    count: cleaned.length,
    medianLength: med,
    minLength: minLen,
    maxLength: maxLen,
    noPunctuationRate: noPunct / n,
    allLowercaseRate: allLower / n,
    emojiRate: hasEmoji / n,
    mentionsTargetRate: mentionsTarget / n,
    examples: cleaned.slice(0, 8),
  };
}

function cleanSingleLine(s: string): string {
  return s.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function truncateToLimit(s: string, limit: number): string {
  const t = cleanSingleLine(s);
  if (t.length <= limit) return t;
  const cut = t.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace >= Math.floor(limit * 0.6)) return cut.slice(0, lastSpace).trim();
  return cut.trim();
}

function formatList(items: string[], bullet = "• "): string {
  return items.map((i) => `${bullet}${i}`).join("\n");
}

function logAISubmissionDecision(params: {
  roundNumber: number;
  targetAlias: string;
  aiAlias: string;
  aiColor?: string | undefined;
  teamId?: string | undefined;
  visibleHumans: Array<{ alias: string; color: string; content: string; sanitized: boolean }>;
  teamNotesRecent: string[];
  usedSamplesCount: number;
  output: string;
  usedModel: boolean;
}) {
  const {
    roundNumber,
    targetAlias,
    aiAlias,
    aiColor,
    teamId,
    visibleHumans,
    teamNotesRecent,
    usedSamplesCount,
    output,
    usedModel,
  } = params;

  const humanLines = visibleHumans.slice(0, 6).map((h) => {
    const preview = truncateToLimit(h.content, 80);
    const from = h.alias || h.color || "unknown";
    return `${from}: "${preview}"${h.sanitized ? " (sanitized)" : ""}`;
  });

  const notesLines = teamNotesRecent.slice(-5);

  const lines: string[] = [];
  lines.push(
    `[AI Submission] Round ${roundNumber} — ${aiAlias}${aiColor ? ` (${aiColor})` : ""}${
      teamId ? ` | Team: ${teamId}` : ""
    }`
  );
  lines.push(`Inputs:`);
  lines.push(`- Target: ${targetAlias || "unknown"}`);
  if (humanLines.length > 0) {
    lines.push(`- Visible human inputs (sanitized):`);
    lines.push(formatList(humanLines, "  • "));
  } else {
    lines.push(`- Visible human inputs: none`);
  }
  lines.push(`- Team notes (recent):${notesLines.length ? "" : " none"}`);
  if (notesLines.length) lines.push(formatList(notesLines, "  • "));
  lines.push(`- Used samples this round: ${usedSamplesCount}`);
  lines.push(`Decision:`);
  lines.push(`- Output: "${truncateToLimit(output, 120)}"`);
  lines.push(`- Method: ${usedModel ? "model-guided" : "copy/fit-from-group"}`);

  logger.info(lines.join("\n"));
}

function logAIVoteDecision(params: {
  roundNumber: number;
  aiAlias: string;
  aiColor?: string | undefined;
  teamId?: string | undefined;
  options: Array<{ submissionId: string; alias: string; color: string; isAI: boolean; content: string; sanitized?: boolean }>;
  votesSoFar: Array<{ voterId: string; alias: string; isAI: boolean; submissionId: string }>;
  chosenId: string;
  method: "model" | "team-fallback" | "safety-fallback";
  teamNotesRecent?: string[];
}) {
  const { roundNumber, aiAlias, aiColor, teamId, options, votesSoFar, chosenId, method, teamNotesRecent } = params;

  const optLines = options.slice(0, 8).map((o) => {
    const who = o.alias || o.color || "unknown";
    const preview = truncateToLimit(o.content, 80);
    const san = o.sanitized ? " (sanitized)" : "";
    return `${who}${o.isAI ? " [AI]" : ""}: "${preview}"${san} → id=${o.submissionId}`;
  });

  const chosen = options.find((o) => o.submissionId === chosenId);
  const chosenWho = chosen ? chosen.alias || chosen.color || "unknown" : "unknown";
  const votesCount = votesSoFar.length;
  const humanVotes = votesSoFar.filter((v) => !v.isAI).length;
  const aiVotes = votesCount - humanVotes;

  const lines: string[] = [];
  lines.push(
    `[AI Vote] Round ${roundNumber} — ${aiAlias}${aiColor ? ` (${aiColor})` : ""}${teamId ? ` | Team: ${teamId}` : ""}`
  );
  lines.push(`Inputs:`);
  if (optLines.length > 0) {
    lines.push(`- Options (sanitized):`);
    lines.push(formatList(optLines, "  • "));
  } else {
    lines.push(`- Options: none`);
  }
  const notesLines = (teamNotesRecent ?? []).slice(-5);
  lines.push(`- Team notes (recent):${notesLines.length ? "" : " none"}`);
  if (notesLines.length) lines.push(formatList(notesLines, "  • "));
  lines.push(`- Votes so far: ${votesCount} (humans ${humanVotes}, AIs ${aiVotes})`);
  lines.push(`Decision:`);
  lines.push(`- Chosen: id=${chosenId} by ${chosenWho}`);
  lines.push(`- Method: ${method}`);

  logger.info(lines.join("\n"));
}

// Robustly extract and parse a JSON object from possibly messy model output
function extractFirstJsonObject(text: string): string | null {
  if (!text) return null;
  // Prefer fenced code blocks if present
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence && fence[1]) return fence[1].trim();

  // If the whole text looks like JSON, try it as-is
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;

  // Scan for the first balanced {...} region, ignoring braces inside strings
  let depth = 0;
  let inString = false;
  let escape = false;
  let start = -1;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i] ?? "";
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        return trimmed.slice(start, i + 1).trim();
      }
    }
  }
  return null;
}

function parseJSONFromText<T = unknown>(text: string): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch (_) {
    // ignore and try extraction
  }
  const candidate = extractFirstJsonObject(text);
  if (!candidate) return null;
  try {
    return JSON.parse(candidate) as T;
  } catch (_) {
    return null;
  }
}

function getRoundPlan(teamMem: TeamMemory, roundNumber: number): { usedSamples: string[]; fallbackVoteSubmissionId?: string } {
  const key = String(roundNumber);
  const plans: any = (teamMem as any).roundPlans ?? ((teamMem as any).roundPlans = {});
  plans[key] = plans[key] ?? { usedSamples: [] };
  plans[key].usedSamples = plans[key].usedSamples ?? [];
  return plans[key] as { usedSamples: string[]; fallbackVoteSubmissionId?: string };
}

export function scheduleAIForRound(
  game: Game,
  round: Round,
  submitFn?: (game: Game, round: Round, submission: Submission) => void
) {
  if (!allHumanParticipantsSubmitted(game, round)) return;

  const now = Date.now();
  const expiresAt = round.expiresAt ?? now + 30_000;
  const remaining = Math.max(2000, expiresAt - now);

  for (const p of game.players) {
    if (!p.isAI || !p.alive) continue;
    if (round.submissions.find((s) => s.playerId === p.playerId)) continue;

    const delay = Math.max(500, Math.floor(remaining * (0.15 + Math.random() * 0.25)));
    setTimeout(() => void handleAISubmit(game, round, p, submitFn), delay);
  }
}

export async function notifyAIsOfSubmission(
  game: Game,
  round: Round,
  submission?: Submission,
  submitFn?: (game: Game, round: Round, submission: Submission) => void
) {
  if (submission) {
    for (const p of game.players) {
      if (!p.isAI || !p.alive) continue;

      const mem = ensureMem(p);
      const sum = upsertRoundSummary(mem, round);
      const { text: sanitizedText, sanitized } = await sanitizeContentForAI(game, p, submission.content);
      addOrReplaceSubmission(sum, { ...submission, content: sanitizedText }, sanitized);
      if (sanitized) {
        mem.notes.push(
          `Round ${round.roundNumber}: content from ${submission.playerId} was sanitized and replaced (original hidden)`
        );
        const assessment = getAssessmentFromCaches(game, p, submission.content);
        logger.info(
          `Sanitized swap applied for AI ${p.alias} round ${round.roundNumber} author ${submission.playerId} :: ${assessment?.summary ?? "toxic"}`
        );
      }

      const teamId = p.aiData?.teamId;
      if (teamId) {
        const tm = ensureTeamMem(game, teamId);
        const tsum = upsertRoundSummary(tm, round);
        addOrReplaceSubmission(tsum, { ...submission, content: sanitizedText }, sanitized);
        if (sanitized) {
          tm.notes.push(`Round ${round.roundNumber}: a submission was sanitized for team visibility`);
          const assessment = getAssessmentFromCaches(game, p, submission.content);
          logger.debug(
            `Team memory sanitized (submission) for team ${teamId} round ${round.roundNumber} from ${submission.playerId} :: ${assessment?.summary ?? "toxic"}`
          );
        }
      }
    }
  }

  if (!allHumanParticipantsSubmitted(game, round)) return;

  for (const p of game.players) {
    if (!p.isAI || !p.alive) continue;
    if (round.submissions.find((s) => s.playerId === p.playerId)) continue;
    setTimeout(() => void handleAISubmit(game, round, p, submitFn), 200 + Math.floor(Math.random() * 800));
  }
}

export function scheduleAIVotesForRound(
  game: Game,
  round: Round,
  voteFn?: (game: Game, round: Round, vote: Vote) => void
) {
  const now = Date.now();
  const expiresAt = round.expiresAt ?? now + 30_000;
  const remaining = Math.max(1500, expiresAt - now);

  for (const p of game.players) {
    if (!p.isAI || !p.alive) continue;
    if (round.votes.find((v) => v.voterId === p.playerId)) continue;

    const delay = Math.max(500, Math.floor(remaining * (0.25 + Math.random() * 0.5)));
    setTimeout(() => void handleAIVote(game, round, p, voteFn), delay);
  }

  // SAFETY: last-second coordinated fallback vote if any AIs haven't voted
  const teamId = (game.players.find((pl) => pl.isAI)?.aiData?.teamId) ?? "impostors";
  const tm = ensureTeamMem(game, teamId);
  const plan = getRoundPlan(tm, round.roundNumber);

  // Precompute a fallback target (prefer human submissions; else any)
  if (!plan.fallbackVoteSubmissionId) {
    const humanSubs = round.submissions.filter((s) => {
      const pl = game.players.find((p) => p.playerId === s.playerId);
      return pl && !pl.isAI;
    });
    const pool = humanSubs.length > 0 ? humanSubs : round.submissions;
    const pick = pool.length > 0 ? pickRandom(pool) : undefined;
    if (pick) plan.fallbackVoteSubmissionId = pick.submissionId;
  }

  const safetyDelay = Math.max(0, (expiresAt - Date.now()) - 250);
  setTimeout(() => {
    if (round.status !== "VOTING") return;
    const targetId = plan.fallbackVoteSubmissionId;
    if (!targetId) return;
    const targetSub = round.submissions.find((s) => s.submissionId === targetId);
    const targetAuthor = targetSub
      ? (game.players.find((p) => p.playerId === targetSub.playerId)?.alias ||
         game.players.find((p) => p.playerId === targetSub.playerId)?.colorId ||
         "unknown")
      : "unknown";
    for (const p of game.players) {
      if (!p.isAI || !p.alive) continue;
      if (round.votes.find((v) => v.voterId === p.playerId)) continue;
      const vote: Vote = { voterId: p.playerId, submissionId: targetId };
      if (voteFn) voteFn(game, round, vote);
      else round.votes.push(vote);
      notifyAIsOfVote(game, round, vote);
      ensureMem(p).notes.push(`Round ${round.roundNumber}: fallback vote=${targetId}`);
      try {
        logger.info(
          `[AI Vote] Round ${round.roundNumber} — ${p.alias ?? p.playerId} (${p.colorId ?? ""}) | safety-fallback → id=${targetId} by ${targetAuthor}`
        );
      } catch (_) {
        // ignore
      }
    }
  }, safetyDelay);
}

// Fast-track: when all humans have voted, accelerate remaining AI votes now
export function fastTrackAIVotesForRound(
  game: Game,
  round: Round,
  voteFn?: (game: Game, round: Round, vote: Vote) => void
) {
  if (round.status !== "VOTING") return;
  for (const p of game.players) {
    if (!p.isAI || !p.alive) continue;
    if (round.votes.find((v) => v.voterId === p.playerId)) continue;
    const jitter = 50 + Math.floor(Math.random() * 200);
    setTimeout(() => void handleAIVote(game, round, p, voteFn), jitter);
  }
}

export function notifyAIsOfVote(game: Game, round: Round, vote: Vote) {
  for (const p of game.players) {
    if (!p.isAI || !p.alive) continue;

    const mem = ensureMem(p);
    const sum = upsertRoundSummary(mem, round);
    addOrReplaceVote(sum, vote);

    const teamId = p.aiData?.teamId;
    if (teamId) {
      const tm = ensureTeamMem(game, teamId);
      const tsum = upsertRoundSummary(tm, round);
      addOrReplaceVote(tsum, vote);
    }
  }
}

export async function notifyAIsOfElimination(game: Game, round: Round) {
  const eliminated = round.eliminatedPlayerIds ?? [];

  for (const p of game.players) {
    if (!p.isAI) continue;

    const mem = ensureMem(p);
    mem.kickedPlayers = Array.from(new Set([...(mem.kickedPlayers ?? []), ...eliminated]));

    const sum = upsertRoundSummary(mem, round);
    sum.eliminatedPlayerIds = eliminated;
    sum.targetAlias = round.targetAlias;
    // Store only sanitized versions of submissions in memory
    sum.submissions = [];
    for (const s of round.submissions) {
      const { text: sanitizedText, sanitized } = await sanitizeContentForAI(game, p, s.content);
      sum.submissions.push({ playerId: s.playerId, content: sanitizedText, sanitized });
      if (sanitized) {
        const assessment = getAssessmentFromCaches(game, p, s.content);
        logger.debug(
          `Sanitized (results memory) for AI ${p.alias} round ${round.roundNumber} from ${s.playerId} :: ${assessment?.summary ?? "toxic"}`
        );
      }
    }
    sum.votes = [...round.votes];

    mem.notes.push(`Round ${round.roundNumber}: eliminated=${eliminated.join(",") || "none"}`);

    const teamId = p.aiData?.teamId;
    if (teamId) {
      const tm = ensureTeamMem(game, teamId);
      tm.kickedPlayers = Array.from(new Set([...(tm.kickedPlayers ?? []), ...eliminated]));
      const tsum = upsertRoundSummary(tm, round);
      tsum.eliminatedPlayerIds = eliminated;
      tsum.targetAlias = round.targetAlias;
      tsum.submissions = sum.submissions;
      tsum.votes = sum.votes;
      tm.notes.push(`Round ${round.roundNumber}: eliminated=${eliminated.join(",") || "none"}`);
    }
  }
}

async function handleAISubmit(
  game: Game,
  round: Round,
  aiPlayer: Player,
  submitFn?: (game: Game, round: Round, submission: Submission) => void
) {
  if (round.status !== "SUBMITTING") return;
  if (!aiPlayer.alive) return; // dead AIs must not submit
  if (round.submissions.find((s) => s.playerId === aiPlayer.playerId)) return;
  if (!allHumanParticipantsSubmitted(game, round)) return;

  const submissionResult = await buildAISubmissionContent(game, round, aiPlayer);
  const content = submissionResult.text;

  const submission: Submission = {
    submissionId: makeSubmissionId(game.code, aiPlayer.playerId, round.roundNumber),
    playerId: aiPlayer.playerId,
    content,
    roundNumber: round.roundNumber,
    submittedAt: Date.now(),
  };

  if (submitFn) submitFn(game, round, submission);
  else round.submissions.push(submission);

  const mem = ensureMem(aiPlayer);
  const sum = upsertRoundSummary(mem, round);
  addOrReplaceSubmission(sum, submission);
  mem.notes.push(`Round ${round.roundNumber}: submitted`);

  const teamId = aiPlayer.aiData?.teamId;
  if (teamId) {
    const tm = ensureTeamMem(game, teamId);
    const plan = getRoundPlan(tm, round.roundNumber);
    plan.usedSamples.push(content);
    tm.notes = tm.notes ?? [];
    tm.notes.push(`Round ${round.roundNumber}: ${aiPlayer.alias}: ${content}`);
  }

  try {
    const humans = await getHumanSubmissionsSanitized(game, round, aiPlayer);
    const teamId = aiPlayer.aiData?.teamId;
    const tm = teamId ? ensureTeamMem(game, teamId) : undefined;
    const usedSamplesCount = teamId ? (getRoundPlan(tm!, round.roundNumber).usedSamples?.length ?? 0) : 0;
    const recentNotes = tm?.notes ? tm.notes.slice(-5) : [];
    logAISubmissionDecision({
      roundNumber: round.roundNumber,
      targetAlias: round.targetAlias,
      aiAlias: aiPlayer.alias ?? aiPlayer.playerId,
      aiColor: aiPlayer.colorId,
      teamId,
      visibleHumans: humans,
      teamNotesRecent: recentNotes,
      usedSamplesCount,
      output: content,
      usedModel: !!submissionResult.usedModel,
    });
  } catch (_) {
    // best-effort logging; ignore failures
  }
}

async function handleAIVote(
  game: Game,
  round: Round,
  aiPlayer: Player,
  voteFn?: (game: Game, round: Round, vote: Vote) => void
) {
  if (round.status !== "VOTING") return;
  if (!aiPlayer.alive) return; // dead AIs must not vote
  if (round.votes.find((v) => v.voterId === aiPlayer.playerId)) return;

  // Build full visibility for model: all current submissions with authors and current votes so far
  const visibleSubs = round.submissions.map((s) => {
    const pl = game.players.find((p) => p.playerId === s.playerId);
    return {
      submissionId: s.submissionId,
      playerId: s.playerId,
      alias: pl?.alias ?? "unknown",
      color: pl?.colorId ?? "",
      isAI: !!pl?.isAI,
      content: s.content,
    };
  });

  const votesSoFar = round.votes.map((v) => {
    const voter = game.players.find((p) => p.playerId === v.voterId);
    return { voterId: v.voterId, alias: voter?.alias ?? "unknown", isAI: !!voter?.isAI, submissionId: v.submissionId };
  });

  const teamId = aiPlayer.aiData?.teamId ?? "impostors";
  const teamMem = ensureTeamMem(game, teamId);
  const plan = getRoundPlan(teamMem, round.roundNumber);

  // Prefer human targets if available, excluding self
  const humanSubs = visibleSubs.filter((s) => !s.isAI && s.playerId !== aiPlayer.playerId);
  const optionPool = humanSubs.length > 0 ? humanSubs : visibleSubs;
  const optionIds = optionPool.map((s) => s.submissionId);
  const aliasToSubmissions = new Map<string, Array<{ submissionId: string; isAI: boolean }>>();
  for (const s of optionPool) {
    const key = (s.alias || "").toString();
    const list = aliasToSubmissions.get(key) ?? [];
    list.push({ submissionId: s.submissionId, isAI: s.isAI });
    aliasToSubmissions.set(key, list);
  }
  const allowedAliases = Array.from(aliasToSubmissions.keys());
  if (optionIds.length === 0) return;

  // Try model vote first (when API available)
  let chosen: string | null = null;
  let method: "model" | "team-fallback" = "team-fallback";
  const haveKey = !!normalizeOptString(aiPlayer.aiData?.apiKey) || !!normalizeOptString(process.env.OPENAI_API_KEY);
  if (haveKey) {
    try {
      const prompt = await buildAIVotePrompt(game, round, aiPlayer, visibleSubs, votesSoFar);
      const out = await generateVoteWithModel(aiPlayer.aiData?.apiKey, prompt, allowedAliases);
      if (out?.author_alias) {
        const matches = aliasToSubmissions.get(out.author_alias) ?? [];
        const humanFirst = matches.find((m) => !m.isAI) ?? matches[0];
        if (humanFirst && optionIds.includes(humanFirst.submissionId)) {
          chosen = humanFirst.submissionId; method = "model";
        }
      }
      if (out?.team_note) storeTeamNote(game, aiPlayer, round, out.team_note);
    } catch (e) {
      logger.warn(`AI vote model failed for ${aiPlayer.alias}: ${String(e)}`);
    }
  }

  // Fallback: use team-coordinated target, else random from options
  if (!chosen) {
    if (!plan.fallbackVoteSubmissionId || !optionIds.includes(plan.fallbackVoteSubmissionId)) {
      plan.fallbackVoteSubmissionId = pickRandom(optionIds);
    }
    chosen = plan.fallbackVoteSubmissionId;
  }

  const vote: Vote = { voterId: aiPlayer.playerId, submissionId: chosen };
  if (voteFn) voteFn(game, round, vote);
  else round.votes.push(vote);
  notifyAIsOfVote(game, round, vote);
  ensureMem(aiPlayer).notes.push(`Round ${round.roundNumber}: voted=${chosen}`);

  try {
    const sanitizedOptions: Array<{ submissionId: string; alias: string; color: string; isAI: boolean; content: string; sanitized?: boolean }> = [];
    for (const s of visibleSubs) {
      const { text, sanitized } = await sanitizeContentForAI(game, aiPlayer, s.content);
      sanitizedOptions.push({ ...s, content: text, sanitized });
    }
    const teamIdLog = aiPlayer.aiData?.teamId;
    const tmLog = teamIdLog ? ensureTeamMem(game, teamIdLog) : undefined;
    const recentNotes = tmLog?.notes ? tmLog.notes.slice(-5) : [];
    logAIVoteDecision({
      roundNumber: round.roundNumber,
      aiAlias: aiPlayer.alias ?? aiPlayer.playerId,
      aiColor: aiPlayer.colorId,
      teamId: teamIdLog,
      options: sanitizedOptions,
      votesSoFar,
      chosenId: chosen,
      method,
      teamNotesRecent: recentNotes,
    });
  } catch (_) {
    // best-effort logging
  }
}

async function buildAIVotePrompt(
  game: Game,
  round: Round,
  aiPlayer: Player,
  submissions: Array<{ submissionId: string; playerId: string; alias: string; color: string; isAI: boolean; content: string }>,
  votesSoFar: Array<{ voterId: string; alias: string; isAI: boolean; submissionId: string }>
) {
  const mem = ensureMem(aiPlayer);
  const recentRounds = mem.roundsSummary
    .filter((r) => r.roundNumber < round.roundNumber)
    .slice(-6);

  // Sanitize any user-provided content before including in the model prompt
  const sanitizedSubs: Array<{
    submissionId: string;
    playerId: string;
    alias: string;
    color: string;
    isAI: boolean;
    content: string;
    sanitized: boolean;
  }> = [];
  for (const s of submissions) {
    const { text, sanitized } = await sanitizeContentForAI(game, aiPlayer, s.content);
    sanitizedSubs.push({ ...s, content: text, sanitized });
    if (sanitized) {
      const assessment = getAssessmentFromCaches(game, aiPlayer, s.content);
      logger.debug(
        `Sanitized (voting prompt) for AI ${aiPlayer.alias} round ${round.roundNumber} from ${s.playerId} :: ${assessment?.summary ?? "toxic"}`
      );
    }
  }

  const teamId = aiPlayer.aiData?.teamId ?? "impostors";
  const teamMem = ensureTeamMem(game, teamId);

  const body: Record<string, unknown> = {
    mode: "voting",
    roundNumber: round.roundNumber,
    targetAlias: round.targetAlias,
    recentRounds,
    currentSubmissions: sanitizedSubs,
    currentVotes: votesSoFar,
    myAlias: aiPlayer.alias,
    myColor: aiPlayer.colorId,
    teamMemory: {
      notes: (teamMem.notes ?? []).slice(-20),
    },
    instruction: "Pick author_alias exactly from currentSubmissions[].alias; return author_alias + team_note only.",
  };
  return JSON.stringify(body);
}

type VoteModelOutput = { author_alias: string; team_note: string };

async function generateVoteWithModel(
  apiKey: string | undefined,
  prompt: string,
  allowedAliases: string[]
): Promise<VoteModelOutput | null> {
  const client = getOpenAIClient(apiKey);
  if (!client) return null;

  const model = process.env.OPENAI_MODEL ?? "gpt-5.2";

  const instructions =
    process.env.OPENAI_GAME_VOTE_INSTRUCTIONS ??
    [
      "You are an AI player impostor in a social deduction game, loosely based on 'Among Us' and 'Fibbage'. Real players can only see Colors, not aliases.",
      "Choose exactly one submission to vote for from currentSubmissions; that player will be eliminated.",
      "Consider author info (alias, color, isAI), teamMemory.notes, and the currentVotes so far.",
      'Return JSON only: {"author_alias":"<alias>","team_note":"..."}.',
      "Choose the exact alias string from currentSubmissions[].alias.",
      "Include a brief team_note to guide teammates.",
    ].join(" ");

  const schema = {
    type: "object",
    properties: {
      author_alias: { type: "string", enum: allowedAliases.length ? allowedAliases : undefined },
      team_note: { type: "string" },
    },
    required: ["author_alias", "team_note"],
    additionalProperties: false,
  } as const;

  const response = await client.responses.create({
    model,
    instructions,
    input: prompt,
    reasoning: { effort: "none" },
    text: {
      verbosity: "low",
      format: { type: "json_schema", name: "round_vote", strict: true, schema },
    },
    temperature: 0.3,
    max_output_tokens: 40,
    store: false,
  } as any);

  const raw = cleanSingleLine((response.output_text ?? "").trim());
  if (!raw) return null;
  const parsed = parseJSONFromText<Partial<VoteModelOutput>>(raw);
  if (!parsed) return null;
  if (!parsed.author_alias) return null;
  if (allowedAliases.length && !allowedAliases.includes(parsed.author_alias)) return null;
  if (!parsed.team_note) return null;
  return { author_alias: parsed.author_alias, team_note: parsed.team_note };
}

async function buildAISubmissionContent(game: Game, round: Round, aiPlayer: Player): Promise<{ text: string; usedModel: boolean }> {
  const humans = await getHumanSubmissionsSanitized(game, round, aiPlayer);
  const humanContents = humans.map((h) => h.content);

  const teamId = aiPlayer.aiData?.teamId ?? "impostors";
  const teamMem = ensureTeamMem(game, teamId);
  const plan = getRoundPlan(teamMem, round.roundNumber);
  const used = new Set((plan.usedSamples ?? []).map((s) => cleanSingleLine(s)));

  const haveKey =
    !!normalizeOptString(aiPlayer.aiData?.apiKey) ||
    !!normalizeOptString(process.env.OPENAI_API_KEY);

  if (haveKey && humans.length > 0) {
    const prompt = buildPromptForModel(game, round, aiPlayer, humans, used);

    const targetChars = median(humanContents.map((s) => cleanSingleLine(s).length));
    const lengthWindow = 15;

    const generated = await generateWithModel(aiPlayer.aiData?.apiKey, prompt, targetChars, lengthWindow);

    if (generated?.submission) {
      const sub = truncateToLimit(generated.submission, 140);

      const minLen = Math.max(1, targetChars - lengthWindow);
      const maxLen = Math.min(140, targetChars + lengthWindow);
      const fitted = sub.length > maxLen ? truncateToLimit(sub, maxLen) : sub;

      if (generated.team_note) storeTeamNote(game, aiPlayer, round, generated.team_note);

      if (!used.has(cleanSingleLine(fitted)) && fitted.length >= minLen) {
        return { text: fitted, usedModel: true };
      }
    }
  }

  if (humanContents.length > 0) {
    const pool = humanContents.filter((c) => !used.has(cleanSingleLine(c)));
    const pick = pickRandom(pool.length > 0 ? pool : humanContents);
    return { text: truncateToLimit(pick, 140), usedModel: false };
  }

  return { text: "idk", usedModel: false };
}

function fitToGroupEnvelope(s: string, prof: ReturnType<typeof styleProfile>): string {
  const t = truncateToLimit(s, 140);
  const target = prof.medianLength > 0 ? prof.medianLength : 40;
  const upper = Math.min(140, target + 15);

  if (t.length <= upper) return t;
  return truncateToLimit(t, upper);
}

function storeTeamNote(game: Game, aiPlayer: Player, round: Round, note: string) {
  const teamId = aiPlayer.aiData?.teamId ?? "impostors";
  const tm = ensureTeamMem(game, teamId);
  const clean = truncateToLimit(note, 80);
  if (!clean) return;
  tm.notes = tm.notes ?? [];
  tm.notes.push(`Round ${round.roundNumber}: ${clean}`);
}

function buildPromptForModel(
  game: Game,
  round: Round,
  aiPlayer: Player,
  visibleHumans: Array<{ alias: string; color: string; content: string; sanitized: boolean }>,
  usedThisRound: Set<string>
) {
  const mem = ensureMem(aiPlayer);

  const recentRounds = mem.roundsSummary
    .filter((r) => r.roundNumber < round.roundNumber)
    .slice(-4)
    .map((r) => ({
      roundNumber: r.roundNumber,
      targetAlias: r.targetAlias,
      submissions: r.submissions.map((s) => {
        const pl = game.players.find((p) => p.playerId === s.playerId);
        return { alias: pl?.alias ?? "unknown", color: pl?.colorId ?? "", content: s.content };
      }),
      votes: r.votes,
      eliminated: r.eliminatedPlayerIds,
    }));

  const prof = styleProfile(visibleHumans.map((v) => v.content), round.targetAlias);

  const teamId = aiPlayer.aiData?.teamId ?? "impostors";
  const teamMem = ensureTeamMem(game, teamId);

  const body: Record<string, unknown> = {
    mode: "submission",
    roundNumber: round.roundNumber,
    targetAlias: round.targetAlias,
    styleProfile: prof,
    recentRounds,
    teamMemory: {
      notes: (teamMem.notes ?? []).slice(-20),
      usedThisRound: Array.from(usedThisRound).slice(-20),
    },
    visibleSubmissions: visibleHumans,
  };

  return JSON.stringify(body);
}

type ModelOutput = { submission: string; team_note: string };

async function generateWithModel(
  apiKey: string | undefined,
  prompt: string,
  targetChars: number,
  lengthWindow: number
): Promise<ModelOutput | null> {
  const client = getOpenAIClient(apiKey);
  if (!client) return null;

  const model = process.env.OPENAI_MODEL ?? "gpt-5.2";

  // Rough heuristic: ~3 chars/token in short slangy text + JSON overhead
  // Keep it tight so it doesn't ramble.
  const maxTokens = Math.max(
    60,
    Math.min(140, Math.ceil((targetChars + 40) / 3))
  );

  const instructions =
    process.env.OPENAI_GAME_INSTRUCTIONS ??
    [
      "You are an AI player impostor in a social deduction game, loosely based on 'Among Us' and 'Fibbage'. Real players can only see Colors, not aliases.",
      "Write one short line that blends in with visibleSubmissions.",
      "Match the group's length, casing, punctuation/no-punctuation, slang, spelling style, and vibe.",
      "You may subtly reference previous behavior using player colors if it fits the style.",
      `Target length: ${targetChars} chars (acceptable ${targetChars - lengthWindow}..${targetChars + lengthWindow}).`,
      'Return JSON only: {"submission":"...","team_note":"..."}',
      "Both must be single-line strings with no newline characters.",
    ].join(" ");

  const requestPayload = {
  model,
  instructions,
  input: prompt,

  reasoning: { effort: "none" },
  text: {
    verbosity: "low",
    format: {
      type: "json_schema",
      name: "round_submission",
      strict: true,
      schema: {
        type: "object",
        properties: {
          submission: { type: "string" },
          team_note: { type: "string" },
        },
        required: ["submission", "team_note"],
        additionalProperties: false,
      },
    },
  },

  temperature: 0.9,
  max_output_tokens: maxTokens,
  store: false,
} as const;

  const response = await client.responses.create(requestPayload as any);
  const raw = cleanSingleLine((response.output_text ?? "").trim());
  if (!raw) return null;

  const parsed = parseJSONFromText<Partial<ModelOutput>>(raw);
  if (!parsed) return null;
  const submission = truncateToLimit(parsed.submission ?? "", 140);
  const team_note = truncateToLimit(parsed.team_note ?? "", 80);
  if (!submission) return null;

  return { submission, team_note };
}

export default {
  scheduleAIForRound,
  scheduleAIVotesForRound,
  notifyAIsOfSubmission,
  notifyAIsOfVote,
  notifyAIsOfElimination,
};

// ===== Toxicity filtering & caching =====

function ensureToxicityCache(mem: AIMemory): Record<string, ToxicityAssessment> {
  if (!mem.toxicityCache) mem.toxicityCache = {};
  return mem.toxicityCache;
}

function pickTopCategories(scores: Record<string, number>, threshold = 0.5, maxCats = 3): string[] {
  const entries = Object.entries(scores)
    .filter(([k]) => k !== "non_toxic")
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .filter(([_, v]) => (v ?? 0) >= threshold)
    .slice(0, maxCats)
    .map(([k, v]) => `${k} ${(v ?? 0).toFixed(2)}`);
  return entries;
}

async function callToxicityService(text: string): Promise<{ is_toxic: boolean; detailed_scores?: Record<string, number> } | null> {
  try {
    const res = await fetch(`${TOXICITY_URL}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    } as any);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as any;
    return { is_toxic: !!data.is_toxic, detailed_scores: data.detailed_scores ?? {} };
  } catch (e) {
    logger.warn(`Toxicity service error: ${String(e)}`);
    return null;
  }
}

function buildReplacement(scores?: Record<string, number>, reason?: string): { replacedText: string; summary?: string } {
  const cats = scores ? pickTopCategories(scores) : [];
  const summary = cats.length > 0 ? cats.join(", ") : (reason || "content hidden");
  const replacedText = `(content replaced due to toxicity: ${summary})`;
  return { replacedText, summary };
}

async function assessAndCache(mem: AIMemory, original: string): Promise<ToxicityAssessment> {
  const cache = ensureToxicityCache(mem);
  const key = original;
  if (cache[key]) return cache[key];

  const resp = await callToxicityService(original);
  if (!resp) {
    const { replacedText, summary } = buildReplacement(undefined, "toxicity model unavailable");
    const assessment: ToxicityAssessment = {
      isToxic: true,
      scores: {},
      replacedText,
      ...(summary ? { summary } : {}),
    } as ToxicityAssessment;
    cache[key] = assessment;
    return assessment;
  }

  if (resp.is_toxic) {
    const { replacedText, summary } = buildReplacement(resp.detailed_scores);
    const assessment: ToxicityAssessment = {
      isToxic: true,
      scores: resp.detailed_scores ?? {},
      replacedText,
      ...(summary ? { summary } : {}),
    } as ToxicityAssessment;
    cache[key] = assessment;
    return assessment;
  } else {
    const assessment: ToxicityAssessment = { isToxic: false, scores: resp.detailed_scores ?? {}, replacedText: original };
    cache[key] = assessment;
    return assessment;
  }
}

async function sanitizeContentForAI(
  game: Game,
  aiPlayer: Player,
  original: string
): Promise<{ text: string; sanitized: boolean }> {
  // Prefer team-level cache to maximize reuse across AIs
  const teamId = aiPlayer.aiData?.teamId ?? "impostors";
  const tm = ensureTeamMem(game, teamId);
  // ensure both caches exist
  ensureToxicityCache(tm);
  const mem = ensureMem(aiPlayer);
  ensureToxicityCache(mem);

  // Try team cache first
  const teamCache = tm.toxicityCache!;
  const existing = teamCache[original];
  if (existing) {
    // Mirror into personal cache too
    mem.toxicityCache![original] = existing;
    return { text: existing.isToxic ? existing.replacedText : original, sanitized: existing.isToxic };
  }

  // Not cached: assess and store in both
  const assessment = await assessAndCache(tm, original);
  mem.toxicityCache![original] = assessment;
  return { text: assessment.isToxic ? assessment.replacedText : original, sanitized: assessment.isToxic };
}

function getAssessmentFromCaches(game: Game, aiPlayer: Player, original: string): ToxicityAssessment | null {
  const teamId = aiPlayer.aiData?.teamId ?? "impostors";
  const tm = ensureTeamMem(game, teamId);
  const mem = ensureMem(aiPlayer);
  const a = tm.toxicityCache?.[original] || mem.toxicityCache?.[original] || null;
  return a ?? null;
}
