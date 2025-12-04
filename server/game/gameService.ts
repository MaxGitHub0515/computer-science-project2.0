// server/game/gameService.ts
import type { Game, Round } from "./gameTypes";

// We'll need to import the socket.io instance to emit updates after the timer
// This will be set from socket.ts
let emitGameUpdateCallback: ((game: Game) => void) | null = null;

export function setEmitGameUpdateCallback(callback: (game: Game) => void) {
  emitGameUpdateCallback = callback;
}

function allSubmissionsIn(round: Round): boolean {
  return round.submissions.length >= round.participantIds.length;
}

function allVotesIn(round: Round): boolean {
  return round.votes.length >= round.participantIds.length;
}

/**
 * Called after a submission is added.
 * If all participants have submitted, move the game to VOTING.
 */
export function onSubmissionUpdated(game: Game, round: Round) {
  if (!allSubmissionsIn(round)) return;

  round.status = "VOTING";
  game.state = "ROUND_VOTING";
}

/**
 * Called after a vote is added.
 * When all participants have voted:
 *  - tally votes
 *  - eliminate the player with the most votes
 *  - set ROUND_RESULTS and schedule auto-advance
 */
export function onVotesUpdated(game: Game, round: Round) {
  if (!allVotesIn(round)) return;

  // Mark round as completed
  round.status = "COMPLETED";

  // Tally votes by submissionId
  const tally = new Map<string, number>();
  for (const v of round.votes) {
    tally.set(v.submissionId, (tally.get(v.submissionId) ?? 0) + 1);
  }

  // Find submission(s) with most votes (handle ties)
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

  // Eliminate player(s) with most votes
  const eliminatedPlayerIds: string[] = [];
  for (const submissionId of eliminatedSubmissionIds) {
    const submission = round.submissions.find(
      (s) => s.submissionId === submissionId
    );
    if (submission) {
      const player = game.players.find((p) => p.playerId === submission.playerId);
      if (player && player.alive) {
        player.alive = false;
        eliminatedPlayerIds.push(player.playerId);
      }
    }
  }

  // Store eliminated player IDs on the round for display
  round.eliminatedPlayerIds = eliminatedPlayerIds;

  // Move to RESULTS state to show elimination screen
  game.state = "ROUND_RESULTS";

  // Schedule auto-advance after 3 seconds
  setTimeout(() => {
    advanceAfterResults(game);
  }, 3000);
}

/**
 * After showing results for 3 seconds, determine next state:
 * - If 2 or fewer players alive: GAME_OVER
 * - Otherwise: start next round
 */
function advanceAfterResults(game: Game) {
  const alivePlayers = game.players.filter((p) => p.alive);
  const aliveCount = alivePlayers.length;

  if (aliveCount <= 2) {
    // Game over - 2 or fewer players remaining
    game.state = "GAME_OVER";
  } else {
    // Start next round
    const nextRound = startRoundForGame(game, "TEXT");
    if (!nextRound) {
      // Failed to start round, end game
      game.state = "GAME_OVER";
    }
  }

  // Emit the update to all clients
  if (emitGameUpdateCallback) {
    emitGameUpdateCallback(game);
  }
}

/**
 * Helper to start a new round with all currently alive players.
 * Returns the new round, or null if unable to start.
 */
function startRoundForGame(game: Game, roundType: "TEXT" | "IMAGE" = "TEXT"): Round | null {
  const alivePlayers = game.players.filter((p) => p.alive);
  if (alivePlayers.length === 0) {
    return null;
  }

  const nextRoundNumber = game.roundNumber + 1;

  // Randomly pick one alive player as the target
  const targetPlayer = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];

  const round: Round = {
    roundNumber: nextRoundNumber,
    roundType,
    targetAlias: targetPlayer.alias,
    status: "SUBMITTING",
    submissions: [],
    votes: [],
    participantIds: alivePlayers.map((p) => p.playerId),
    eliminatedPlayerIds: [],
  };

  game.roundNumber = nextRoundNumber;
  game.rounds.push(round);
  game.state = "ROUND_SUBMITTING";

  return round;
}