// src/App.tsx
import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import { Toaster } from "react-hot-toast";

import { socket } from "./lib/socket";
import { useGameStore } from "./store/gameStore";

import LandingPage from "./pages/LandingPage";
import LobbyPage from "./pages/LobbyPage";
import RoundPage from "./pages/RoundPage";
import GameOverPage from "./pages/GameOverPage";
import NotFoundPage from "./pages/404/NotFoundPage";
import type { GameDTO } from "./types/game";

function App() {
  const updateFromGame = useGameStore((s) => s.updateFromGame);
  const setFromCreateOrJoin = useGameStore((s) => s.setFromCreateOrJoin);

  useEffect(() => {
    
    const handler = (payload: GameDTO | { game: GameDTO }) => {
      const game =
        (payload as any)?.game && (payload as any).game.code
          ? (payload as any).game
          : payload;

      if (!game || !(game as any).code) return;

      console.log("game:update received", game);
      updateFromGame(game as GameDTO);
    };

    socket.on("game:update", handler);

    // Try to reconnect if we have saved session
    try {
      const storedCode = localStorage.getItem("gameCode");
      const storedPlayerId = localStorage.getItem("playerId");
      if (storedCode && storedPlayerId) {
        console.log("Attempting reconnect to", storedCode);
        socket.emit(
          "game:reconnect",
          { code: storedCode, playerId: storedPlayerId },
          (res: any) => {
            if (res?.ok && res.game) {
              // Use existing setter to populate store
              setFromCreateOrJoin({
                code: res.game.code,
                playerId: res.playerId,
                alias: res.alias,
                colorId: res.colorId,
                host: res.playerId === res.game.hostPlayerId,
                game: res.game,
              });
            }
          }
        );
      }
    } catch (e) {
      // ignore
    }

    return () => {
      socket.off("game:update", handler);
    };
  }, [updateFromGame, setFromCreateOrJoin]); // This WILL cause infinite loops with old Zustand setup

  return (
    <>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/lobby/:code" element={<LobbyPage />} />
        <Route path="/game/:code/round/:roundNumber" element={<RoundPage />} />
        <Route path="/game/:code/over" element={<GameOverPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>

      <Toaster position="top-right" />
    </>
  );
}

export default App;
