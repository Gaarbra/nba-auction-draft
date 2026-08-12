import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { registerRoomHandlers } from "./sockets/roomHandlers.js";
import { getPlayers, getCacheInfo } from "./services/playerCache.js";
import { filterPlayersByEra, summarizeEras } from "./services/era.js";

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/players", async (req, res) => {
  try {
    const players = await getPlayers();
    let filtered = filterPlayersByEra(players, req.query.era);

    const search = (req.query.search || "").trim().toLowerCase();
    if (search) {
      filtered = filtered.filter((p) => p.fullName.toLowerCase().includes(search));
    }

    const totalCount = filtered.length;
    const limit = Math.min(Number(req.query.limit) || (search ? 25 : 100), 200);
    const limited = filtered.slice(0, limit);

    res.json({ players: limited, count: limited.length, totalCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/players/eras", async (req, res) => {
  try {
    const players = await getPlayers();
    res.json({ eras: summarizeEras(players) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/players/cache-info", async (req, res) => {
  res.json(await getCacheInfo());
});

app.post("/api/players/sync", async (req, res) => {
  try {
    const players = await getPlayers({ forceRefresh: true });
    res.json({ players, count: players.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
