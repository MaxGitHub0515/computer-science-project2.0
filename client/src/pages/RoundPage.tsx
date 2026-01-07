// src/pages/RoundPage.tsx
import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";

import { socket } from "../lib/socket";
import { useGameStore } from "../store/gameStore";
import type {
  GameState,
  PublicVotingSubmission,
  PublicVotingRound,
} from "../types/game";

interface SubmitResponse {
  ok: boolean;
  error?: string;
  submissionId?: string;
  gameState?: GameState;
  roundStatus?: "SUBMITTING" | "VOTING";
}

interface VoteResponse {
  ok: boolean;
  error?: string;
  gameState?: GameState;
  totalVotes?: number;
}

interface VotingAck {
  ok: boolean;
  error?: string;
  votingRound?: PublicVotingRound;
}

const RoundPage = () => {
  const { code, roundNumber } = useParams<{ code: string; roundNumber: string }>();
  const navigate = useNavigate();

  // Use separate selectors for better performance
  const playerId = useGameStore((s) => s.playerId);
  const gameState = useGameStore((s) => s.gameState);
  const lastGameSnapshot = useGameStore((s) => s.lastGameSnapshot);

  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [votingSubmissions, setVotingSubmissions] = useState<PublicVotingSubmission[]>([]);
  const [loadingVoting, setLoadingVoting] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);

  // Progress notifications and accessible announcements
  const [prevSubmissionCount, setPrevSubmissionCount] = useState<number | null>(null);
  const [prevVoteCount, setPrevVoteCount] = useState<number | null>(null);
  const [announceMsg, setAnnounceMsg] = useState<string | null>(null);

  const roundNum = roundNumber ? Number(roundNumber) : NaN;

  const COLOR_BORDER: Record<string, string> = {
    red: "border-red-500",
    blue: "border-blue-500",
    green: "border-green-500",
    yellow: "border-yellow-400",
    purple: "border-purple-500",
    orange: "border-orange-400",
    pink: "border-pink-400",
    cyan: "border-cyan-400",
    lime: "border-lime-400",
    teal: "border-teal-400",
  };

  // Handle navigation based on game state
  useEffect(() => {
  if (!code || Number.isNaN(roundNum)) return;

  // Navigate to game over page
  if (gameState === "GAME_OVER" && lastGameSnapshot) {
    navigate(`/game/${lastGameSnapshot.code}/over`, { replace: true });
    return;
  }

  // Navigate to new round when round number changes
  if (
    lastGameSnapshot && 
    lastGameSnapshot.roundNumber !== roundNum &&
    (gameState === "ROUND_SUBMITTING" || gameState === "ROUND_VOTING")
  ) {
    console.log(`🔄 Round changed from ${roundNum} to ${lastGameSnapshot.roundNumber}, navigating...`);
    navigate(`/game/${code}/round/${lastGameSnapshot.roundNumber}`, { replace: true });
  }
  }, [code, roundNum, gameState, lastGameSnapshot, navigate]);

  // Auto-load voting submissions when entering voting phase
  useEffect(() => {
    if (gameState === "ROUND_VOTING" && votingSubmissions.length === 0 && !hasVoted) {
      loadVotingSubmissions();
    }
  }, [gameState]); // eslint-disable-line react-hooks/exhaustive-deps



  // Reset hasVoted and hasSubmitted when round changes
  useEffect(() => {
    setHasVoted(false);
    setHasSubmitted(false);
    setVotingSubmissions([]);
  }, [roundNum]);

  if (!code || Number.isNaN(roundNum)) {
    return <div className="p-4">Invalid round</div>;
  }

  const isSubmittingPhase = gameState === "ROUND_SUBMITTING";
  const isVotingPhase = gameState === "ROUND_VOTING";
  const isResultsPhase = gameState === "ROUND_RESULTS";

  // Get current round info from snapshot
  const currentRound = lastGameSnapshot?.rounds.find(
    (r) => r.roundNumber === roundNum
  );
  const targetAlias = currentRound?.targetAlias;
  const eliminatedPlayerIds = currentRound?.eliminatedPlayerIds || [];
  const eliminatedPlayers = lastGameSnapshot?.players.filter((p) =>
    eliminatedPlayerIds.includes(p.playerId)
  ) || [];

  // Countdown for the current phase (in ms)
  const [timeLeftMs, setTimeLeftMs] = useState<number | null>(null);

  useEffect(() => {
    // Update loop that follows currentRound.expiresAt
    if (!currentRound || !currentRound.expiresAt) {
      setTimeLeftMs(null);
      return;
    }

    // Capture expiresAt so the tick closure doesn't access `currentRound` directly (avoids TS 'possibly undefined')
    const expiresAt = currentRound.expiresAt;

    let mounted = true;
    function tick() {
      if (!mounted) return;
      const ms = (expiresAt ?? 0) - Date.now();
      setTimeLeftMs(ms > 0 ? ms : 0);
      if (ms > 0) {
        // schedule next tick nearer to real-time
        setTimeout(tick, 500);
      }
    }

    tick();
    return () => {
      mounted = false;
    };
  }, [currentRound?.expiresAt]);

  // Notify users when others submit or vote and update progress UI
  useEffect(() => {
    // Derive currentRound here (avoid referencing variable declared later)
    const r = lastGameSnapshot?.rounds.find((rr) => rr.roundNumber === roundNum);
    if (!r || !lastGameSnapshot) return;

    const submissionCount = r.submissions.length;
    const voteCount = r.votes.length;

    // Submissions progressed
    if (
      prevSubmissionCount != null &&
      submissionCount > prevSubmissionCount
    ) {
      const remaining = Math.max(0, r.participantIds.length - submissionCount);
      const msg = `${submissionCount} submitted • ${remaining} remaining`;
      setAnnounceMsg(msg);
      toast.success(msg);
    }

    // Votes progressed
    if (prevVoteCount != null && voteCount > prevVoteCount) {
      const remaining = Math.max(0, r.participantIds.length - voteCount);
      const msg = `${voteCount} votes cast • ${remaining} remaining`;
      setAnnounceMsg(msg);
      toast.success(msg);
    }

    setPrevSubmissionCount(submissionCount);
    setPrevVoteCount(voteCount);
  }, [lastGameSnapshot, roundNum, prevSubmissionCount, prevVoteCount]);

  const wasIEliminated = playerId && eliminatedPlayerIds.includes(playerId);
  const amIAlive = lastGameSnapshot?.players.find((p) => p.playerId === playerId)?.alive ?? true;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!playerId) {
      toast.error("Missing playerId");
      return;
    }
    if (!content.trim()) {
      toast.error("Write something first");
      return;
    }

    setSubmitting(true);
    socket.emit(
      "round:submit",
      {
        code,
        roundNumber: roundNum,
        playerId,
        content: content.trim(),
      },
      (res: SubmitResponse) => {
        setSubmitting(false);
        if (!res.ok) {
          toast.error(res.error ?? "Could not submit");
          return;
        }
        setContent("");
        setHasSubmitted(true);
        toast.success("Submission saved! Waiting for others...");
      }
    );
  };

  const loadVotingSubmissions = () => {
    setLoadingVoting(true);
    socket.emit(
      "round:getVoting",
      { code, roundNumber: roundNum },
      (res: VotingAck) => {
        setLoadingVoting(false);
        if (!res.ok || !res.votingRound) {
          toast.error(res.error ?? "Could not load voting options");
          return;
        }
        setVotingSubmissions(res.votingRound.submissions);
      }
    );
  };

  const handleVote = (submissionId: string) => {
    if (!playerId) {
      toast.error("Missing playerId");
      return;
    }

    if (hasVoted) {
      toast.error("You already voted this round");
      return;
    }

    socket.emit(
      "round:vote",
      { code, roundNumber: roundNum, submissionId, voterId: playerId },
      (res: VoteResponse) => {
        if (!res.ok) {
          toast.error(res.error ?? "Could not cast vote");
          return;
        }
        setHasVoted(true);
        toast.success("Vote recorded! Waiting for others...");
      }
    );
  };

  return (
    <div className="min-h-screen flex flex-col items-center py-10 bg-base-200 gap-6">
      <h1 className="text-2xl font-bold">
        Game {code} – Round {roundNum}
      </h1>

      {targetAlias && !isResultsPhase && (
        <div className="alert alert-info max-w-md">
          <span>Describe <strong>{targetAlias}</strong> in a short sentence.</span>
        </div>
      )}

      {timeLeftMs != null && (
        <div className="text-sm opacity-70">Time left: {Math.max(0, Math.ceil(timeLeftMs / 1000))}s</div>
      )}

      {/* RESULTS PHASE - Show who was eliminated */}
      {isResultsPhase && (
        <div className="w-full max-w-2xl flex flex-col items-center gap-6">
          {wasIEliminated ? (
            <div className="card bg-error text-error-content w-full">
              <div className="card-body items-center text-center">
                <h2 className="card-title text-3xl mb-4">You were eliminated! 💀</h2>
                <p className="text-lg">The others voted you out...</p>
                <p className="text-sm opacity-80 mt-4">
                  You can spectate the rest of the game
                </p>
              </div>
            </div>
          ) : (
            <div className="card bg-success text-success-content w-full">
              <div className="card-body items-center text-center">
                <h2 className="card-title text-3xl mb-4">Round {roundNum} Results</h2>
                {eliminatedPlayers.length > 0 ? (
                  <>
                    <p className="text-xl mb-4">Eliminated:</p>
                    <div className="flex flex-col gap-2">
                      {eliminatedPlayers.map((p) => (
                        <div key={p.playerId} className="flex items-center gap-3 justify-center text-lg">
                          <span className="badge badge-lg">{p.colorId}</span>
                          <span className="font-bold">{p.alias}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-xl">No one was eliminated (tie vote)</p>
                )}
                <p className="text-sm opacity-80 mt-4">
                  {amIAlive ? "Next round starting soon..." : "Spectating..."}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUBMISSION PHASE */}
      {isSubmittingPhase && amIAlive && (
        <div className="w-full max-w-md">
          {hasSubmitted ? (
            <div className="alert alert-success">
              <span>✓ Submission received! Waiting for other players...</span>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              {currentRound?.roundType === "IMAGE" ? (
                <div className="flex flex-col gap-2">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => {
                        if (typeof reader.result === "string") {
                          setContent(reader.result);
                        }
                      };
                      reader.readAsDataURL(file);
                    }}
                  />

                  {content && content.startsWith("data:") && (
                    <img src={content} alt="preview" className="max-h-48 w-full object-contain" />
                  )}
                </div>
              ) : (
                <textarea
                  className="textarea textarea-bordered w-full h-32"
                  placeholder="Write your submission..."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                />
              )}

              <button
                className="btn btn-primary w-full"
                aria-label="Submit your response"
                disabled={
                  submitting || (timeLeftMs !== null && timeLeftMs <= 0)
                }
              >
                {submitting ? "Submitting..." : "Submit"}
              </button>
            </form>
          )}
          <p className="text-sm opacity-70 mt-3 text-center">
            When everyone submits, voting will start automatically.
          </p>
          
          {currentRound && (
            <div className="mt-4 text-center">
              <p className="text-sm mb-2">
                Submissions: {currentRound.submissions.length} / {currentRound.participantIds.length}
              </p>

              {/* Progress bar */}
              <div className="w-full bg-base-300 rounded h-2" role="progressbar" aria-valuemin={0} aria-valuemax={currentRound.participantIds.length} aria-valuenow={currentRound.submissions.length} aria-label="Submission progress">
                <div
                  className="bg-primary h-2 rounded"
                  style={{ width: `${(currentRound.submissions.length / Math.max(1, currentRound.participantIds.length)) * 100}%` }}
                />
              </div>

              {/* Accessible announcement area */}
              <div className="sr-only" aria-live="polite">{announceMsg}</div>
            </div>
          )}
        </div>
      )}

      {/* Dead player waiting during submission */}
      {isSubmittingPhase && !amIAlive && (
        <div className="alert alert-warning max-w-md">
          <span>You are eliminated. Waiting for others to submit...</span>
        </div>
      )}

      {/* VOTING PHASE */}
      {isVotingPhase && amIAlive && (
        <div className="w-full max-w-2xl">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xl font-semibold">Vote for the impostor!</h2>
            <button
              className="btn btn-sm"
              onClick={loadVotingSubmissions}
              disabled={loadingVoting}
            >
              {loadingVoting ? "Loading..." : "Refresh"}
            </button>
          </div>

          {hasVoted && (
            <div className="alert alert-success mb-4">
              <span>✓ Your vote has been recorded</span>
            </div>
          )}

          {currentRound && (
            <div className="mb-4 text-center">
              <p className="text-sm mb-2 text-center opacity-70">
                Votes: {currentRound.votes.length} / {currentRound.participantIds.length}
              </p>

              <div className="w-full bg-base-300 rounded h-2" role="progressbar" aria-valuemin={0} aria-valuemax={currentRound.participantIds.length} aria-valuenow={currentRound.votes.length} aria-label="Voting progress">
                <div
                  className="bg-secondary h-2 rounded"
                  style={{ width: `${(currentRound.votes.length / Math.max(1, currentRound.participantIds.length)) * 100}%` }}
                />
              </div>
            </div>
          )}

          <div className="grid gap-3">
            {votingSubmissions.length === 0 ? (
              <p className="text-center opacity-70">No submissions to display</p>
            ) : (
              votingSubmissions.map((s) => (
                <button
                  key={s.submissionId}
                  className={`card bg-base-100 shadow p-4 text-left transition w-full border-2 ${
                    COLOR_BORDER[s.colorId] ?? "border-neutral"
                  } ${
                    hasVoted || (timeLeftMs !== null && timeLeftMs <= 0)
                      ? "opacity-50 cursor-not-allowed"
                      : "hover:bg-base-300 hover:shadow-lg"
                  }`}
                  type="button"
                  aria-label={`Vote for submission by color ${s.colorId}`}
                  onClick={() => handleVote(s.submissionId)}
                  disabled={hasVoted || (timeLeftMs !== null && timeLeftMs <= 0)}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="badge badge-lg">{s.colorId}</span>
                  </div>
                  <div>
                    {s.content.startsWith("data:") ? (
                      <img src={s.content} alt="submission" className="max-h-48 w-full object-contain" />
                    ) : (
                      <div className="text-base">{s.content}</div>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Dead player waiting during voting */}
      {isVotingPhase && !amIAlive && (
        <div className="alert alert-warning max-w-md">
          <span>You are eliminated. Waiting for others to vote...</span>
        </div>
      )}

      {!isSubmittingPhase && !isVotingPhase && !isResultsPhase && (
        <div className="text-center">
          <p className="opacity-70">Waiting for next phase…</p>
          <p className="text-sm opacity-50 mt-2">Current state: {gameState}</p>
        </div>
      )}
    </div>
  );
};

export default RoundPage;