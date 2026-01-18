// src/pages/GameOverPage.tsx
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { motion, AnimatePresence } from "framer-motion";

import { socket } from "../lib/socket";
import { useGameStore } from "../store/gameStore";
import type { GameDTO } from "../types/game";

interface RestartResponse {
  ok: boolean;
  error?: string;
  game: GameDTO;
  round: {
    roundNumber: number;
    targetAlias: string;
    roundType: string;
  };
}

interface GameGetResponse {
  ok: boolean;
  error?: string;
  game?: GameDTO;
}

const COLOR_BADGES: Record<string, string> = {
  red: "bg-red-500/90 text-white",
  blue: "bg-blue-500/90 text-white",
  green: "bg-green-500/90 text-white",
  yellow: "bg-yellow-400/90 text-black",
  purple: "bg-purple-500/90 text-white",
  orange: "bg-orange-500/90 text-white",
  pink: "bg-pink-500/90 text-white",
  cyan: "bg-cyan-500/90 text-black",
  lime: "bg-lime-400/90 text-black",
  teal: "bg-teal-400/90 text-black",
};

const COLOR_DOT: Record<string, string> = {
  red: "bg-red-500",
  blue: "bg-blue-500",
  green: "bg-green-500",
  yellow: "bg-yellow-400",
  purple: "bg-purple-500",
  orange: "bg-orange-500",
  pink: "bg-pink-500",
  cyan: "bg-cyan-500",
  lime: "bg-lime-400",
  teal: "bg-teal-400",
};

const GameOverPage = () => {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();

  // Store selectors (Selektoren / seçiciler)
  const playerId = useGameStore((s) => s.playerId);
  const storeIsHost = useGameStore((s) => s.isHost);
  const lastGameSnapshot = useGameStore((s) => s.lastGameSnapshot);
  const gameState = useGameStore((s) => s.gameState);
  const roundNumber = useGameStore((s) => s.roundNumber);
  const updateFromGame = useGameStore((s) => s.updateFromGame);

  // 1) GameOver sayfası açılınca oyunu tekrar çek (Initialer Fetch / ilk çekiş)
  useEffect(() => {
    if (!code) return;

    socket.emit("game:get", { code }, (res: GameGetResponse) => {
      if (!res.ok || !res.game) {
        toast.error(res.error ?? "Could not load game");
        return;
      }
      updateFromGame(res.game);
    });
  }, [code, updateFromGame]);

  // 2) Non-host oyuncular için restart olunca otomatik round'a geç (Navigation / yönlendirme)
  useEffect(() => {
    if (!lastGameSnapshot || !code) return;

    if (gameState === "ROUND_SUBMITTING" || gameState === "ROUND_VOTING") {
      navigate(`/game/${code}/round/${roundNumber}`, { replace: true });
    }
  }, [gameState, roundNumber, code, lastGameSnapshot, navigate]);

  // 3) Host'u snapshot'tan da doğrula (Fallback / yedek)
  const snapshotIsHost =
    !!lastGameSnapshot &&
    !!playerId &&
    !!lastGameSnapshot.players.find(
      (p) =>
        p.playerId === playerId &&
        (((p as any).host === true) ||
          ((p as any).isHost === true) ||
          ((p as any).role === "HOST"))
    );

  const isHost = storeIsHost || snapshotIsHost;

  const handleRestart = () => {
    if (!code || !playerId) return;

    socket.emit(
      "game:restart",
      { code, playerId, roundType: "TEXT" },
      (res: RestartResponse) => {
        if (!res.ok) {
          toast.error(res.error ?? "Could not restart game");
          return;
        }
        toast.success("Game restarted");
        navigate(`/game/${res.game.code}/round/${res.round.roundNumber}`, {
          replace: true,
        });
      }
    );
  };

  // Results
  const alivePlayers = lastGameSnapshot?.players.filter((p) => p.alive) || [];
  const eliminatedPlayers =
    lastGameSnapshot?.players.filter((p) => !p.alive) || [];

  // Host alias (Host-Spieler / host oyuncu)
  const hostPlayer =
    lastGameSnapshot?.players.find(
      (p) =>
        (p as any).host === true ||
        (p as any).isHost === true ||
        (p as any).role === "HOST"
    ) ?? null;
  const hostAlias = hostPlayer?.alias ?? "Host";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-base-200 gap-6 p-4">
      <h1 className="text-3xl font-bold">Game Over!</h1>
      
      {lastGameSnapshot && (
        <AnimatePresence>
          <div className="w-full max-w-md">
            {alivePlayers.length > 0 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="card bg-success text-success-content mb-4"
              >
                <div className="card-body">
                  <h2 className="card-title">Winners 🎉</h2>
                  <ul>
                    {alivePlayers.map((p) => (
                      <li key={p.playerId} className="flex items-center gap-3">
                        <div
                          className={`h-3 w-3 rounded-full ${
                            COLOR_DOT[p.colorId] ?? "bg-slate-200"
                          }`}
                        />
                        <span
                          className={`px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                            COLOR_BADGES[p.colorId] ?? "bg-slate-500/70 text-white"
                          }`}
                        >
                          {p.colorId}
                        </span>
                        <span className="font-medium">{p.alias}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </motion.div>
            )}

            {eliminatedPlayers.length > 0 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="card bg-base-100"
              >
                <div className="card-body">
                  <h2 className="card-title">Eliminated</h2>
                  <ul>
                    {eliminatedPlayers.map((p) => (
                      <li
                        key={p.playerId}
                        className="flex items-center gap-3 opacity-70"
                      >
                        <div
                          className={`h-3 w-3 rounded-full ${
                            COLOR_DOT[p.colorId] ?? "bg-slate-500"
                          }`}
                        />
                        <span
                          className={`px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                            COLOR_BADGES[p.colorId] ??
                            "bg-slate-600/70 text-white"
                          }`}
                        >
                          {p.colorId}
                        </span>
                        <span>{p.alias}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </motion.div>
            )}
          </div>
        </AnimatePresence>
      )}

      {isHost ? (
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="btn btn-primary btn-lg"
          onClick={handleRestart}
        >
          Restart game with same players
        </motion.button>
      ) : (
        <div className="text-center">
          <p className="opacity-70 mb-2">Waiting for host to restart…</p>
          <span className="loading loading-dots loading-md"></span>
        </div>
      )}
    </div>
  );
};

export default GameOverPage;
