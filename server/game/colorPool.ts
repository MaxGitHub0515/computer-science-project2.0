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

  const available = COLOR_POOL.find((c) => !used.has(c));
  if (available) return available;

  return `color-${game.players.length + 1}`;
}
