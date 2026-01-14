import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { onVotesUpdated } from "../game/gameService";
import type { Game } from "../game/gameTypes";


function makeGameWithPlayers(count = 3): Game {
  const players = [];
  for (let i = 0; i < count; i++) {
    players.push({ playerId: `p${i + 1}`, alias: `P${i + 1}`, colorId: `c${i + 1}`, alive: true, connected: true, score: 0, missedSubmissions: 0 });
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
    eliminatedPlayerIds: [] as string[],
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
    eliminatedPlayerIds: [] as string[],
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

test("finalizeVoting awards participation points, fast bonuses, and penalties for no submission", () => {
  const game = makeGameWithPlayers(4);

  const baseTime = Date.now();
  const round = {
    roundNumber: 1,
    roundType: "TEXT" as const,
    targetAlias: "P1",
    status: "VOTING" as const,
    submissions: [
      { submissionId: "s1", playerId: "p1", content: "hello", roundNumber: 1, submittedAt: baseTime }, // 1st - fastest
      { submissionId: "s2", playerId: "p2", content: "world", roundNumber: 1, submittedAt: baseTime + 100 }, // 2nd - fast
      { submissionId: "s3", playerId: "p3", content: "test", roundNumber: 1, submittedAt: baseTime + 200 }, // 3rd - slower
      { submissionId: "s4", playerId: "p4", content: "", roundNumber: 1, submittedAt: baseTime + 50 }, // 4th - empty
    ],
    votes: [
      { voterId: "p1", submissionId: "s4" },
      { voterId: "p2", submissionId: "s4" },
      { voterId: "p3", submissionId: "s4" },
      { voterId: "p4", submissionId: "s1" },
    ],
    participantIds: ["p1", "p2", "p3", "p4"],
    eliminatedPlayerIds: [] as string[],
  };

  onVotesUpdated(game, round);

  jest.advanceTimersByTime(0);

  // p1: +10 participation + 5 fastest = 15
  expect(game.players.find((p) => p.playerId === "p1")?.score).toBe(15);
  // p2: +10 participation + 3 fast = 13
  expect(game.players.find((p) => p.playerId === "p2")?.score).toBe(13);
  // p3: +10 participation + 1 fast = 11
  expect(game.players.find((p) => p.playerId === "p3")?.score).toBe(11);
  // p4: -5 penalty (no submission)
  expect(game.players.find((p) => p.playerId === "p4")?.score).toBe(-5);

  // p4 eliminated (received most votes)
  expect(game.players.find((p) => p.playerId === "p4")?.alive).toBe(false);
  expect(round.eliminatedPlayerIds && round.eliminatedPlayerIds.includes("p4")).toBe(true);
});

test("player is eliminated after two missed submissions", () => {
  const game = makeGameWithPlayers(3);

  // Player p3 has already missed one submission
  game.players.find((p) => p.playerId === "p3")!.missedSubmissions = 1;

  const baseTime = Date.now();
  const round = {
    roundNumber: 1,
    roundType: "TEXT" as const,
    targetAlias: "P1",
    status: "VOTING" as const,
    submissions: [
      { submissionId: "s1", playerId: "p1", content: "a", roundNumber: 1, submittedAt: baseTime },
      { submissionId: "s2", playerId: "p2", content: "b", roundNumber: 1, submittedAt: baseTime + 100 },
      { submissionId: "s3", playerId: "p3", content: "", roundNumber: 1, submittedAt: baseTime + 200 }, // Empty - 2nd miss
    ],
    votes: [
      { voterId: "p1", submissionId: "s2" },
      { voterId: "p2", submissionId: "s1" },
      { voterId: "p3", submissionId: "s1" },
    ],
    participantIds: ["p1", "p2", "p3"],
    eliminatedPlayerIds: [] as string[],
  };

  onVotesUpdated(game, round);

  jest.advanceTimersByTime(0);

  // p3 should be eliminated due to 2 consecutive missed submissions
  expect(game.players.find((p) => p.playerId === "p3")?.alive).toBe(false);
  expect(game.players.find((p) => p.playerId === "p3")?.missedSubmissions).toBe(2);
  expect(round.eliminatedPlayerIds && round.eliminatedPlayerIds.includes("p3")).toBe(true);

  // p3 should have -5 penalty
  expect(game.players.find((p) => p.playerId === "p3")?.score).toBe(-5);

  // Others should have participation points + fast bonuses
  // p1: fastest (baseTime) gets +10 participation + 5 fast = 15
  // p2: second (baseTime + 100) gets +10 participation + 3 fast = 13
  expect(game.players.find((p) => p.playerId === "p1")?.score).toBe(15);
  expect(game.players.find((p) => p.playerId === "p2")?.score).toBe(13);
});

