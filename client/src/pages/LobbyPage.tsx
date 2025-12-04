// src/pages/LobbyPage.tsx
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";

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

const LobbyPage = () => {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();

  const playerId = useGameStore((s) => s.playerId);
  const isHost = useGameStore((s) => s.isHost);
  const lastGameSnapshot = useGameStore((s) => s.lastGameSnapshot);
  const updateFromGame = useGameStore((s) => s.updateFromGame);

  // DEBUG: log whenever we render
  console.log("Lobby render", { code, lastGameSnapshot, playerId, isHost });

  // On mount (or code change): fetch latest game state from server
  useEffect(() => {
    if (!code) return;

    console.log("Lobby requesting game:get for", code);

    socket.emit(
      "game:get",
      { code },
      (res: GameGetResponse) => {
        console.log("game:get response", res);

        if (!res.ok || !res.game) {
          toast.error(res.error ?? "Could not load game");
          return;
        }
        updateFromGame(res.game);
      }
    );
  }, [code, updateFromGame]); // Now updateFromGame is stable, so this is safe

  // If the game is already in round phase, redirect there
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
      <div className="min-h-screen flex flex-col items-center justify-center bg-base-200">
        <p className="text-lg">Loading lobby {code}…</p>
      </div>
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
    <div className="min-h-screen flex flex-col items-center py-10 bg-base-200 gap-6">
      <h1 className="text-3xl font-bold">Lobby {code}</h1>

      <div>
        <p className="font-semibold text-center">Players</p>
        <ul className="mt-2 space-y-1">
          {players.map((p) => (
            <li
              key={p.playerId}
              className="flex items-center gap-2 justify-center"
            >
              <span className="badge">{p.colorId}</span>
              <span>{p.alias}</span>
              {!p.connected && (
                <span className="badge badge-outline">disconnected</span>
              )}
            </li>
          ))}
        </ul>
      </div>

      {isHost ? (
        <button
          className="btn btn-primary"
          disabled={players.length < 3}
          onClick={handleStartGame}
        >
          {players.length < 3
            ? "Need at least 3 players"
            : "Start game (Round 1)"}
        </button>
      ) : (
        <p className="opacity-70">Waiting for host to start…</p>
      )}
    </div>
  );
};

export default LobbyPage;