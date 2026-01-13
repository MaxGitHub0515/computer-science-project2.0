// src/pages/LandingPage.tsx
import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { motion } from "framer-motion"; 

import { socket } from "../lib/socket";
import { useGameStore } from "../store/gameStore";
import type { GameDTO } from "../types/game";

interface CreateOrJoinResponse {
  ok: boolean;
  error?: string;
  code: string;
  playerId: string;
  alias: string;
  colorId: string;
  host: boolean;
  game: GameDTO;
}

const LandingPage = () => {
  const navigate = useNavigate();
  const setFromCreateOrJoin = useGameStore((s) => s.setFromCreateOrJoin);

  const [alias, setAlias] = useState("");
  const [joinCode, setJoinCode] = useState("");


  const handleCreate = (e: FormEvent) => {
    e.preventDefault();
    if (!alias.trim()) {
      toast.error("Enter an alias first");
      return;
    }

    socket.emit(
      "game:create",
      { alias: alias.trim() },
      (res: CreateOrJoinResponse) => {
        if (!res.ok) {
          toast.error(res.error ?? "Failed to create game");
          return;
        }
        setFromCreateOrJoin(res);
        navigate(`/lobby/${res.code}`);
      }
    );
  };

  const handleJoin = (e: FormEvent) => {
    e.preventDefault();
    if (!alias.trim() || !joinCode.trim()) {
      toast.error("Alias and code required");
      return;
    }

    socket.emit(
      "game:join",
      { alias: alias.trim(), code: joinCode.trim().toUpperCase() },
      (res: CreateOrJoinResponse) => {
        if (!res.ok) {
          toast.error(res.error ?? "Failed to join game");
          return;
        }
        setFromCreateOrJoin(res);
        navigate(`/lobby/${res.code}`);
      }
    );
  };

  return (
    <motion.div
      className="relative min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >

      {/* Neon glow blobs */}
      <motion.div
        className="absolute -left-40 -top-20 w-96 h-96 bg-fuchsia-600/40 blur-3xl rounded-full"
        animate={{ x: [0, 25, -10, 0], y: [0, 15, -5, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />

      <motion.div
        className="absolute -right-40 bottom-0 w-96 h-96 bg-indigo-600/40 blur-3xl rounded-full"
        animate={{ x: [0, -20, 10, 0], y: [0, -10, 5, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* CARD */}
      <motion.div
        className="relative z-10 w-full max-w-md p-8 rounded-3xl shadow-2xl bg-slate-900/70 border border-white/10 backdrop-blur-xl"
        initial={{ opacity: 0, y: 30, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
      >
        {/* Title */}
        <motion.h1
          className="text-4xl font-extrabold text-center mb-8 bg-gradient-to-r from-indigo-400 via-fuchsia-400 to-pink-300 bg-clip-text text-transparent"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          Among Bots
        </motion.h1>

        {/* CREATE FORM */}
        <motion.form
          onSubmit={handleCreate}
          className="flex flex-col gap-3"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <input
            className="input input-bordered bg-slate-900/50 border-slate-700 text-slate-100 focus:border-fuchsia-400"
            placeholder="Your alias"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
          />

          <motion.button
            type="submit"
            className="btn w-full border-none text-white bg-gradient-to-r from-indigo-500 to-fuchsia-500"
            whileHover={{ scale: 1.03, y: -2 }}
            whileTap={{ scale: 0.96 }}
          >
            Create game
          </motion.button>
        </motion.form>

        {/* Divider */}
        <div className="my-6 flex items-center gap-3 text-xs text-slate-500">
          <div className="h-px flex-1 bg-slate-700" />
          <span>or join</span>
          <div className="h-px flex-1 bg-slate-700" />
        </div>

        {/* JOIN FORM */}
        <motion.form
          onSubmit={handleJoin}
          className="flex flex-col gap-3"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          <input
            className="input input-bordered bg-slate-900/50 border-slate-700 text-slate-100 tracking-[0.3em] uppercase focus:border-fuchsia-400 text-center"
            placeholder="ABCD"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
          />

          <motion.button
            type="submit"
            className="btn w-full border-none text-white bg-gradient-to-r from-pink-500 to-fuchsia-500"
            whileHover={{ scale: 1.03, y: -2 }}
            whileTap={{ scale: 0.96 }}
          >
            Join game
          </motion.button>
        </motion.form>

        <p className="mt-6 text-center text-[11px] text-slate-500">
          Social deduction with AI impostors — trust no one.
        </p>
      </motion.div>
    </motion.div>
  );
};

export default LandingPage;
