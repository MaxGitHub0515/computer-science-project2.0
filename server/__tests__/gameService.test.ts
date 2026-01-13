import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { onVotesUpdated } from "../game/gameService";
import type { Game } from "../game/gameTypes";


function makeGameWithPlayers(count = 3): Game {
  const players = [];
  for (let i = 0; i < count; i++) {
    players.push({ playerId: `p${i + 1}`, alias: `P${i + 1}`, colorId: `c${i + 1}`, alive: true, connected: true });
  }
  return {
    code: "TEST",
    state: "IN_PROGRESS" as const,
    roundNumber: 1,
    hostPlayerId: "p1",
    players,
    rounds: [],
  };
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  // Fast-forward any pending timers and restore timers
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

test("onVotesUpdated eliminates the player with most votes", () => {
  const game = makeGameWithPlayers(3);

  const round = {
    roundNumber: 1,
    roundType: "TEXT" as const,
    targetAlias: "P1",
    status: "VOTING" as const,
    submissions: [
      { submissionId: "s1", playerId: "p1", content: "a", roundNumber: 1 },
      { submissionId: "s2", playerId: "p2", content: "b", roundNumber: 1 },
      { submissionId: "s3", playerId: "p3", content: "c", roundNumber: 1 },
    ],
    votes: [
      { voterId: "p1", submissionId: "s2" },
      { voterId: "p2", submissionId: "s2" },
      { voterId: "p3", submissionId: "s1" },
    ],
    participantIds: ["p1", "p2", "p3"],
    eliminatedPlayerIds: [],
  };

  onVotesUpdated(game, round);

  // Ensure immediate timers (none) are processed, but avoid advancing the auto-advance 3s timeout
  jest.advanceTimersByTime(0);

  expect(round.status).toBe("COMPLETED");
  expect(game.state).toBe("ROUND_RESULTS");
  expect(round.eliminatedPlayerIds?.length).toBe(1);
  expect(game.players.find((p) => p.playerId === round.eliminatedPlayerIds?.[0])?.alive).toBe(false);
});

test("onVotesUpdated tie-breaker eliminates one player randomly", () => {
  const game = makeGameWithPlayers(3);

  const round = {
    roundNumber: 1,
    roundType: "TEXT" as const,
    targetAlias: "P1",
    status: "VOTING" as const,
    submissions: [
      { submissionId: "s1", playerId: "p1", content: "a", roundNumber: 1 },
      { submissionId: "s2", playerId: "p2", content: "b", roundNumber: 1 },
      { submissionId: "s3", playerId: "p3", content: "c", roundNumber: 1 },
    ],
    votes: [
      { voterId: "p1", submissionId: "s1" },
      { voterId: "p2", submissionId: "s2" },
      { voterId: "p3", submissionId: "s3" },
    ],
    participantIds: ["p1", "p2", "p3"],
    eliminatedPlayerIds: [],
  };

  // Mock Math.random to make the choice deterministic
  const originalRand = Math.random;
  Math.random = () => 0.6; // pick the second-ish entry depending on implementation

  onVotesUpdated(game, round);

  // Ensure immediate timers (none) are processed, but avoid advancing the auto-advance 3s timeout
  jest.advanceTimersByTime(0);

  expect(round.status).toBe("COMPLETED");
  expect(game.state).toBe("ROUND_RESULTS");
  expect(round.eliminatedPlayerIds?.length).toBe(1);

  // Restore
  Math.random = originalRand;
});
