import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { registerRoomHandlers } from "./sockets/roomHandlers.js";

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: CLIENT_ORIGIN },
});

io.on("connection", (socket) => {
  registerRoomHandlers(io, socket);
});

httpServer.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
