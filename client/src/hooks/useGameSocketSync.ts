// src/hooks/useGameSocketSync.ts
import { useEffect } from "react";
import { socket } from "../lib/socket";
import { useGameStore } from "../store/gameStore";
import type { GameDTO } from "../types/game";

type GameUpdatedPayload = GameDTO | { game: GameDTO };

function extractGame(payload: GameUpdatedPayload): GameDTO | null {
  if (!payload) return null;
  // payload direkt GameDTO ise
  if ((payload as any).code && (payload as any).players) return payload as GameDTO;
  // payload { game: GameDTO } ise
  if ((payload as any).game?.code) return (payload as any).game as GameDTO;
  return null;
}

export function useGameSocketSync() {
  const updateFromGame = useGameStore((s) => s.updateFromGame);

  useEffect(() => {
    const onGameUpdated = (payload: GameUpdatedPayload) => {
      const game = extractGame(payload);
      if (!game) return;
      updateFromGame(game);
    };

    // Backend'in broadcast ettiği event adı:
    socket.on("game:updated", onGameUpdated);

    return () => {
      socket.off("game:updated", onGameUpdated);
    };
  }, [updateFromGame]);
}
