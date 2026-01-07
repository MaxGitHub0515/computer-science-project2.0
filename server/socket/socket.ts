import { Server, Socket } from "socket.io";
import { randomUUID } from "crypto";
import logger from "../config/loggerWinston";

import type {
  Game,
  Player,
  PublicVotingRound,
  PublicVotingSubmission,
  Submission,
  AIMemory,
} from "../game/gameTypes";
import { assignColor } from "../game/colorPool";
import { createGame, getGame } from "../game/gameStore";
import {
  onSubmissionUpdated,
  onVotesUpdated,
  setEmitGameUpdateCallback,
  startRoundForGame,
} from "../game/gameService";
import { notifyAIsOfVote } from "../game/aiPlayer";

const socketToPlayer = new Map<string, { code: string; playerId: string }>();

function generateCode(): string {
  const letters = "ABCDEFGHJKMNPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < 4; i++) code += letters[Math.floor(Math.random() * letters.length)];
  return code;
}

function emitGameUpdate(io: Server, game: Game) {
  io.to(game.code).emit("game:update", game);
}

function desiredAICount(humanCount: number): number {
  if (humanCount <= 1) return 0;
  if (humanCount === 2) return 1;
  if (humanCount <= 4) return 2;
  return 3;
}

function makeEmptyMemory(): AIMemory {
  return { kickedPlayers: [], roundsSummary: [], notes: [] };
}

function normalizeOptString(s: string | undefined): string | undefined {
  const t = s?.trim();
  return t && t.length > 0 ? t : undefined;
}

function ensureAutoAIs(game: Game) {
  const humanCount = game.players.filter((p) => !p.isAI).length;
  const desired = desiredAICount(humanCount);

  const currentAIs = game.players.filter((p) => p.isAI);
  if (currentAIs.length > desired) {
    const toRemove = currentAIs.length - desired;
    for (let i = 0; i < toRemove; i++) {
      const idx = game.players.findIndex((p) => p.isAI);
      if (idx >= 0) game.players.splice(idx, 1);
    }
  }

  const nowAIs = game.players.filter((p) => p.isAI).length;
  const missing = desired - nowAIs;

  for (let i = 0; i < missing; i++) {
    const aiPlayerId = randomUUID();
    const colorId = assignColor(game);
    const aiIndex = game.players.filter((p) => p.isAI).length + 1;

    game.players.push({
      playerId: aiPlayerId,
      alias: `AI-${aiIndex}`,
      colorId,
      alive: true,
      connected: false,
      isAI: true,
      aiData: {
        teamId: "impostors",
        memory: makeEmptyMemory(),
      },
    });
  }
}

export function registerSocketHandlers(io: Server) {
  setEmitGameUpdateCallback((game: Game) => emitGameUpdate(io, game));

  io.on("connection", (socket: Socket) => {
    logger.info(`Socket connected: ${socket.id}`);

    socket.on("game:create", (payload: { alias?: string }, callback: (response: any) => void) => {
      try {
        const { alias } = payload;
        if (!alias) return callback({ ok: false, error: "alias is required" });

        const code = generateCode();
        const hostPlayerId = randomUUID();

        const emptyGame: Game = {
          code,
          state: "LOBBY",
          roundNumber: 0,
          hostPlayerId,
          players: [],
          rounds: [],
        };

        const colorId = assignColor(emptyGame);

        const hostPlayer: Player = {
          playerId: hostPlayerId,
          alias,
          colorId,
          alive: true,
          connected: true,
        };

        const game: Game = { ...emptyGame, players: [hostPlayer] };

        createGame(game);

        socket.join(code);
        socketToPlayer.set(socket.id, { code, playerId: hostPlayerId });
        logger.info(`Game created ${code} by ${alias} (${socket.id})`);

        callback({ ok: true, code, playerId: hostPlayerId, alias, colorId, host: true, game });
        emitGameUpdate(io, game);
      } catch (err) {
        logger.error("Error in game:create", err);
        callback({ ok: false, error: "Internal server error" });
      }
    });

    socket.on(
      "game:addAI",
      (
        payload: { code?: string; playerId?: string; alias?: string; teamId?: string; apiKey?: string },
        callback: (response: any) => void
      ) => {
        try {
          const code = payload.code?.toUpperCase();
          const { playerId, alias, teamId, apiKey } = payload;
          if (!code || !playerId) return callback({ ok: false, error: "code and playerId are required" });

          const game = getGame(code);
          if (!game) return callback({ ok: false, error: "Game not found" });

          if (playerId !== game.hostPlayerId) return callback({ ok: false, error: "Only host can add AI players" });

          const aiPlayerId = randomUUID();
          const colorId = assignColor(game);
          const aiAlias = alias ?? `AI-${colorId}`;

          const apiKeyNorm = normalizeOptString(apiKey);

          const aiPlayer: Player = {
            playerId: aiPlayerId,
            alias: aiAlias,
            colorId,
            alive: true,
            connected: false,
            isAI: true,
            aiData: {
              teamId: teamId ?? "impostors",
              ...(apiKeyNorm ? { apiKey: apiKeyNorm } : {}),
              memory: makeEmptyMemory(),
            },
          };

          game.players.push(aiPlayer);

          callback({ ok: true, game });
          emitGameUpdate(io, game);
        } catch (err) {
          logger.error("Error in game:addAI", err);
          callback({ ok: false, error: "Internal server error" });
        }
      }
    );

    socket.on("game:join", (payload: { code?: string; alias?: string }, callback: (response: any) => void) => {
      try {
        const code = payload.code?.toUpperCase();
        const { alias } = payload;
        if (!code || !alias) return callback({ ok: false, error: "code and alias are required" });

        const game = getGame(code);
        if (!game) return callback({ ok: false, error: "Game not found" });
        if (game.state !== "LOBBY") return callback({ ok: false, error: "Game already started" });

        const playerId = randomUUID();
        const colorId = assignColor(game);

        const player: Player = { playerId, alias, colorId, alive: true, connected: true };
        game.players.push(player);

        socket.join(code);
        socketToPlayer.set(socket.id, { code, playerId });
        logger.info(`Player ${alias} joined game ${code} (${socket.id})`);

        callback({ ok: true, code, playerId, alias, colorId, host: false, game });
        emitGameUpdate(io, game);
      } catch (err) {
        logger.error("Error in game:join", err);
        callback({ ok: false, error: "Internal server error" });
      }
    });

    socket.on(
      "game:start",
      (
        payload: { code?: string; playerId?: string; roundType?: "TEXT" | "IMAGE" },
        callback: (response: any) => void
      ) => {
        try {
          const code = payload.code?.toUpperCase();
          const { playerId, roundType } = payload;
          if (!code || !playerId) return callback({ ok: false, error: "code and playerId are required" });

          const game = getGame(code);
          if (!game) return callback({ ok: false, error: "Game not found" });

          if (playerId !== game.hostPlayerId) return callback({ ok: false, error: "Only host can start the game" });
          if (game.state !== "LOBBY") return callback({ ok: false, error: "Game is already in progress" });

          ensureAutoAIs(game);

          const humanCount = game.players.filter((p) => !p.isAI).length;
          if (humanCount < 2) return callback({ ok: false, error: "Need at least 2 human players to start" });
          if (game.players.length < 3) return callback({ ok: false, error: "Need at least 3 total players to start" });

          delete game.winner; // exactOptionalPropertyTypes-safe
          game.state = "IN_PROGRESS";
          game.roundNumber = 0;
          game.rounds = [];

          const round = startRoundForGame(game, roundType ?? "TEXT");
          if (!round) return callback({ ok: false, error: "Could not start first round" });

          callback({ ok: true, game, round });
          emitGameUpdate(io, game);
        } catch (err) {
          logger.error("Error in game:start", err);
          callback({ ok: false, error: "Internal server error" });
        }
      }
    );

    socket.on(
      "game:restart",
      (
        payload: { code?: string; playerId?: string; roundType?: "TEXT" | "IMAGE" },
        callback: (response: any) => void
      ) => {
        try {
          const code = payload.code?.toUpperCase();
          const { playerId, roundType } = payload;
          if (!code || !playerId) return callback({ ok: false, error: "code and playerId are required" });

          const game = getGame(code);
          if (!game) return callback({ ok: false, error: "Game not found" });

          if (game.state !== "GAME_OVER") return callback({ ok: false, error: "Game is not over; cannot restart yet" });
          if (playerId !== game.hostPlayerId) return callback({ ok: false, error: "Only host can restart the game" });

          for (const p of game.players) p.alive = true;

          ensureAutoAIs(game);

          game.rounds = [];
          game.roundNumber = 0;
          delete game.winner; // exactOptionalPropertyTypes-safe
          game.state = "IN_PROGRESS";

          const round = startRoundForGame(game, roundType ?? "TEXT");
          if (!round) return callback({ ok: false, error: "Could not start first round after restart" });

          callback({ ok: true, game, round });
          emitGameUpdate(io, game);
        } catch (err) {
          logger.error("Error in game:restart", err);
          callback({ ok: false, error: "Internal server error" });
        }
      }
    );

    socket.on(
      "round:submit",
      (
        payload: { code?: string; roundNumber?: number; playerId?: string; content?: string },
        callback: (response: any) => void
      ) => {
        try {
          const code = payload.code?.toUpperCase();
          const { roundNumber, playerId, content } = payload;
          if (!code || roundNumber == null || !playerId || !content) {
            return callback({ ok: false, error: "code, roundNumber, playerId, content are required" });
          }

          const game = getGame(code);
          if (!game) return callback({ ok: false, error: "Game not found" });

          const round = game.rounds.find((r) => r.roundNumber === Number(roundNumber));
          if (!round) return callback({ ok: false, error: "Round not found" });

          if (round.status !== "SUBMITTING") return callback({ ok: false, error: "Submissions are closed for this round" });

          const player = game.players.find((p) => p.playerId === playerId);
          if (!player || !player.alive) return callback({ ok: false, error: "Player is not alive in this game" });
          if (!round.participantIds.includes(playerId)) return callback({ ok: false, error: "Player is not in this round" });

          const hasAlreadySubmitted = round.submissions.some((s) => s.playerId === playerId);
          if (hasAlreadySubmitted) return callback({ ok: false, error: "You have already submitted for this round" });

          const submission: Submission = {
            submissionId: randomUUID(),
            playerId,
            content,
            roundNumber: Number(roundNumber),
          };

          round.submissions.push(submission);
          onSubmissionUpdated(game, round, submission);

          callback({ ok: true, submissionId: submission.submissionId, gameState: game.state, roundStatus: round.status });
          emitGameUpdate(io, game);
        } catch (err) {
          logger.error("Error in round:submit", err);
          callback({ ok: false, error: "Internal server error" });
        }
      }
    );

    socket.on("round:getVoting", (payload: { code?: string; roundNumber?: number }, callback: (response: any) => void) => {
      try {
        const code = payload.code?.toUpperCase();
        const { roundNumber } = payload;
        if (!code || roundNumber == null) return callback({ ok: false, error: "code and roundNumber are required" });

        const game = getGame(code);
        if (!game) return callback({ ok: false, error: "Game not found" });

        const round = game.rounds.find((r) => r.roundNumber === Number(roundNumber));
        if (!round) return callback({ ok: false, error: "Round not found" });

        const submissions: PublicVotingSubmission[] = round.submissions.map((s) => {
          const player = game.players.find((p) => p.playerId === s.playerId);
          return { submissionId: s.submissionId, colorId: player?.colorId ?? "unknown", content: s.content };
        });

        const votingRound: PublicVotingRound = { code: game.code, roundNumber: round.roundNumber, submissions };
        callback({ ok: true, votingRound });
      } catch (err) {
        logger.error("Error in round:getVoting", err);
        callback({ ok: false, error: "Internal server error" });
      }
    });

    socket.on(
      "round:vote",
      (payload: { code?: string; roundNumber?: number; submissionId?: string; voterId?: string }, callback: (response: any) => void) => {
        try {
          const code = payload.code?.toUpperCase();
          const { roundNumber, submissionId, voterId } = payload;

          if (!code || roundNumber == null || !submissionId || !voterId) {
            return callback({ ok: false, error: "code, roundNumber, submissionId, voterId are all required" });
          }

          const game = getGame(code);
          if (!game) return callback({ ok: false, error: "Game not found" });

          const round = game.rounds.find((r) => r.roundNumber === Number(roundNumber));
          if (!round) return callback({ ok: false, error: "Round not found" });

          if (round.status !== "VOTING") return callback({ ok: false, error: "Round is not in VOTING state" });

          const voter = game.players.find((p) => p.playerId === voterId);
          if (!voter || !voter.alive) return callback({ ok: false, error: "Voter is not alive in this game" });
          if (!round.participantIds.includes(voterId)) return callback({ ok: false, error: "Voter is not in this round" });

          const submission = round.submissions.find((s) => s.submissionId === submissionId);
          if (!submission) return callback({ ok: false, error: "Submission not found" });

          if (round.votes.some((v) => v.voterId === voterId)) return callback({ ok: false, error: "Player already voted this round" });

          const vote = { voterId, submissionId };
          round.votes.push(vote);

          try {
            notifyAIsOfVote(game, round, vote);
          } catch {}

          onVotesUpdated(game, round);

          callback({ ok: true, gameState: game.state, totalVotes: round.votes.length });
          emitGameUpdate(io, game);
        } catch (err) {
          logger.error("Error in round:vote", err);
          callback({ ok: false, error: "Internal server error" });
        }
      }
    );

    socket.on("game:get", (payload: { code?: string }, callback: (response: any) => void) => {
      try {
        const code = payload.code?.toUpperCase();
        if (!code) return callback({ ok: false, error: "code is required" });

        const game = getGame(code);
        if (!game) return callback({ ok: false, error: "Game not found" });

        callback({ ok: true, game });
      } catch (err) {
        logger.error("Error in game:get", err);
        callback({ ok: false, error: "Internal server error" });
      }
    });

    socket.on("game:reconnect", (payload: { code?: string; playerId?: string }, callback: (response: any) => void) => {
      try {
        const code = payload.code?.toUpperCase();
        const { playerId } = payload;
        if (!code || !playerId) return callback({ ok: false, error: "code and playerId are required" });

        const game = getGame(code);
        if (!game) return callback({ ok: false, error: "Game not found" });

        const player = game.players.find((p) => p.playerId === playerId);
        if (!player) return callback({ ok: false, error: "Player not found" });

        socket.join(code);
        socketToPlayer.set(socket.id, { code, playerId });
        player.connected = true;

        callback({
          ok: true,
          game,
          playerId: player.playerId,
          alias: player.alias,
          colorId: player.colorId,
          host: player.playerId === game.hostPlayerId,
        });

        emitGameUpdate(io, game);
      } catch (err) {
        logger.error("Error in game:reconnect", err);
        callback({ ok: false, error: "Internal server error" });
      }
    });

    socket.on("disconnect", () => {
      logger.info(`Socket disconnected: ${socket.id}`);

      const info = socketToPlayer.get(socket.id);
      if (!info) return;

      socketToPlayer.delete(socket.id);

      const game = getGame(info.code);
      if (!game) return;

      const player = game.players.find((p) => p.playerId === info.playerId);
      if (!player) return;

      player.connected = false;
      emitGameUpdate(io, game);
    });
  });
}
