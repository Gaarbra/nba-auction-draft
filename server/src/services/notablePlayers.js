import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "..", "..", "data");
const CACHE_FILE = path.join(CACHE_DIR, "notablePlayers.json");
// All-time leaderboards barely move week to week — same reasoning as
// playerCache.js's 7-day pool cache.
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const STATS_SERVICE_URL = process.env.STATS_SERVICE_URL || "http://127.0.0.1:5001";

let memoryCache = null; // { fetchedAt, ids: number[] }
let inFlightRefresh = null;

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
 * The "static" half of the difficulty system: a data-driven pool of
 * all-time career leaders (points/rebounds/assists/steals/blocks), sourced
 * once from stats-service and cached to disk for a week. Layered with the
 * "dynamic" half (drawPlayerWithStats's random best-of-N sampling in
 * roomHandlers.js) — narrowing the sampled candidates to this pool first is
 * what makes an easier difficulty actually land recognizable players
 * against a huge pool like "All Eras", where blind random sampling would
 * almost always miss them.
 *
 * Deliberately never throws: a missing or stale notable-players list should
 * degrade the difficulty system back to pure random sampling, not break
 * nominations. Errors are logged and an empty list is returned instead.
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

  if (!inFlightRefresh) {
    inFlightRefresh = refreshCache()
      .catch((err) => {
        console.warn(`[notablePlayers] refresh failed, falling back: ${err.message}`);
        return memoryCache || { fetchedAt: 0, ids: [] };
      })
      .finally(() => {
        inFlightRefresh = null;
      });
  }

  const entry = await inFlightRefresh;
  return entry.ids;
}
