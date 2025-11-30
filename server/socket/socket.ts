// server/socket/socket.ts
import { Server, Socket } from "socket.io";
import { randomUUID } from "crypto";
import logger from "../config/loggerWinston";

import type {
  Game,
  Player,
  Round,
  PublicVotingRound,
  PublicVotingSubmission,
} from "../game/gameTypes";
import { assignColor } from "../game/colorPool";
import { createGame, getGame } from "../game/gameStore";
import { onSubmissionUpdated, onVotesUpdated, setEmitGameUpdateCallback } from "../game/gameService";

// map socket.id -> { code, playerId }
const socketToPlayer = new Map<string, { code: string; playerId: string }>();

/**
 * Generate a 4-letter lobby code (e.g. "ABCD")
 */
function generateCode(): string {
  const letters = "ABCDEFGHJKMNPQRSTUVWXYZ"; // avoid confusing letters
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += letters[Math.floor(Math.random() * letters.length)];
  }
  return code;
}

/**
 * Helper to start a new round with all currently alive players.
 * Used by:
 *  - game:start (auto first round)
 *  - game:restart (fresh game after GAME_OVER)
 */
function startRoundForGame(
  game: Game,
  roundType: "TEXT" | "IMAGE" = "TEXT"
): Round | null {
  const alivePlayers = game.players.filter((p) => p.alive);
  if (alivePlayers.length === 0) {
    return null;
  }

  const nextRoundNumber = game.roundNumber + 1;

  // Simple target selection: randomly pick one alive player
  const targetPlayer =
    alivePlayers[Math.floor(Math.random() * alivePlayers.length)];

  const round: Round = {
    roundNumber: nextRoundNumber,
    roundType,
    targetAlias: targetPlayer.alias,
    status: "SUBMITTING",
    submissions: [],
    votes: [],
    participantIds: alivePlayers.map((p) => p.playerId),
    eliminatedPlayerIds: [],
  };

  game.roundNumber = nextRoundNumber;
  game.rounds.push(round);
  game.state = "ROUND_SUBMITTING";

  return round;
}

/**
 * Broadcast game state to everyone in the game room.
 */
function emitGameUpdate(io: Server, game: Game) {
  io.to(game.code).emit("game:update", game);
}

export function registerSocketHandlers(io: Server) {
  // Register the callback so gameService can emit updates after timer
  setEmitGameUpdateCallback((game: Game) => {
    emitGameUpdate(io, game);
  });

  io.on("connection", (socket: Socket) => {
    logger.info(`Socket connected: ${socket.id}`);

    //
    // game:create
    // payload: { alias: string }
    // ack: { ok, error?, game?, playerId?, colorId?, code? }
    //
    socket.on(
      "game:create",
      (
        payload: { alias?: string },
        callback: (response: any) => void
      ) => {
        try {
          const { alias } = payload;
          if (!alias) {
            return callback({ ok: false, error: "alias is required" });
          }

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

          const game: Game = {
            ...emptyGame,
            players: [hostPlayer],
          };

          createGame(game);

          // host joins socket room for this game
          socket.join(code);
          socketToPlayer.set(socket.id, { code, playerId: hostPlayerId });
          logger.info(`Game created ${code} by ${alias} (${socket.id})`);

          callback({
            ok: true,
            code,
            playerId: hostPlayerId,
            alias,
            colorId,
            host: true,
            game,
          });

          emitGameUpdate(io, game);

        } catch (err) {
          logger.error("Error in game:create", err);
          callback({ ok: false, error: "Internal server error" });
        }
      }
    );

    //
    // game:join
    // payload: { code: string, alias: string }
    // ack: { ok, error?, game?, playerId?, colorId? }
    //
    socket.on(
      "game:join",
      (
        payload: { code?: string; alias?: string },
        callback: (response: any) => void
      ) => {
        try {
          const code = payload.code?.toUpperCase();
          const { alias } = payload;
          if (!code || !alias) {
            return callback({
              ok: false,
              error: "code and alias are required",
            });
          }

          const game = getGame(code);
          if (!game) {
            return callback({ ok: false, error: "Game not found" });
          }
          if (game.state !== "LOBBY") {
            return callback({ ok: false, error: "Game already started" });
          }

          const playerId = randomUUID();
          const colorId = assignColor(game);

          const player: Player = {
            playerId,
            alias,
            colorId,
            alive: true,
            connected: true,
          };

          game.players.push(player);

          socket.join(code);
          socketToPlayer.set(socket.id, { code, playerId });
          logger.info(`Player ${alias} joined game ${code} (${socket.id})`);

          callback({
            ok: true,
            code,
            playerId,
            alias,
            colorId,
            host: false,
            game,
          });

          emitGameUpdate(io, game);
        } catch (err) {
          logger.error("Error in game:join", err);
          callback({ ok: false, error: "Internal server error" });
        }
      }
    );

    //
    // game:start
    // payload: { code: string, playerId: string, roundType?: "TEXT" | "IMAGE" }
    //
    socket.on(
      "game:start",
      (
        payload: { code?: string; playerId?: string; roundType?: "TEXT" | "IMAGE" },
        callback: (response: any) => void
      ) => {
        try {
          const code = payload.code?.toUpperCase();
          const { playerId, roundType } = payload;
          if (!code || !playerId) {
            return callback({
              ok: false,
              error: "code and playerId are required",
            });
          }

          const game = getGame(code);
          if (!game) {
            return callback({ ok: false, error: "Game not found" });
          }

          if (playerId !== game.hostPlayerId) {
            return callback({
              ok: false,
              error: "Only host can start the game",
            });
          }

          if (game.state !== "LOBBY") {
            return callback({
              ok: false,
              error: "Game is already in progress",
            });
          }

          if (game.players.length < 3) {
            return callback({
              ok: false,
              error: "Need at least 3 players to start",
            });
          }

          game.state = "IN_PROGRESS";
          game.roundNumber = 0;

          const round = startRoundForGame(game, roundType ?? "TEXT");
          if (!round) {
            return callback({
              ok: false,
              error: "Could not start first round",
            });
          }

          callback({ ok: true, game, round });
          emitGameUpdate(io, game);
        } catch (err) {
          logger.error("Error in game:start", err);
          callback({ ok: false, error: "Internal server error" });
        }
      }
    );

    //
    // game:restart
    // payload: { code: string, playerId: string, roundType?: "TEXT" | "IMAGE" }
    //
    socket.on(
      "game:restart",
      (
        payload: { code?: string; playerId?: string; roundType?: "TEXT" | "IMAGE" },
        callback: (response: any) => void
      ) => {
        try {
          const code = payload.code?.toUpperCase();
          const { playerId, roundType } = payload;
          if (!code || !playerId) {
            return callback({
              ok: false,
              error: "code and playerId are required",
            });
          }

          const game = getGame(code);
          if (!game) {
            return callback({ ok: false, error: "Game not found" });
          }

          if (game.state !== "GAME_OVER") {
            return callback({
              ok: false,
              error: "Game is not over; cannot restart yet",
            });
          }

          if (playerId !== game.hostPlayerId) {
            return callback({
              ok: false,
              error: "Only host can restart the game",
            });
          }

          // resurrect players
          for (const p of game.players) {
            p.alive = true;
          }

          game.rounds = [];
          game.roundNumber = 0;
          game.state = "IN_PROGRESS";

          const round = startRoundForGame(game, roundType ?? "TEXT");
          if (!round) {
            return callback({
              ok: false,
              error: "Could not start first round after restart",
            });
          }

          callback({ ok: true, game, round });
          emitGameUpdate(io, game);
        } catch (err) {
          logger.error("Error in game:restart", err);
          callback({ ok: false, error: "Internal server error" });
        }
      }
    );

    //
    // round:submit
    // payload: { code, roundNumber, playerId, content }
    //
    socket.on(
      "round:submit",
      (
        payload: {
          code?: string;
          roundNumber?: number;
          playerId?: string;
          content?: string;
        },
        callback: (response: any) => void
      ) => {
        try {
          const code = payload.code?.toUpperCase();
          const { roundNumber, playerId, content } = payload;

          if (!code || roundNumber == null || !playerId || !content) {
            return callback({
              ok: false,
              error: "code, roundNumber, playerId, content are required",
            });
          }

          const game = getGame(code);
          if (!game) return callback({ ok: false, error: "Game not found" });

          const round = game.rounds.find(
            (r) => r.roundNumber === Number(roundNumber)
          );
          if (!round) return callback({ ok: false, error: "Round not found" });

          if (round.status !== "SUBMITTING") {
            return callback({
              ok: false,
              error: "Submissions are closed for this round",
            });
          }

          const player = game.players.find((p) => p.playerId === playerId);
          if (!player || !player.alive) {
            return callback({
              ok: false,
              error: "Player is not alive in this game",
            });
          }
          if (!round.participantIds.includes(playerId)) {
            return callback({
              ok: false,
              error: "Player is not in this round",
            });
          }

          // Check for duplicate submission
          const hasAlreadySubmitted = round.submissions.some(
            (s) => s.playerId === playerId
          );
          if (hasAlreadySubmitted) {
            return callback({
              ok: false,
              error: "You have already submitted for this round",
            });
          }

          const submissionId = randomUUID();
          round.submissions.push({
            submissionId,
            playerId,
            content,
            roundNumber: Number(roundNumber),
          });

          onSubmissionUpdated(game, round);

          callback({
            ok: true,
            submissionId,
            gameState: game.state,
            roundStatus: round.status,
          });

          emitGameUpdate(io, game);
        } catch (err) {
          logger.error("Error in round:submit", err);
          callback({ ok: false, error: "Internal server error" });
        }
      }
    );

    //
    // round:getVoting
    // payload: { code, roundNumber }
    // ack: { ok, error?, votingRound? }
    //
    socket.on(
      "round:getVoting",
      (
        payload: { code?: string; roundNumber?: number },
        callback: (response: any) => void
      ) => {
        try {
          const code = payload.code?.toUpperCase();
          const { roundNumber } = payload;
          if (!code || roundNumber == null) {
            return callback({
              ok: false,
              error: "code and roundNumber are required",
            });
          }

          const game = getGame(code);
          if (!game) return callback({ ok: false, error: "Game not found" });

          const round = game.rounds.find(
            (r) => r.roundNumber === Number(roundNumber)
          );
          if (!round) return callback({ ok: false, error: "Round not found" });

          const submissions: PublicVotingSubmission[] = round.submissions.map(
            (s) => {
              const player = game.players.find(
                (p) => p.playerId === s.playerId
              );
              const colorId = player?.colorId ?? "unknown";
              return {
                submissionId: s.submissionId,
                colorId,
                content: s.content,
              };
            }
          );

          const votingRound: PublicVotingRound = {
            code: game.code,
            roundNumber: round.roundNumber,
            submissions,
          };

          callback({ ok: true, votingRound });
        } catch (err) {
          logger.error("Error in round:getVoting", err);
          callback({ ok: false, error: "Internal server error" });
        }
      }
    );

    //
    // round:vote
    // payload: { code, roundNumber, submissionId, voterId }
    //
    socket.on(
      "round:vote",
      (
        payload: {
          code?: string;
          roundNumber?: number;
          submissionId?: string;
          voterId?: string;
        },
        callback: (response: any) => void
      ) => {
        try {
          const code = payload.code?.toUpperCase();
          const { roundNumber, submissionId, voterId } = payload;

          if (!code || roundNumber == null || !submissionId || !voterId) {
            return callback({
              ok: false,
              error:
                "code, roundNumber, submissionId, voterId are all required",
            });
          }

          const game = getGame(code);
          if (!game) return callback({ ok: false, error: "Game not found" });

          const round = game.rounds.find(
            (r) => r.roundNumber === Number(roundNumber)
          );
          if (!round) return callback({ ok: false, error: "Round not found" });

          if (round.status !== "VOTING") {
            return callback({
              ok: false,
              error: "Round is not in VOTING state",
            });
          }

          const voter = game.players.find((p) => p.playerId === voterId);
          if (!voter || !voter.alive) {
            return callback({
              ok: false,
              error: "Voter is not alive in this game",
            });
          }
          if (!round.participantIds.includes(voterId)) {
            return callback({
              ok: false,
              error: "Voter is not in this round",
            });
          }

          const submission = round.submissions.find(
            (s) => s.submissionId === submissionId
          );
          if (!submission) {
            return callback({ ok: false, error: "Submission not found" });
          }

          if (round.votes.some((v) => v.voterId === voterId)) {
            return callback({
              ok: false,
              error: "Player already voted this round",
            });
          }

          round.votes.push({ voterId, submissionId });

          onVotesUpdated(game, round);

          callback({
            ok: true,
            gameState: game.state,
            totalVotes: round.votes.length,
          });

          emitGameUpdate(io, game);
        } catch (err) {
          logger.error("Error in round:vote", err);
          callback({ ok: false, error: "Internal server error" });
        }
      }
    );

    //
    // game:get
    // payload: { code: string }
    // ack: { ok, error?, game? }
    //
    socket.on(
      "game:get",
      (
        payload: { code?: string },
        callback: (response: any) => void
      ) => {
        try {
          const code = payload.code?.toUpperCase();
          if (!code) {
            return callback({ ok: false, error: "code is required" });
          }

          const game = getGame(code);
          if (!game) {
            return callback({ ok: false, error: "Game not found" });
          }

          callback({ ok: true, game });
        } catch (err) {
          logger.error("Error in game:get", err);
          callback({ ok: false, error: "Internal server error" });
        }
      }
    );

    //
    // disconnect handler
    //
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