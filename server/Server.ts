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
const PORT = process.env.PORT || 5000;

// Listen on all interfaces, not just localhost
httpServer.listen(PORT, "0.0.0.0", () => {
  logger.info(`HTTP+WS server running on http://0.0.0.0:${PORT}`);
});
