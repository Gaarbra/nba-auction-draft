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

  if (!forceRefresh && !memoryCache) {
    const fromDisk = await readCacheFile();
    if (isFresh(fromDisk)) {
      memoryCache = fromDisk;
      return memoryCache.players;
    }
  }

  if (!inFlightRefresh) {
    inFlightRefresh = refreshCache({ onProgress }).finally(() => {
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
