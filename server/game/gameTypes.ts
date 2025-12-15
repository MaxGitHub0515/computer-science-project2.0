// server/game/gameTypes.ts
export type GameState =
  | "LOBBY"
  | "IN_PROGRESS"
  | "ROUND_SUBMITTING"
  | "ROUND_VOTING"
  | "ROUND_RESULTS"  // NEW
  | "GAME_OVER";

export interface Round {
  roundNumber: number;
  roundType: "TEXT" | "IMAGE";
  targetAlias: string;
  status: "SUBMITTING" | "VOTING" | "COMPLETED";
  submissions: Submission[];
  votes: Vote[];
  participantIds: string[];
  eliminatedPlayerIds?: string[];  // NEW
}

export interface Submission {
  submissionId: string;
  playerId: string;
  content: string;
  roundNumber: number;
}

export interface Vote {
  voterId: string;
  submissionId: string;
}

export interface Player {
  playerId: string;
  alias: string;
  colorId: string;
  alive: boolean;
  connected: boolean;
}

export interface Game {
  code: string;
  state: GameState;
  roundNumber: number;
  hostPlayerId: string;
  players: Player[];
  rounds: Round[];
}

export interface PublicVotingSubmission {
  submissionId: string;
  colorId: string;
  content: string;
}

export interface PublicVotingRound {
  code: string;
  roundNumber: number;
  submissions: PublicVotingSubmission[];
}