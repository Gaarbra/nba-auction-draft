import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "..", "..", "data");
const CACHE_FILE = path.join(CACHE_DIR, "starPlayers.json");
// The underlying data (award-tier lookups) only grows as more players get
// warmed, and doesn't change for a player once it's known -- same 24h
// reasoning as the other pool caches, just saving the round trip.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const STATS_SERVICE_URL = process.env.STATS_SERVICE_URL || "http://127.0.0.1:5001";

let memoryCache = null; // { fetchedAt, ids: number[] }
let inFlightRefresh = null;
let lastRefreshFailureAt = 0;
const REFRESH_RETRY_COOLDOWN_MS = 30 * 60 * 1000;

async function readCacheFile() {
  try {
    const raw = await readFile(CACHE_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

async function writeCacheFile(entry) {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(entry, null, 2), "utf-8");
}

function isFresh(entry) {
  return entry && Array.isArray(entry.ids) && Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

async function refreshCache() {
  // /star-players is a pure in-memory computation on the stats-service side
  // (no live nba.com call, no ON_RENDER guard needed there), so this fetch
  // itself is never doomed the way notable/top-team's can be -- a failure
  // here means stats-service is unreachable, not that stats.nba.com is.
  const res = await fetch(`${STATS_SERVICE_URL}/star-players`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`stats-service /star-players failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  const entry = { fetchedAt: Date.now(), ids: data.playerIds || [] };
  await writeCacheFile(entry);
  memoryCache = entry;
  return entry;
}

/**
 * The genuinely-selective-honors pool: MVP, All-NBA, a real All-Star
 * selection, and similar -- deliberately narrower than getNotablePlayerIds'
 * top-500-per-game-stat cutoff, which is broad enough to include players
 * who are "notable" without being what most people would call a star. See
 * stats-service/app.py's fetch_star_player_ids for the exact award list and
 * why "NBA Champion" doesn't count (every player on a title roster gets
 * that one, not just the stars).
 *
 * Same cache-first, never-throws shape as notablePlayers.js/
 * topTeamPlayers.js: a missing or stale list just means easy mode falls
 * back to the broader notable pool, not a broken roll.
 */
export async function getStarPlayerIds() {
  if (isFresh(memoryCache)) return memoryCache.ids;

  if (!memoryCache) {
    const fromDisk = await readCacheFile().catch(() => null);
    if (fromDisk) {
      memoryCache = fromDisk;
      if (isFresh(fromDisk)) return memoryCache.ids;
    }
  }

  if (memoryCache && Date.now() - lastRefreshFailureAt < REFRESH_RETRY_COOLDOWN_MS) {
    return memoryCache.ids;
  }

  if (!inFlightRefresh) {
    inFlightRefresh = refreshCache()
      .catch((err) => {
        console.warn(`[starPlayers] refresh failed, falling back: ${err.message}`);
        lastRefreshFailureAt = Date.now();
        // Must assign, not just return a fallback value -- see
        // topTeamPlayers.js for the real production bug this exact shape
        // of mistake caused (every roll re-paying a doomed fetch instead of
        // the cooldown actually engaging).
        memoryCache = memoryCache || { fetchedAt: 0, ids: [] };
        return memoryCache;
      })
      .finally(() => {
        inFlightRefresh = null;
      });
  }

  const entry = await inFlightRefresh;
  return entry.ids;
}
