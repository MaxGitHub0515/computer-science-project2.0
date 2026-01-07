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

type TeamMemory = NonNullable<Game["aiTeamMemory"]>[string];

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

function addOrReplaceSubmission(sum: AIRoundSummary, submission: Submission) {
  const idx = sum.submissions.findIndex((s) => s.playerId === submission.playerId);
  const entry = { playerId: submission.playerId, content: submission.content };
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

function getHumanSubmissions(game: Game, round: Round): Array<{ alias: string; color: string; content: string }> {
  const out: Array<{ alias: string; color: string; content: string }> = [];
  for (const s of round.submissions) {
    const pl = game.players.find((p) => p.playerId === s.playerId);
    if (!pl || pl.isAI) continue;
    out.push({ alias: pl.alias ?? "unknown", color: pl.colorId ?? "", content: s.content });
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

function getRoundPlan(teamMem: TeamMemory, roundNumber: number): { usedSamples: string[] } {
  const key = String(roundNumber);
  const plans: any = (teamMem as any).roundPlans ?? ((teamMem as any).roundPlans = {});
  plans[key] = plans[key] ?? { usedSamples: [] };
  plans[key].usedSamples = plans[key].usedSamples ?? [];
  return plans[key] as { usedSamples: string[] };
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

export function notifyAIsOfSubmission(
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
      addOrReplaceSubmission(sum, submission);

      const teamId = p.aiData?.teamId;
      if (teamId) {
        const tm = ensureTeamMem(game, teamId);
        const tsum = upsertRoundSummary(tm, round);
        addOrReplaceSubmission(tsum, submission);
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

export function notifyAIsOfElimination(game: Game, round: Round) {
  const eliminated = round.eliminatedPlayerIds ?? [];

  for (const p of game.players) {
    if (!p.isAI) continue;

    const mem = ensureMem(p);
    mem.kickedPlayers = Array.from(new Set([...(mem.kickedPlayers ?? []), ...eliminated]));

    const sum = upsertRoundSummary(mem, round);
    sum.eliminatedPlayerIds = eliminated;
    sum.targetAlias = round.targetAlias;
    sum.submissions = round.submissions.map((s) => ({ playerId: s.playerId, content: s.content }));
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

  const content = await buildAISubmissionContent(game, round, aiPlayer);

  const submission: Submission = {
    submissionId: makeSubmissionId(game.code, aiPlayer.playerId, round.roundNumber),
    playerId: aiPlayer.playerId,
    content,
    roundNumber: round.roundNumber,
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

  const humanSubs = round.submissions.filter((s) => {
    const pl = game.players.find((p) => p.playerId === s.playerId);
    return pl && !pl.isAI;
  });

  const options = (humanSubs.length > 0 ? humanSubs : round.submissions).filter(
    (s) => s.playerId !== aiPlayer.playerId
  );
  if (options.length === 0) return;

  const pick = pickRandom(options);
  const vote: Vote = { voterId: aiPlayer.playerId, submissionId: pick.submissionId };

  if (voteFn) voteFn(game, round, vote);
  else round.votes.push(vote);

  notifyAIsOfVote(game, round, vote);
  ensureMem(aiPlayer).notes.push(`Round ${round.roundNumber}: voted=${pick.submissionId}`);
}

async function buildAISubmissionContent(game: Game, round: Round, aiPlayer: Player): Promise<string> {
  const humans = getHumanSubmissions(game, round);
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
        return fitted;
      }
    }
  }

  if (humanContents.length > 0) {
    const pool = humanContents.filter((c) => !used.has(cleanSingleLine(c)));
    const pick = pickRandom(pool.length > 0 ? pool : humanContents);
    return truncateToLimit(pick, 140);
  }

  return "idk";
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
  visibleHumans: Array<{ alias: string; color: string; content: string }>,
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
      "You are an AI player impostor in a social deduction game, loosely based on 'Among Us' and 'Fibbage'.",
      "Write one short line that blends in with visibleSubmissions.",
      "Match the group's length, casing, punctuation/no-punctuation, slang, spelling style, and vibe.",
      "Do not accuse anyone or reference voting, unless the real player group is doing that style.",
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

  const parsed = JSON.parse(raw) as Partial<ModelOutput>;
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
