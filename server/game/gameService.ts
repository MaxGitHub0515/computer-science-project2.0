import type { Game, Round, Submission, Vote } from "./gameTypes";
import { randomUUID } from "crypto";
import {
  scheduleAIForRound,
  scheduleAIVotesForRound,
  fastTrackAIVotesForRound,
  notifyAIsOfSubmission,
  notifyAIsOfElimination,
} from "./aiPlayer";

let emitGameUpdateCallback: ((game: Game) => void) | null = null;

export function setEmitGameUpdateCallback(callback: (game: Game) => void) {
  emitGameUpdateCallback = callback;
}

function pickRandom<T>(arr: readonly T[]): T {
  if (arr.length === 0) throw new Error("pickRandom called with empty array");
  const idx = Math.floor(Math.random() * arr.length);
  return (arr[idx] ?? arr[0]) as T;
}

function generateRoundPrompt(targetAlias: string): string {
  const t = targetAlias || "the target";
  const templates = [
    `Name one thing ${t} hates.`,
    `Name what you like about ${t}.`,
    `What would ${t} say on a bad day?`,
    `What does ${t} always forget?`,
    `Write a short sentence about ${t}.`,
  ];
  return pickRandom(templates);
}

function allSubmissionsIn(round: Round): boolean {
  const uniqueSubmitters = new Set(round.submissions.map((s) => s.playerId));
  return uniqueSubmitters.size >= round.participantIds.length;
}

function allVotesIn(round: Round): boolean {
  const uniqueVoters = new Set(round.votes.map((v) => v.voterId));
  return uniqueVoters.size >= round.participantIds.length;
}

function allHumanVotesIn(game: Game, round: Round): boolean {
  const humanIds = (round.participantIds ?? []).filter((pid) => {
    const pl = game.players.find((p) => p.playerId === pid);
    return !!pl && !pl.isAI;
  });
  if (humanIds.length === 0) return false;
  const voted = new Set(round.votes.map((v) => v.voterId));
  return humanIds.every((pid) => voted.has(pid));
}

const DEFAULT_SUBMIT_DURATION_MS = process.env.SUBMIT_DURATION_MS
  ? parseInt(process.env.SUBMIT_DURATION_MS, 10)
  : 240_000;
const DEFAULT_VOTE_DURATION_MS = process.env.VOTE_DURATION_MS
  ? parseInt(process.env.VOTE_DURATION_MS, 10)
  : 240_000;

type GameTimers = { submit?: NodeJS.Timeout; vote?: NodeJS.Timeout; results?: NodeJS.Timeout };
const timers = new Map<string, GameTimers>();

function clearTimersForGame(code: string) {
  const t = timers.get(code);
  if (!t) return;
  if (t.submit) clearTimeout(t.submit);
  if (t.vote) clearTimeout(t.vote);
  if (t.results) clearTimeout(t.results);
  timers.delete(code);
}

function scheduleSubmitTimer(game: Game, round: Round, durationMs = DEFAULT_SUBMIT_DURATION_MS) {
  clearTimersForGame(game.code);
  round.expiresAt = Date.now() + durationMs;
  const submitTimer = setTimeout(() => handleSubmitTimeout(game, round), durationMs);
  timers.set(game.code, { submit: submitTimer });
  if (emitGameUpdateCallback) emitGameUpdateCallback(game);
}

function scheduleVoteTimer(game: Game, round: Round, durationMs = DEFAULT_VOTE_DURATION_MS) {
  round.expiresAt = Date.now() + durationMs;
  const voteTimer = setTimeout(() => handleVoteTimeout(game, round), durationMs);
  const cur = timers.get(game.code) ?? {};
  cur.vote = voteTimer;
  timers.set(game.code, cur);
  if (emitGameUpdateCallback) emitGameUpdateCallback(game);
}

function scheduleResultsAdvance(game: Game, delayMs = 3000) {
  const cur = timers.get(game.code) ?? {};
  cur.results = setTimeout(() => advanceAfterResults(game), delayMs);
  timers.set(game.code, cur);
}

function enterVotingPhase(game: Game, round: Round) {
  round.status = "VOTING";
  game.state = "ROUND_VOTING";

  // Ensure every participant has a submission entry (empty string if they didn't submit).
  // This allows players who didn't submit to be voted on and potentially eliminated.
  for (const pid of round.participantIds ?? []) {
    if (!round.submissions.find((s) => s.playerId === pid)) {
      const placeholder: Submission = {
        submissionId: `missing-${game.code ?? "unknown"}-${pid}-${round.roundNumber ?? 0}-${randomUUID()}`,
        playerId: pid,
        content: "",
        roundNumber: round.roundNumber ?? 0,
      };
      round.submissions.push(placeholder);
    }
  }

  scheduleVoteTimer(game, round);

  try {
    const voteFn = (g: Game, r: Round, vote: Vote) => {
      if (r.status !== "VOTING") return;
      if (!r.participantIds.includes(vote.voterId)) return;
      if (r.votes.some((v) => v.voterId === vote.voterId)) return; // enforce 1 vote per voter
      if (!r.submissions.some((s) => s.submissionId === vote.submissionId)) return;
      r.votes.push(vote);
      onVotesUpdated(g, r);
      if (emitGameUpdateCallback) emitGameUpdateCallback(g);
    };
    scheduleAIVotesForRound(game, round, voteFn);
  } catch {}

  if (emitGameUpdateCallback) emitGameUpdateCallback(game);
}

function handleSubmitTimeout(game: Game, round: Round) {
  if (round.status !== "SUBMITTING") return;

  clearTimersForGame(game.code);
  enterVotingPhase(game, round);
}

function handleVoteTimeout(game: Game, round: Round) {
  if (round.status !== "VOTING") return;
  finalizeVoting(game, round);
}

function finalizeVoting(game: Game, round: Round) {
  if (round.status === "COMPLETED") return;

  round.status = "COMPLETED";

  // === SCORING LOGIC ===
  const PARTITICATION_POINTS = 10;
  const FAST_BONUSES = [5, 3, 1]; // 1st, 2nd, 3rd place
  const NO_SUBMISSION_PENALTY = 5;

  // Get all non-empty submissions sorted by submittedAt for fast bonus calculation
  const submissionsWithTime = round.submissions
    .filter((s) => s.submittedAt != null && s.content.trim().length > 0)
    .sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0));

  // Award fast bonuses to top 3 fastest non-empty submissions
  for (let i = 0; i < Math.min(FAST_BONUSES.length, submissionsWithTime.length); i++) {
    const submission = submissionsWithTime[i];
    const bonus = FAST_BONUSES[i];
    if (!submission || bonus === undefined) continue;
    const player = game.players.find((p) => p.playerId === submission.playerId);
    if (player && submission.content.trim().length > 0) {
      player.score = (player.score ?? 0) + bonus;
    }
  }

  // Process all submissions for participation points and missed submission tracking
  for (const submission of round.submissions) {
    const player = game.players.find((p) => p.playerId === submission.playerId);
    if (!player) continue;

    // Track missed submissions
    if (submission.content.trim().length === 0) {
      // Empty submission - increment missed submissions counter
      player.missedSubmissions = (player.missedSubmissions ?? 0) + 1;
      // Apply penalty for no submission
      player.score = (player.score ?? 0) - NO_SUBMISSION_PENALTY;
    } else {
      // Non-empty submission - award participation points and reset missed counter
      player.score = (player.score ?? 0) + PARTITICATION_POINTS;
      player.missedSubmissions = 0;
    }
  }

  // Check for players to eliminate due to 2+ consecutive missed submissions
  for (const player of game.players) {
    if (player.alive && (player.missedSubmissions ?? 0) >= 2) {
      player.alive = false;
      round.eliminatedPlayerIds = round.eliminatedPlayerIds ?? [];
      if (!round.eliminatedPlayerIds.includes(player.playerId)) {
        round.eliminatedPlayerIds.push(player.playerId);
      }
    }
  }
  // === END SCORING LOGIC ===

  const tally = new Map<string, number>();
  for (const v of round.votes) tally.set(v.submissionId, (tally.get(v.submissionId) ?? 0) + 1);

  let maxVotes = 0;
  let eliminatedSubmissionIds: string[] = [];

  for (const [submissionId, count] of tally.entries()) {
    if (count > maxVotes) {
      maxVotes = count;
      eliminatedSubmissionIds = [submissionId];
    } else if (count === maxVotes && maxVotes > 0) {
      eliminatedSubmissionIds.push(submissionId);
    }
  }

  // If there is a multi-way tie for the highest votes, do NOT eliminate anyone — skip elimination for this round.
  if (eliminatedSubmissionIds.length > 1) {
    eliminatedSubmissionIds = [];
  }

  const eliminatedPlayerIds: string[] = [...(round.eliminatedPlayerIds ?? [])];
  for (const submissionId of eliminatedSubmissionIds) {
    const submission = round.submissions.find((s) => s.submissionId === submissionId);
    if (!submission) continue;

    const player = game.players.find((p) => p.playerId === submission.playerId);
    if (player && player.alive) {
      player.alive = false;
      if (!eliminatedPlayerIds.includes(player.playerId)) {
        eliminatedPlayerIds.push(player.playerId);
      }
    }
  }

  round.eliminatedPlayerIds = eliminatedPlayerIds;

  try {
    notifyAIsOfElimination(game, round);
  } catch {}

  game.state = "ROUND_RESULTS";

  clearTimersForGame(game.code);
  scheduleResultsAdvance(game, 3000);

  if (emitGameUpdateCallback) emitGameUpdateCallback(game);
}

export function onSubmissionUpdated(game: Game, round: Round, submission?: Submission) {
  if (!submission) return;

  try {
    const submitFn = (g: Game, r: Round, sub: Submission) => {
      if (r.status !== "SUBMITTING") return;
      if (!r.participantIds.includes(sub.playerId)) return;
      if (r.submissions.some((s) => s.playerId === sub.playerId)) return; // enforce 1 submission per player
      r.submissions.push(sub);
      onSubmissionUpdated(g, r, sub);
      if (emitGameUpdateCallback) emitGameUpdateCallback(g);
    };
    notifyAIsOfSubmission(game, round, submission, submitFn);
  } catch {}

  if (!allSubmissionsIn(round)) return;

  clearTimersForGame(game.code);
  enterVotingPhase(game, round);
}

export function onVotesUpdated(game: Game, round: Round) {
  // If all humans have voted but some AIs haven't, fast-track AI votes now
  if (!allVotesIn(round) && allHumanVotesIn(game, round)) {
    const voteFn = (g: Game, r: Round, vote: Vote) => {
      if (r.status !== "VOTING") return;
      if (!r.participantIds.includes(vote.voterId)) return;
      if (r.votes.some((v) => v.voterId === vote.voterId)) return; // enforce 1 vote per voter
      if (!r.submissions.some((s) => s.submissionId === vote.submissionId)) return;
      r.votes.push(vote);
      onVotesUpdated(g, r);
      if (emitGameUpdateCallback) emitGameUpdateCallback(g);
    };
    try {
      fastTrackAIVotesForRound(game, round, voteFn);
    } catch {}
  }

  if (!allVotesIn(round)) return;

  const t = timers.get(game.code);
  if (t?.vote) {
    clearTimeout(t.vote);
    delete t.vote; // exactOptionalPropertyTypes-safe
    timers.set(game.code, t);
  }

  finalizeVoting(game, round);
}

function advanceAfterResults(game: Game) {
  const aliveHumans = game.players.filter((p) => p.alive && !p.isAI).length;
  const aliveAIs = game.players.filter((p) => p.alive && p.isAI).length;

  // Special-case: if it's a 1 vs 1 (one AI alive and one human alive), the AI automatically wins.
  if (aliveAIs === 1 && aliveHumans === 1) {
    game.winner = "AIS";
    game.state = "GAME_OVER";
    clearTimersForGame(game.code);
    if (emitGameUpdateCallback) emitGameUpdateCallback(game);
    return;
  }

  // Team-based win conditions
  if (aliveHumans === 0) {
    game.winner = "AIS";
    game.state = "GAME_OVER";
    clearTimersForGame(game.code);
    if (emitGameUpdateCallback) emitGameUpdateCallback(game);
    return;
  }

  if (aliveAIs === 0) {
    game.winner = "HUMANS";
    game.state = "GAME_OVER";
    clearTimersForGame(game.code);
    if (emitGameUpdateCallback) emitGameUpdateCallback(game);
    return;
  }

  // If AIs outnumber humans at any point, they can coordinate to always outvote.
  // End the game early and award an AI win.
  if (aliveAIs > aliveHumans) {
    game.winner = "AIS";
    game.state = "GAME_OVER";
    clearTimersForGame(game.code);
    if (emitGameUpdateCallback) emitGameUpdateCallback(game);
    return;
  }

  const nextRound = startRoundForGame(game, "TEXT");
  if (!nextRound) {
    game.state = "GAME_OVER";
    clearTimersForGame(game.code);
  }

  if (emitGameUpdateCallback) emitGameUpdateCallback(game);
}

export function startRoundForGame(game: Game, roundType: "TEXT" | "IMAGE" = "TEXT"): Round | null {
  const alivePlayers = game.players.filter((p) => p.alive);
  if (game.players.length === 0) return null;

  const humanPlayers = game.players.filter((p) => !p.isAI);
  const targetPool = humanPlayers.length > 0 ? humanPlayers : game.players;

  const nextRoundNumber = game.roundNumber + 1;

  // Avoid picking the same target alias twice in a row.
  const prevTargetAlias = game.rounds?.[game.rounds.length - 1]?.targetAlias;
  const filteredPool = prevTargetAlias ? targetPool.filter((p) => p.alias !== prevTargetAlias) : targetPool;
  const finalPool = filteredPool.length > 0 ? filteredPool : targetPool;
  const targetPlayer = pickRandom(finalPool);

  const round: Round = {
    roundNumber: nextRoundNumber,
    roundType,
    targetAlias: targetPlayer.alias ?? "Unknown",
    roundPrompt: generateRoundPrompt(targetPlayer.alias ?? "Unknown"),
    status: "SUBMITTING",
    submissions: [],
    votes: [],
    participantIds: alivePlayers.map((p) => p.playerId),
    eliminatedPlayerIds: [],
  };

  game.roundNumber = nextRoundNumber;
  game.rounds.push(round);
  game.state = "ROUND_SUBMITTING";

  scheduleSubmitTimer(game, round);

  try {
    const submitFn = (g: Game, r: Round, sub: Submission) => {
      if (r.status !== "SUBMITTING") return;
      if (!r.participantIds.includes(sub.playerId)) return;
      if (r.submissions.some((s) => s.playerId === sub.playerId)) return; // enforce 1 submission per player
      r.submissions.push(sub);
      onSubmissionUpdated(g, r, sub);
      if (emitGameUpdateCallback) emitGameUpdateCallback(g);
    };
    scheduleAIForRound(game, round, submitFn);
  } catch {}

  return round;
}
