import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "..", "..", "data");
const CACHE_FILE = path.join(CACHE_DIR, "topTeamPlayers.json");
// Standings shift some game to game, not hour to hour -- matches
// stats-service's own TOP_TEAM_CACHE_TTL_SECONDS, so this Node-side cache
// never goes stale-relative-to-source, it just saves the round trip.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const STATS_SERVICE_URL = process.env.STATS_SERVICE_URL || "http://127.0.0.1:5001";

let memoryCache = null; // { fetchedAt, teamAbbreviation, ids: number[] }
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
  const res = await fetch(`${STATS_SERVICE_URL}/top-team-players`, {
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    throw new Error(`stats-service /top-team-players failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  const entry = { fetchedAt: Date.now(), teamAbbreviation: data.teamAbbreviation || null, ids: data.playerIds || [] };
  await writeCacheFile(entry);
  memoryCache = entry;
  return entry;
}

/**
 * This season's #1 team by record, and its current roster -- a second,
 * complementary "easy mode" pool alongside getNotablePlayerIds' all-time
 * per-game leaders. That one is career-quality-based, so it never catches
 * a breakout player on a great team this season who hasn't built enough
 * of a track record yet. See stats-service/app.py's
 * fetch_top_team_player_ids for the full reasoning.
 *
 * Same cache-first, never-throws shape as notablePlayers.js: a missing or
 * stale list just means this draft's easy mode doesn't get the extra
 * boost, not a broken roll.
 */
export async function getTopTeamPlayerIds() {
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
        console.warn(`[topTeamPlayers] refresh failed, falling back: ${err.message}`);
        lastRefreshFailureAt = Date.now();
        return memoryCache || { fetchedAt: 0, ids: [] };
      })
      .finally(() => {
        inFlightRefresh = null;
      });
  }

  const entry = await inFlightRefresh;
  return entry.ids;
}
