import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "..", "..", "data");
const CACHE_FILE = path.join(CACHE_DIR, "notablePlayers.json");
// All-time leaderboards barely move week to week, same reasoning as
// playerCache.js's 7-day pool cache.
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const STATS_SERVICE_URL = process.env.STATS_SERVICE_URL || "http://127.0.0.1:5001";

let memoryCache = null; // { fetchedAt, ids: number[] }
let inFlightRefresh = null;
// Set on a failed refresh, separate from memoryCache.fetchedAt (which stays
// the last real success and never gets bumped by a failure). Without this,
// once memoryCache passes CACHE_TTL_MS, isFresh() is false forever and
// EVERY call re-triggers a live refresh. On Render, where stats.nba.com is
// confirmed unreachable, that turned every single roll into a multi-second
// (sometimes much longer) wait instead of the one-time cost this was meant
// to be. Real production bug, not theoretical: hit this exact path live.
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
  const res = await fetch(`${STATS_SERVICE_URL}/notable-players`, {
    signal: AbortSignal.timeout(35000),
  });
  if (!res.ok) {
    throw new Error(`stats-service /notable-players failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  const entry = { fetchedAt: Date.now(), ids: data.playerIds || [] };
  await writeCacheFile(entry);
  memoryCache = entry;
  return entry;
}

/**
 * The difficulty system's data-driven pool: all-time career leaders
 * (points/rebounds/assists/steals/blocks), sourced once from stats-service
 * and cached to disk for a week. Higher difficulty narrows a roll's
 * candidates to this pool first (see draft:nominate in roomHandlers.js).
 * Without it, an easier difficulty couldn't reliably land recognizable
 * players against a huge pool like "All Eras".
 *
 * Deliberately never throws: a missing or stale list degrades the
 * difficulty system back to pure random sampling, not broken nominations.
 * Errors are logged and an empty list returned instead.
 */
export async function getNotablePlayerIds() {
  if (isFresh(memoryCache)) return memoryCache.ids;

  if (!memoryCache) {
    // Same reasoning as playerCache.js: keep the disk cache in memory even
    // when stale, so a failed refresh (stats-service down, or stats.nba.com
    // unreachable from wherever this is hosted) has real data to fall back
    // to instead of collapsing straight to an empty list.
    const fromDisk = await readCacheFile().catch(() => null);
    if (fromDisk) {
      memoryCache = fromDisk;
      if (isFresh(fromDisk)) return memoryCache.ids;
    }
  }

  // Already tried recently and it failed. Serve stale data immediately
  // rather than pay for the same doomed attempt again on every request.
  if (memoryCache && Date.now() - lastRefreshFailureAt < REFRESH_RETRY_COOLDOWN_MS) {
    return memoryCache.ids;
  }

  if (!inFlightRefresh) {
    inFlightRefresh = refreshCache()
      .catch((err) => {
        console.warn(`[notablePlayers] refresh failed, falling back: ${err.message}`);
        lastRefreshFailureAt = Date.now();
        // Must assign, not just return a fallback value -- the cooldown
        // check above only fires when memoryCache is truthy. Currently
        // unreachable in practice (notablePlayers.json always ships on
        // disk, so memoryCache is never actually null here), but see
        // topTeamPlayers.js for what happens when that assumption doesn't
        // hold: the exact same shape of bug, without a disk cache to mask
        // it, turned into every roll re-paying a doomed fetch.
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
