// src/pages/LobbyPage.tsx
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { motion } from "framer-motion";

import { socket } from "../lib/socket";
import { useGameStore } from "../store/gameStore";
import type { GameDTO } from "../types/game";

interface StartGameResponse {
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

const COLOR_AVATAR: Record<string, string> = {
  red: "bg-red-500",
  blue: "bg-blue-500",
  green: "bg-green-500",
  yellow: "bg-yellow-400",
  purple: "bg-purple-500",
  orange: "bg-orange-500",
  pink: "bg-pink-500",
  cyan: "bg-cyan-500",
};

const LobbyPage = () => {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();

  const playerId = useGameStore((s) => s.playerId);
  const storeIsHost = useGameStore((s) => s.isHost);
  const lastGameSnapshot = useGameStore((s) => s.lastGameSnapshot);
  const updateFromGame = useGameStore((s) => s.updateFromGame);

  console.log("Lobby render", { code, lastGameSnapshot, playerId, storeIsHost });

  const snapshotIsHost =
    !!lastGameSnapshot &&
    !!lastGameSnapshot.players.find(
      (p) => p.playerId === playerId && (p as any).host === true
    );

  const isHost = storeIsHost || snapshotIsHost;

  // Fetch game state
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

  // Redirect if game has already started
  useEffect(() => {
    if (!lastGameSnapshot) return;

    if (
      lastGameSnapshot.state === "ROUND_SUBMITTING" ||
      lastGameSnapshot.state === "ROUND_VOTING"
    ) {
      navigate(
        `/game/${lastGameSnapshot.code}/round/${lastGameSnapshot.roundNumber}`,
        { replace: true }
      );
    }
  }, [lastGameSnapshot, navigate]);

  if (!code) return <div className="p-4">No game code in URL</div>;

  if (!lastGameSnapshot) {
    return (
      <motion.div
        className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <motion.p className="text-lg tracking-wide">Loading lobby {code}…</motion.p>
      </motion.div>
    );
  }

  const players = lastGameSnapshot.players;

  const handleStartGame = () => {
    if (!playerId || !code) return;

    socket.emit(
      "game:start",
      { code, playerId, roundType: "TEXT" },
      (res: StartGameResponse) => {
        console.log("game:start response", res);
        if (!res.ok) {
          toast.error(res.error ?? "Could not start game");
          return;
        }
        navigate(`/game/${res.game.code}/round/${res.round.roundNumber}`);
      }
    );
  };

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
        transition={{ duration: 20, repeat: Infinity }}
      />
      <motion.div
        className="absolute -right-40 bottom-0 w-96 h-96 rounded-full bg-indigo-600/35 blur-3xl"
        animate={{ x: [0, -15, 10, 0], y: [0, -10, 5, 0] }}
        transition={{ duration: 22, repeat: Infinity }}
      />

      {/* Lobby card */}
      <motion.div
        className="relative z-10 w-full max-w-2xl rounded-3xl border border-white/10 bg-slate-900/75 backdrop-blur-xl shadow-2xl p-8 md:p-10"
        initial={{ opacity: 0, y: 25 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
              Lobby{" "}
              <span className="bg-gradient-to-r from-indigo-400 to-fuchsia-400 bg-clip-text text-transparent">
                {code}
              </span>
            </h1>
            <p className="mt-1 text-xs md:text-sm text-slate-400">
              Waiting for players to join the game.
            </p>
          </div>

          <div className="flex flex-col items-end gap-2">
            <motion.div
              className="px-4 py-2 rounded-2xl bg-slate-800/90 border border-slate-600/70 text-xs md:text-sm flex items-center gap-2 justify-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>
                {players.length} {players.length === 1 ? "player" : "players"}
              </span>
            </motion.div>

            {isHost && (
              <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-[11px] border border-emerald-500/40">
                You are the host
              </span>
            )}
          </div>
        </div>

        {/* Main grid */}
        <div className="grid gap-4 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          {/* Players list */}
          <motion.div
            className="rounded-2xl bg-slate-900/80 border border-slate-700/60 p-4"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="flex items-center justify-between mb-3">
              <p className="font-semibold text-sm uppercase tracking-wide text-slate-300">
                Players in lobby
              </p>
              <span className="badge bg-slate-800 text-slate-200">
                {players.length}
              </span>
            </div>

            <motion.ul
              className="space-y-2"
              initial="hidden"
              animate="visible"
              variants={{
                hidden: {},
                visible: { transition: { staggerChildren: 0.05 } },
              }}
            >
              {players.map((p) => (
                <motion.li
                  key={p.playerId}
                  className="flex items-center justify-between gap-3 rounded-xl bg-slate-800/80 px-3 py-2"
                  variants={{
                    hidden: { opacity: 0, y: 6 },
                    visible: { opacity: 1, y: 0 },
                  }}
                >
                  <div className="flex items-center gap-3">
                    {/* Color */}
                    <div
                      className={`h-4 w-4 rounded-full ${
                        COLOR_AVATAR[p.colorId] ?? "bg-slate-500"
                      }`}
                    />

                    {/* Gamer name */}
                    <span className="text-sm font-medium">
                      {p.alias}
                      {p.playerId === playerId && (
                        <span className="ml-1 text-[11px] text-emerald-300">
                          (you)
                        </span>
                      )}
                    </span>
                  </div>

                  
                  <div className="flex items-center gap-2 text-[11px]">
                    {/* Host Label */}
                    {isHost && p.playerId === playerId && (
                      <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                        host
                      </span>
                    )}

                    {p.connected ? (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                        online
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-slate-700/60 text-slate-300 border border-slate-500/70">
                        disconnected
                      </span>
                    )}
                  </div>
                </motion.li>
              ))}
            </motion.ul>
          </motion.div>

          {/* Game controls */}
          <motion.div
            className="rounded-2xl bg-slate-900/80 border border-slate-700/60 p-4 flex flex-col justify-between gap-4"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div>
              <p className="font-semibold text-sm text-slate-200 mb-2">
                Game settings
              </p>
              <p className="text-sm text-slate-400">
                Minimum players: 3
              </p>
            </div>

            <div className="mt-2">
              {isHost ? (
                <motion.button
                  className="btn w-full border-none text-white bg-gradient-to-r from-indigo-500 to-fuchsia-500"
                  disabled={players.length < 3}
                  onClick={handleStartGame}
                  whileHover={
                    players.length < 3 ? {} : { scale: 1.02, y: -1 }
                  }
                  whileTap={
                    players.length < 3 ? {} : { scale: 0.97, y: 0 }
                  }
                >
                  {players.length < 3
                    ? "Need at least 3 players"
                    : "Start game"}
                </motion.button>
              ) : (
                <p className="text-sm text-slate-400 text-center">
                  Waiting for host to start…
                </p>
              )}
            </div>

            <p className="mt-1 text-[11px] text-slate-500 text-center">
              Share code <strong>{code}</strong> with friends.
            </p>
          </motion.div>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default LobbyPage;
