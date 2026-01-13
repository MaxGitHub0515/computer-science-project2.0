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

    return () => {
      socket.off("game:update", handler);
    };
  }, [updateFromGame]);

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
