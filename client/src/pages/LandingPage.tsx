// src/pages/LandingPage.tsx
import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

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
    <div className="min-h-screen flex flex-col items-center justify-center gap-8 bg-base-200">
      <h1 className="text-4xl font-bold">Among Bots</h1>

      <form onSubmit={handleCreate} className="flex flex-col gap-3">
        <input
          className="input input-bordered"
          placeholder="Your alias"
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
        />
        <button type="submit" className="btn btn-primary w-full">
          Create game
        </button>
      </form>

      <form onSubmit={handleJoin} className="flex flex-col gap-3">
        <input
          className="input input-bordered"
          placeholder="Game code (ABCD)"
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value)}
        />
        <button type="submit" className="btn btn-secondary w-full">
          Join game
        </button>
      </form>
    </div>
  );
};

export default LandingPage;
