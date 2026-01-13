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
    <motion.div
      className="relative min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-4 text-slate-50"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Glow background */}
      <motion.div
        className="absolute -left-40 -top-24 w-96 h-96 rounded-full bg-fuchsia-600/35 blur-3xl"
        animate={{ x: [0, 20, -10, 0], y: [0, 10, -5, 0] }}
        transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute -right-40 bottom-0 w-96 h-96 rounded-full bg-indigo-600/35 blur-3xl"
        animate={{ x: [0, -15, 10, 0], y: [0, -10, 5, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Main card */}
      <motion.div
        className="relative z-10 w-full max-w-3xl rounded-3xl border border-white/10 bg-slate-900/85 backdrop-blur-xl shadow-2xl p-6 md:p-8 flex flex-col gap-6"
        initial={{ opacity: 0, y: 25, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
      >
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
              Game Over
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Host:{" "}
              <span className="font-semibold text-slate-200">{hostAlias}</span>
            </p>
            {code && (
              <p className="text-xs text-slate-500">
                Code: <span className="font-mono tracking-widest">{code}</span>
              </p>
            )}
          </div>

          <div className="flex flex-col items-end gap-2 text-xs md:text-sm">
            <span className="px-3 py-1 rounded-full bg-slate-800/90 border border-slate-600/70 text-slate-200">
              Rounds played:{" "}
              <span className="font-semibold">
                {lastGameSnapshot?.roundNumber ?? "-"}
              </span>
            </span>

            {isHost ? (
              <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                You are the host
              </span>
            ) : (
              <span className="px-3 py-1 rounded-full bg-slate-800/90 text-slate-300 border border-slate-600/70">
                Waiting for host…
              </span>
            )}
          </div>
        </div>

        {/* Results */}
        <div className="grid gap-4 md:grid-cols-2">
          <AnimatePresence>
            {alivePlayers.length > 0 && (
              <motion.div
                key="winners"
                className="rounded-2xl bg-emerald-600/20 border border-emerald-500/60 text-emerald-50 p-4"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
              >
                <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
                  Winners 🎉
                </h2>
                <ul className="space-y-1 text-sm">
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
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {eliminatedPlayers.length > 0 && (
              <motion.div
                key="eliminated"
                className="rounded-2xl bg-slate-900/80 border border-slate-700/70 text-slate-100 p-4"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
              >
                <h2 className="text-lg font-semibold mb-2">Eliminated</h2>
                <ul className="space-y-1 text-sm">
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
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Bottom controls */}
        <div className="mt-2 flex flex-col items-center gap-3">
          {isHost ? (
            <motion.button
              className="btn btn-lg border-none text-white bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-8"
              onClick={handleRestart}
              whileHover={{ scale: 1.03, y: -1 }}
              whileTap={{ scale: 0.97, y: 0 }}
            >
              Restart game with same players
            </motion.button>
          ) : (
            <div className="flex flex-col items-center gap-2 text-sm text-slate-300">
              <p>Waiting for host to restart…</p>
              <span className="loading loading-dots loading-md" />
            </div>
          )}

          <p className="text-[11px] text-slate-500 text-center mt-1">
            You can close this tab anytime. If the host restarts, you’ll be
            reconnected automatically.
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default GameOverPage;
