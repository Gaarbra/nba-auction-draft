import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAllPlayers } from "./nbaPlayersClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "..", "..", "data");
const CACHE_FILE = path.join(CACHE_DIR, "players.json");
// The NBA's historical player list barely changes day to day (mostly just
// gains new rookies each season), so a week-long cache is still "fresh
// enough" — no need to re-hit stats-service (and by extension stats.nba.com)
// on every server start.
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

let memoryCache = null;
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
  return entry && Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

async function refreshCache({ onProgress } = {}) {
  const players = await fetchAllPlayers({ onProgress });
  const entry = { fetchedAt: Date.now(), players };
  await writeCacheFile(entry);
  memoryCache = entry;
  return entry;
}

export async function getPlayers({ forceRefresh = false, onProgress } = {}) {
  if (!forceRefresh && isFresh(memoryCache)) {
    return memoryCache.players;
  }

  if (!memoryCache) {
    // Read the disk cache even if it's stale (past CACHE_TTL_MS) — not just
    // when fresh. A stale-but-real player pool is what refreshCache() below
    // falls back to if stats.nba.com can't be reached (e.g. blocked/
    // rate-limited from a cloud host's IP, a real risk this app has hit
    // before from a residential connection too). Keeping it in memoryCache
    // now, before we know whether the refresh will succeed, is what makes
    // that fallback possible.
    const fromDisk = await readCacheFile();
    if (fromDisk) {
      memoryCache = fromDisk;
      if (!forceRefresh && isFresh(fromDisk)) {
        return memoryCache.players;
      }
    }
  }

  if (!inFlightRefresh) {
    inFlightRefresh = refreshCache({ onProgress })
      .catch((err) => {
        if (memoryCache) {
          console.warn(
            `[playerCache] refresh failed, serving stale cache from ${new Date(memoryCache.fetchedAt).toISOString()}: ${err.message}`
          );
          return memoryCache;
        }
        // Nothing to fall back to (first-ever run, no disk cache, and the
        // very first fetch failed) — there's genuinely no player pool to
        // serve, so this has to propagate.
        throw err;
      })
      .finally(() => {
        inFlightRefresh = null;
      });
  }

  const entry = await inFlightRefresh;
  return entry.players;
}

export async function getCacheInfo() {
  const entry = memoryCache || (await readCacheFile());
  if (!entry) return { cached: false };
  return {
    cached: true,
    fetchedAt: new Date(entry.fetchedAt).toISOString(),
    playerCount: entry.players.length,
    isFresh: isFresh(entry),
  };
}
