import "dotenv/config";
import express from "express";
import { isAllowedSocketOrigin, socketSecurity } from "./middleware/socketSecurity.js";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { registerRoomHandlers } from "./sockets/roomHandlers.js";
import { getPlayers, getCacheInfo } from "./services/playerCache.js";
import { filterPlayersByEra, summarizeEras } from "./services/era.js";
import { httpRateLimit } from "./middleware/rateLimit.js";
import { initSchema } from "./services/db.js";
import {
  fetchPredictedPrice,
  fetchSimilarPlayers,
  fetchPhotoUrl,
  fetchPlayerAwards,
  fetchPlayerStats,
  fetchMarketIndex,
  fetchUsagePct,
  pingStatsService,
} from "./services/statsClient.js";

initSchema(); // no-op if DATABASE_URL isn't set, see db.js

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
// The expensive NBA sync endpoint stays disabled unless an admin token is set.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || null;

const app = express();

// Enable only behind one trusted proxy, with direct access to Node blocked.
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
if (TRUST_PROXY) app.set("trust proxy", 1);

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

app.use(cors({ origin: CLIENT_ORIGIN }));
app.disable("x-powered-by");
app.use(express.json({ limit: "8kb" }));

/** Logs the real error server-side always; only echoes it to the client outside production, where a generic message is safer than leaking internals. */
function handleApiError(err, req, res) {
  console.error(`[${req.method} ${req.path}] failed:`, err);
  res.status(500).json({ error: IS_PRODUCTION ? "Something went wrong." : err.message });
}

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/", httpRateLimit({ windowMs: 60_000, max: 60, message: "Too many requests, try again shortly." }));

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

// The Market tab's era/team/player pickers. See fetchMarketIndex's own
// comment for why this is safe to serve on Render (no live stats.nba.com
// call anywhere in this path).
app.get("/api/players/market-index", async (req, res) => {
  const players = await fetchMarketIndex();
  res.json({ players, count: players.length });
});

// Standalone per-player stats lookup for the Market tab, which browses a
// player outside any room/nomination. Everywhere else in the app this
// data only ever arrives bundled into a room's nomination payload.
app.get("/api/players/:id/stats", async (req, res) => {
  const result = await fetchPlayerStats(req.params.id);
  if (!result) return res.status(404).json({ error: "NO_STATS_AVAILABLE" });
  res.json(result);
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

// Both ML features: never a hard error for the client to handle. A missing
// model or a stats-service hiccup just means "no prediction/no similar
// players right now," not a broken page. See stats-service/ml.py.
app.get("/api/players/:id/predicted-price", async (req, res) => {
  const { predictedPrice, explanation } = await fetchPredictedPrice(req.params.id, {
    era: req.query.era,
    difficulty: req.query.difficulty,
    slot: req.query.slot,
  });
  res.json({ predictedPrice, explanation });
});

app.get("/api/players/:id/similar", async (req, res) => {
  const k = Math.min(10, Math.max(1, Number(req.query.k) || 5));
  const similar = await fetchSimilarPlayers(req.params.id, k);
  res.json({ similar });
});

app.get("/api/players/:id/usage-pct", async (req, res) => {
  res.json(await fetchUsagePct(req.params.id));
});

// Client-side retry target for a nomination that had no photo yet at
// reveal time. See PlayerHeadshot.jsx.
app.get("/api/players/:id/photo", async (req, res) => {
  const photoUrl = await fetchPhotoUrl(req.params.id);
  res.json({ photoUrl });
});

// Never a hard error: a missing/empty award list just means the reveal
// card's accolades strip renders nothing (see PlayerAccolades.jsx).
app.get("/api/players/:id/awards", async (req, res) => {
  const awards = await fetchPlayerAwards(req.params.id);
  res.json({ awards });
});

// Called once when the homepage loads (see App.jsx). Nudges stats-service
// awake early so its Render free-tier spin-down (see pingStatsService)
// mostly resolves before anyone's first roll, not during it. Responds
// immediately either way; the ping itself runs in the background.
app.get("/api/warm-stats-service", (req, res) => {
  pingStatsService();
  res.status(202).end();
});

app.post("/api/players/sync", async (req, res) => {
  if (!ADMIN_TOKEN || req.get("x-admin-token") !== ADMIN_TOKEN) {
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
  maxHttpBufferSize: 8192,
  allowRequest: (req, callback) => callback(null, isAllowedSocketOrigin(req.headers, CLIENT_ORIGIN)),
});

socketSecurity(io, { origin: CLIENT_ORIGIN, secret: process.env.TURNSTILE_SECRET_KEY, production: IS_PRODUCTION, trustProxy: TRUST_PROXY });

io.on("connection", (socket) => {
  registerRoomHandlers(io, socket);
});

httpServer.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
