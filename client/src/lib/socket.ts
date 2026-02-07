// src/lib/socket.ts
import { io, Socket } from "socket.io-client";

// const BACKEND_PORT = 8001; local development only

// const SERVER_URL =
//   (typeof process !== "undefined" && process.env.SERVER_URL) ||
//   `${window.location.protocol}//${window.location.hostname}`;
const SERVER_URL = process.env.SERVER_URL!;

export const socket: Socket = io(SERVER_URL, {
  autoConnect: true,
  transports: ["websocket"],
});

socket.on("connect", () => {
  console.log("socket connected", socket.id);
});

socket.on("connect_error", (err) => {
  console.error("socket connect_error", err);
});
