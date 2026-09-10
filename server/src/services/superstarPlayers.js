import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "..", "..", "data");
const CACHE_FILE = path.join(CACHE_DIR, "superstarPlayers.json");
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
  // Like /star-players, a pure in-memory computation on the stats-service
  // side -- a failure here means stats-service is unreachable, not
  // stats.nba.com.
  const res = await fetch(`${STATS_SERVICE_URL}/superstar-players`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`stats-service /superstar-players failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  const entry = { fetchedAt: Date.now(), ids: data.playerIds || [] };
  await writeCacheFile(entry);
  memoryCache = entry;
  return entry;
}

/**
 * The tightest pool: MVPs and perennial-elite players only (see
 * stats-service/app.py's fetch_superstar_player_ids). Feeds the "superstars
 * only" difficulty. Same cache-first, never-throws shape as
 * starPlayers.js -- a missing or stale list just drops "superstars only"
 * back to the broader star pool for that draft, not a broken roll.
 */
export async function getSuperstarPlayerIds() {
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
        console.warn(`[superstarPlayers] refresh failed, falling back: ${err.message}`);
        lastRefreshFailureAt = Date.now();
        // Assign, don't just return -- see topTeamPlayers.js for the real
        // production bug this exact shape of mistake caused.
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
