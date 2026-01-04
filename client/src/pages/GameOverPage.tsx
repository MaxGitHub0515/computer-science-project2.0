// src/pages/GameOverPage.tsx
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";

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

const GameOverPage = () => {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  
  // Separate selectors
  const playerId = useGameStore((s) => s.playerId);
  const isHost = useGameStore((s) => s.isHost);
  const lastGameSnapshot = useGameStore((s) => s.lastGameSnapshot);
  const gameState = useGameStore((s) => s.gameState);
  const roundNumber = useGameStore((s) => s.roundNumber);

  // Navigate when game restarts (for non-host players)
  useEffect(() => {
    if (!lastGameSnapshot || !code) return;

    // If game state changes from GAME_OVER to a round state, navigate to the round
    if (
      gameState === "ROUND_SUBMITTING" ||
      gameState === "ROUND_VOTING"
    ) {
      console.log("Game restarted, navigating to round", roundNumber);
      navigate(`/game/${code}/round/${roundNumber}`, { replace: true });
    }
  }, [gameState, roundNumber, code, lastGameSnapshot, navigate]);

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
        // Navigate immediately for the host
        navigate(`/game/${res.game.code}/round/${res.round.roundNumber}`, {
          replace: true,
        });
      }
    );
  };

  // Show game results if available
  const alivePlayers = lastGameSnapshot?.players.filter((p) => p.alive) || [];
  const eliminatedPlayers = lastGameSnapshot?.players.filter((p) => !p.alive) || [];

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-base-200 gap-6 p-4">
      <h1 className="text-3xl font-bold">Game Over!</h1>
      
      {lastGameSnapshot && (
        <div className="w-full max-w-md">
          {alivePlayers.length > 0 && (
            <div className="card bg-success text-success-content mb-4">
              <div className="card-body">
                <h2 className="card-title">Winners 🎉</h2>
                <ul role="list">
                  {alivePlayers.map((p) => (
                    <li key={p.playerId} className="flex items-center gap-2">
                      <span className="badge">{p.colorId}</span>
                      <span>{p.alias}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {eliminatedPlayers.length > 0 && (
            <div className="card bg-base-100 mb-4">
              <div className="card-body">
                <h2 className="card-title">Eliminated</h2>
                <ul role="list">
                  {eliminatedPlayers.map((p) => (
                    <li key={p.playerId} className="flex items-center gap-2 opacity-60">
                      <span className="badge">{p.colorId}</span>
                      <span>{p.alias}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Round history / replay */}
          {lastGameSnapshot.rounds.length > 0 && (
            <div className="card bg-base-100">
              <div className="card-body">
                <h2 className="card-title">Round history</h2>
                <div className="flex flex-col gap-4">
                  {lastGameSnapshot.rounds.map((r) => {
                    // Build vote tally
                    const tally = new Map<string, number>();
                    for (const v of r.votes) {
                      tally.set(v.submissionId, (tally.get(v.submissionId) ?? 0) + 1);
                    }

                    return (
                      <div key={r.roundNumber} className="border rounded p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="font-semibold">Round {r.roundNumber}</div>
                          <div className="text-sm opacity-70">Target: {r.targetAlias}</div>
                        </div>

                        <div className="space-y-2">
                          {r.submissions.map((s) => {
                            const player = lastGameSnapshot.players.find((p) => p.playerId === s.playerId);
                            const votesFor = tally.get(s.submissionId) ?? 0;
                            return (
                              <div key={s.submissionId} className="flex items-start gap-3">
                                <div className="min-w-[36px]"><span className="badge">{player?.colorId}</span></div>
                                <div className="flex-1">
                                  {s.content.startsWith("data:") ? (
                                    <img src={s.content} alt={`Submission by ${player?.alias}`} className="max-h-48 w-full object-contain rounded" />
                                  ) : (
                                    <div className="text-base">{s.content}</div>
                                  )}
                                  <div className="text-sm opacity-70 mt-1">Votes: {votesFor}</div>
                                </div>
                              </div>
                            );
                          })}

                          <div className="mt-2 text-sm">
                            <strong>Eliminated:</strong>{' '}
                            {r.eliminatedPlayerIds && r.eliminatedPlayerIds.length > 0 ? (
                              r.eliminatedPlayerIds.map((id) => lastGameSnapshot.players.find((p) => p.playerId === id)?.alias).join(', ')
                            ) : (
                              'None'
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {isHost ? (
        <button className="btn btn-primary btn-lg w-full sm:w-auto" aria-label="Restart game" onClick={handleRestart}>
          Restart game with same players
        </button>
      ) : (
        <div className="text-center">
          <p className="opacity-70 mb-2">Waiting for host to restart…</p>
          <span className="loading loading-dots loading-md" aria-hidden="true"></span>
        </div>
      )}
    </div>
  );
};

export default GameOverPage;