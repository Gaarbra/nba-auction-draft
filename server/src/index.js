import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { registerRoomHandlers } from "./sockets/roomHandlers.js";
import { getPlayers, getCacheInfo } from "./services/playerCache.js";
import { filterPlayersByEra, summarizeEras } from "./services/era.js";
import { httpRateLimit } from "./middleware/rateLimit.js";
import { initSchema } from "./services/db.js";
import { fetchPredictedPrice, fetchSimilarPlayers } from "./services/statsClient.js";

initSchema(); // no-op if DATABASE_URL isn't set — see db.js

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
// Set this in production to keep /api/players/sync (an expensive, real
// nba_api-hitting call) from being publicly triggerable by anyone who finds
// the URL. Left unset, it stays open for local dev convenience.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || null;

const app = express();

// Running behind a hosting platform's reverse proxy (Render, Railway, etc.)
// — without this, req.ip is the proxy's address, which would make the
// per-IP rate limits below useless (everyone shares one bucket).
if (IS_PRODUCTION) app.set("trust proxy", 1);

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

/** Logs the real error server-side always; only echoes it to the client outside production, where a generic message is safer than leaking internals. */
function handleApiError(err, req, res) {
  console.error(`[${req.method} ${req.path}] failed:`, err);
  res.status(500).json({ error: IS_PRODUCTION ? "Something went wrong." : err.message });
}

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/", httpRateLimit({ windowMs: 60_000, max: 60, message: "Too many requests — try again shortly." }));

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
    handleApiError(err, req, res);
  }
});

app.get("/api/players/eras", async (req, res) => {
  try {
    const players = await getPlayers();
    res.json({ eras: summarizeEras(players) });
  } catch (err) {
    handleApiError(err, req, res);
  }
});

app.get("/api/players/cache-info", async (req, res) => {
  res.json(await getCacheInfo());
});

// Both ML features: never a hard error for the client to handle — a missing
// model or a stats-service hiccup just means "no prediction/no similar
// players right now", not a broken page. See stats-service/ml.py.
app.get("/api/players/:id/predicted-price", async (req, res) => {
  const predictedPrice = await fetchPredictedPrice(req.params.id, {
    era: req.query.era,
    difficulty: req.query.difficulty,
    slot: req.query.slot,
  });
  res.json({ predictedPrice });
});

app.get("/api/players/:id/similar", async (req, res) => {
  const k = Math.min(10, Math.max(1, Number(req.query.k) || 5));
  const similar = await fetchSimilarPlayers(req.params.id, k);
  res.json({ similar });
});

app.post("/api/players/sync", async (req, res) => {
  if (ADMIN_TOKEN && req.get("x-admin-token") !== ADMIN_TOKEN) {
    return res.status(404).end();
  }
  try {
    const players = await getPlayers({ forceRefresh: true });
    res.json({ players, count: players.length });
  } catch (err) {
    handleApiError(err, req, res);
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
