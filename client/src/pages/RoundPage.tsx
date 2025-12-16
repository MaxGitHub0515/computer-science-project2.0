// src/pages/RoundPage.tsx
import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { motion, AnimatePresence } from "framer-motion";

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

// 🎨 Renk badge ve dot stilleri (sadece UI)
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

const RoundPage = () => {
  const { code, roundNumber } = useParams<{ code: string; roundNumber: string }>();
  const navigate = useNavigate();

  // Use separate selectors for better performance
  const playerId = useGameStore((s) => s.playerId);
  const gameState = useGameStore((s) => s.gameState);
  const lastGameSnapshot = useGameStore((s) => s.lastGameSnapshot);

  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [votingSubmissions, setVotingSubmissions] =
    useState<PublicVotingSubmission[]>([]);
  const [loadingVoting, setLoadingVoting] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const roundNum = roundNumber ? Number(roundNumber) : NaN;

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
      console.log(
        ` Round changed from ${roundNum} to ${lastGameSnapshot.roundNumber}, navigating...`
      );
      navigate(`/game/${code}/round/${lastGameSnapshot.roundNumber}`, {
        replace: true,
      });
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
  const eliminatedPlayers =
    lastGameSnapshot?.players.filter((p) =>
      eliminatedPlayerIds.includes(p.playerId)
    ) || [];

  const wasIEliminated = playerId && eliminatedPlayerIds.includes(playerId);
  const amIAlive =
    lastGameSnapshot?.players.find((p) => p.playerId === playerId)?.alive ?? true;

  // 🔎 HOST Name
  const hostPlayer =
    lastGameSnapshot?.players.find(
      (p) =>
        (p as any).host === true ||
        (p as any).isHost === true ||
        (p as any).role === "HOST"
    ) ?? null;

  const myPlayer = lastGameSnapshot?.players.find(
    (p) => p.playerId === playerId
  );

  const hostAlias = hostPlayer?.alias ?? myPlayer?.alias ?? "Host";

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

  // UI & motion
  return (
    <motion.div
      className="relative min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-4 text-slate-50"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Glow background blobs */}
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
        className="relative z-10 w-full max-w-3xl rounded-3xl border border-white/10 bg-slate-900/80 backdrop-blur-xl shadow-2xl p-6 md:p-8 flex flex-col gap-6"
        initial={{ opacity: 0, y: 25, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
      >
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            {/* Game + host name */}
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
              Game{" "}
              <span className="bg-gradient-to-r from-indigo-400 to-fuchsia-400 bg-clip-text text-transparent">
                {hostAlias}
              </span>
            </h1>
            <p className="text-sm text-slate-400">
              Round <span className="font-semibold">{roundNum}</span>
            </p>
          </div>

          {/* Mode pill */}
          <div className="flex items-center md:items-end justify-end">
            <span className="px-4 py-1 rounded-full bg-slate-800/90 border border-slate-600/70 text-xs md:text-sm text-slate-200">
              Mode: <span className="font-semibold">Elimination</span>
            </span>
          </div>
        </div>

        {/* Target player */}
        <AnimatePresence>
          {targetAlias && !isResultsPhase && (
            <motion.div
              key="target-pill"
              className="flex justify-center"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
            >
              <div className="px-4 py-1 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-200 text-sm">
                Target player: <strong>{targetAlias}</strong>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* RESULTS PHASE */}
        <AnimatePresence>
          {isResultsPhase && (
            <motion.div
              key="results"
              className="w-full flex flex-col items-center gap-6"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
            >
              {wasIEliminated ? (
                <motion.div
                  className="w-full rounded-2xl bg-red-600/20 border border-red-500/50 text-red-50"
                  initial={{ scale: 0.97, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                >
                  <div className="p-6 text-center space-y-3">
                    <h2 className="text-3xl font-bold">You were eliminated! 💀</h2>
                    <p className="text-lg">The others voted you out...</p>
                    <p className="text-sm opacity-80">
                      You can spectate the rest of the game.
                    </p>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  className="w-full rounded-2xl bg-emerald-600/20 border border-emerald-500/50 text-emerald-50"
                  initial={{ scale: 0.97, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                >
                  <div className="p-6 text-center space-y-4">
                    <h2 className="text-3xl font-bold">
                      Round {roundNum} Results
                    </h2>
                    {eliminatedPlayers.length > 0 ? (
                      <>
                        <p className="text-xl">Eliminated:</p>
                        <div className="flex flex-col gap-2 items-center">
                          {eliminatedPlayers.map((p) => (
                            <div
                              key={p.playerId}
                              className="flex items-center gap-3 text-lg"
                            >
                              <div
                                className={`h-3 w-3 rounded-full ${
                                  COLOR_DOT[p.colorId] ?? "bg-slate-300"
                                }`}
                              />
                              <span
                                className={`px-2 py-1 rounded-md text-xs font-semibold ${
                                  COLOR_BADGES[p.colorId] ??
                                  "bg-slate-500/70 text-white"
                                }`}
                              >
                                {p.colorId}
                              </span>
                              <span className="font-bold">{p.alias}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className="text-xl">
                        No one was eliminated (tie vote)
                      </p>
                    )}
                    <p className="text-sm opacity-80">
                      {amIAlive
                        ? "Next round starting soon..."
                        : "Spectating..."}
                    </p>
                  </div>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* SUBMISSION PHASE */}
        <AnimatePresence>
          {isSubmittingPhase && amIAlive && (
            <motion.div
              key="submit-phase"
              className="w-full rounded-2xl bg-slate-900/80 border border-slate-700/70 p-5 space-y-4"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              {hasSubmitted ? (
                <div className="alert alert-success bg-emerald-600/20 border-emerald-500/60 text-emerald-50">
                  <span>
                    ✓ Submission received! Waiting for other players...
                  </span>
                </div>
              ) : (
                <form
                  onSubmit={handleSubmit}
                  className="flex flex-col gap-3"
                >
                  <textarea
                    className="textarea textarea-bordered w-full h-32 bg-slate-900/80 border-slate-700 text-slate-100"
                    placeholder="Write your submission..."
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                  />
                  <motion.button
                    className="btn btn-primary border-none bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-white"
                    disabled={submitting}
                    type="submit"
                    whileHover={
                      submitting ? {} : { scale: 1.02, y: -1 }
                    }
                    whileTap={
                      submitting ? {} : { scale: 0.97, y: 0 }
                    }
                  >
                    {submitting ? "Submitting..." : "Submit"}
                  </motion.button>
                </form>
              )}

              <p className="text-sm opacity-70 text-center">
                When everyone submits, voting will start automatically.
              </p>

              {currentRound && (
                <div className="mt-2 text-center text-sm text-slate-400">
                  Submissions: {currentRound.submissions.length} /{" "}
                  {currentRound.participantIds.length}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Dead player waiting during submission */}
        <AnimatePresence>
          {isSubmittingPhase && !amIAlive && (
            <motion.div
              key="submit-dead"
              className="alert alert-warning max-w-md mx-auto bg-amber-500/15 border border-amber-500/50 text-amber-100"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              <span>You are eliminated. Waiting for others to submit...</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* VOTING PHASE */}
        <AnimatePresence>
          {isVotingPhase && amIAlive && (
            <motion.div
              key="voting-phase"
              className="w-full rounded-2xl bg-slate-900/80 border border-slate-700/70 p-5 space-y-4"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-xl font-semibold">
                  Vote for the impostor!
                </h2>
                <motion.button
                  className="btn btn-sm border-none bg-slate-800 text-slate-100"
                  onClick={loadVotingSubmissions}
                  disabled={loadingVoting}
                  whileHover={
                    loadingVoting ? {} : { scale: 1.05, y: -1 }
                  }
                  whileTap={
                    loadingVoting ? {} : { scale: 0.96, y: 0 }
                  }
                >
                  {loadingVoting ? "Loading..." : "Refresh"}
                </motion.button>
              </div>

              {hasVoted && (
                <div className="alert alert-success mb-2 bg-emerald-600/20 border-emerald-500/60 text-emerald-50">
                  <span>✓ Your vote has been recorded</span>
                </div>
              )}

              {currentRound && (
                <p className="text-sm mb-2 text-center opacity-70">
                  Votes: {currentRound.votes.length} /{" "}
                  {currentRound.participantIds.length}
                </p>
              )}

              <div className="grid gap-3">
                {votingSubmissions.length === 0 ? (
                  <p className="text-center opacity-70">
                    No submissions to display
                  </p>
                ) : (
                  votingSubmissions.map((s) => (
                    <motion.button
                      key={s.submissionId}
                      type="button"
                      className={`text-left rounded-2xl px-4 py-3 bg-slate-800/90 border border-slate-700/80 shadow-sm ${
                        hasVoted
                          ? "opacity-50 cursor-not-allowed"
                          : "hover:border-fuchsia-500/60"
                      }`}
                      onClick={() => handleVote(s.submissionId)}
                      disabled={hasVoted}
                      whileHover={
                        hasVoted ? {} : { scale: 1.01, y: -1 }
                      }
                      whileTap={
                        hasVoted ? {} : { scale: 0.98, y: 0 }
                      }
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <div
                          className={`h-3 w-3 rounded-full ${
                            COLOR_DOT[s.colorId] ?? "bg-slate-400"
                          }`}
                        />
                        <span
                          className={`px-2 py-1 rounded-md text-xs font-semibold ${
                            COLOR_BADGES[s.colorId] ??
                            "bg-slate-500/70 text-white"
                          }`}
                        >
                          {s.colorId}
                        </span>
                      </div>
                      <div className="text-sm text-slate-100">
                        {s.content}
                      </div>
                    </motion.button>
                  ))
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Dead player waiting during voting */}
        <AnimatePresence>
          {isVotingPhase && !amIAlive && (
            <motion.div
              key="voting-dead"
              className="alert alert-warning max-w-md mx-auto bg-amber-500/15 border border-amber-500/50 text-amber-100"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              <span>You are eliminated. Waiting for others to vote...</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Waiting state */}
        <AnimatePresence>
          {!isSubmittingPhase && !isVotingPhase && !isResultsPhase && (
            <motion.div
              key="waiting"
              className="text-center text-sm text-slate-400"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.9 }}
              exit={{ opacity: 0 }}
            >
              <p>Waiting for next phase…</p>
              <p className="text-xs opacity-60 mt-1">
                Current state: {gameState}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
};

export default RoundPage;
