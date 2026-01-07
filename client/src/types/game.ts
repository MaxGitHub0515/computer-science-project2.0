// src/types/game.ts

export type GameState = 
  | "LOBBY" 
  | "IN_PROGRESS" 
  | "ROUND_SUBMITTING" 
  | "ROUND_VOTING" 
  | "ROUND_RESULTS"  // Added for elimination reveal phase
  | "GAME_OVER";

export interface PlayerDTO {
  playerId: string;
  alias: string;
  colorId: string;
  alive: boolean;
  connected: boolean;
}

export interface SubmissionDTO {
  submissionId: string;
  playerId: string;
  content: string;
  roundNumber: number;
}

export interface VoteDTO {
  voterId: string;
  submissionId: string;
}

export interface RoundDTO {
  roundNumber: number;
  roundType: "TEXT" | "IMAGE";
  targetAlias: string;
  status: "SUBMITTING" | "VOTING" | "COMPLETED";
  submissions: SubmissionDTO[];
  votes: VoteDTO[];
  participantIds: string[];
  eliminatedPlayerIds?: string[];
  // Optional unix ms timestamp when the current phase expires
  expiresAt?: number;
}

export interface GameDTO {
  code: string;
  state: GameState;
  roundNumber: number;
  hostPlayerId: string;
  players: PlayerDTO[];
  rounds: RoundDTO[];
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