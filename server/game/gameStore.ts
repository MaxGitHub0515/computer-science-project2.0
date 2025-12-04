import type { Game } from "./gameTypes";

const games = new Map<string, Game>();

export function createGame(game: Game) {
  games.set(game.code, game);
}

export function getGame(code: string): Game | undefined {
  return games.get(code);
}

export function updateGame(code: string, mutator: (g: Game) => void): Game | undefined {
  const game = games.get(code);
  if (!game) return;
  mutator(game);
  return game;
}
