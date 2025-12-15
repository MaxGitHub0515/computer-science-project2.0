// src/store/gameStore.ts
import { create } from "zustand";
import type { GameDTO, GameState } from "../types/game";

interface GameClientState {
  code: string | null;
  playerId: string | null;
  alias: string | null;
  colorId: string | null;
  isHost: boolean;
  gameState: GameState | null;
  roundNumber: number | null;
  lastGameSnapshot: GameDTO | null;

  setFromCreateOrJoin(payload: {
    code: string;
    playerId: string;
    alias: string;
    colorId: string;
    host: boolean;
    game: GameDTO;
  }): void;

  updateFromGame(game: GameDTO): void;
  reset(): void;
}

export const useGameStore = create<GameClientState>()((set) => ({
  code: null,
  playerId: null,
  alias: null,
  colorId: null,
  isHost: false,
  gameState: null,
  roundNumber: null,
  lastGameSnapshot: null,

  setFromCreateOrJoin(payload) {
    set({
      code: payload.code,
      playerId: payload.playerId,
      alias: payload.alias,
      colorId: payload.colorId,
      isHost: payload.host,
      gameState: payload.game.state,
      roundNumber: payload.game.roundNumber,
      lastGameSnapshot: payload.game,
    });
  },

  updateFromGame(game) {
    set({
      code: game.code,
      gameState: game.state,
      roundNumber: game.roundNumber,
      lastGameSnapshot: game,
    });
  },

  reset() {
    set({
      code: null,
      playerId: null,
      alias: null,
      colorId: null,
      isHost: false,
      gameState: null,
      roundNumber: null,
      lastGameSnapshot: null,
    });
  },
}));