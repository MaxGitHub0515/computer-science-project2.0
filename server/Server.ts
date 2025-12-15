// server/Server.ts
import express from "express";
import dotenv from "dotenv";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";

// Middleware imports 
import morganMiddleware from "./middleware/morganMiddleware";
import corsMiddleware from "./middleware/corsMiddleware";
import logger from "./config/loggerWinston";

// WebSocket handlers
import { registerSocketHandlers } from "./socket/socket";

dotenv.config({ path: ".env.local" });

const app = express();

// Built-in middleware 
app.use(express.json());
app.use(morganMiddleware);
app.use(corsMiddleware());

// (Optional) simple health check over HTTP
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// Create HTTP server + Socket.IO
const httpServer = createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: "*", // or your frontend URL: "http://localhost:3000"
    methods: ["GET", "POST"],
  },
});

// Register all socket events
registerSocketHandlers(io);

// Local Server only - not for production
const LOCAL_PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8001;

httpServer.listen(LOCAL_PORT, () => {
  logger.info(`HTTP+WS server running on http://localhost:${LOCAL_PORT}`);
});
