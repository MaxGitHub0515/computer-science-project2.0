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
  roundPrompt?: string;
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
  submittedAt?: number;
}

export interface Vote {
  voterId: string;
  submissionId: string;
}

export interface AIRoundSummary {
  roundNumber: number;
  targetAlias: string;
  submissions: Array<{ playerId: string; content: string; sanitized?: boolean }>;
  votes: Vote[];
  eliminatedPlayerIds: string[];
}

export interface AIMemory {
  kickedPlayers: string[];
  roundsSummary: AIRoundSummary[];
  notes: string[];
  // Cache of toxicity assessments keyed by the original player text
  toxicityCache?: Record<string, ToxicityAssessment>;
}

export interface ToxicityAssessment {
  isToxic: boolean;
  scores: Record<string, number>;
  // Brief text shown to AIs instead of toxic content. MUST NOT include original text.
  replacedText: string;
  // Optional human-readable summary of top categories and scores
  summary?: string;
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
  score: number;
  missedSubmissions: number;
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
          fallbackVoteSubmissionId?: string;
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
