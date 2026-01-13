// server/game/gameTypes.ts

export type GameState =
  | "LOBBY"
  | "IN_PROGRESS"
  | "ROUND_SUBMITTING"
  | "ROUND_VOTING"
  | "ROUND_RESULTS"
  | "GAME_OVER";

export interface Round {
  roundNumber: number;
  roundType: "TEXT" | "IMAGE";
  targetAlias: string;
  status: "SUBMITTING" | "VOTING" | "COMPLETED";
  submissions: Submission[];
  votes: Vote[];
  participantIds: string[];
  eliminatedPlayerIds?: string[];
  expiresAt?: number;
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

export interface AIRoundSummary {
  roundNumber: number;
  targetAlias: string;
  submissions: Array<{ playerId: string; content: string }>;
  votes: Vote[];
  eliminatedPlayerIds: string[];
}

export interface AIMemory {
  kickedPlayers: string[];
  roundsSummary: AIRoundSummary[];
  notes: string[];
}

export interface Player {
  playerId: string;
  alias: string;
  colorId: string;
  alive: boolean;
  connected: boolean;
  isAI?: boolean;
  aiData?: {
    apiKey?: string;
    teamId?: string;
    memory?: AIMemory;
  };
}

export interface Game {
  code: string;
  state: GameState;
  roundNumber: number;
  hostPlayerId: string;
  players: Player[];
  rounds: Round[];
  winner?: "HUMANS" | "AIS";
  aiTeamMemory?: Record<
    string,
    AIMemory & {
      roundPlans?: Record<
        string,
        {
          roles: Record<string, "MIMIC" | "BOLD" | "VAGUE">;
          usedSamples: string[];
        }
      >;
    }
  >;
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
