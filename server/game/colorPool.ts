import type { Game } from "./gameTypes";

const COLOR_POOL = [
  "red",
  "blue",
  "green",
  "yellow",
  "purple",
  "orange",
  "pink",
  "cyan",
  "lime",
  "teal",
];

export function assignColor(game: Game): string {
  const used = new Set(game.players.map((p) => p.colorId));

  // Build a list of available colors not yet used in this game
  const available = COLOR_POOL.filter((c) => !used.has(c));
  if (available.length > 0) {
    // Pick a random color from the available pool
    const idx = Math.floor(Math.random() * available.length);
    return available[idx] ?? available[0];
  }

  // Fallback if pool is exhausted: assign a unique generated color id
  return `color-${game.players.length + 1}`;
}
