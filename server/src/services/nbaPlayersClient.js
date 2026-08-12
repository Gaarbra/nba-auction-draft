const STATS_SERVICE_URL = process.env.STATS_SERVICE_URL || "http://127.0.0.1:5001";

/**
 * The full draft-eligible player pool, sourced from stats-service's /players
 * (which wraps nba_api's commonallplayers — one bulk call, not a paginated
 * scrape). Kept as a single async function with the same shape as the old
 * balldontlie client so playerCache.js didn't need to change its interface,
 * just which client it imports.
 */
export async function fetchAllPlayers({ onProgress } = {}) {
  const res = await fetch(`${STATS_SERVICE_URL}/players`, {
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`stats-service /players failed: ${res.status} ${res.statusText} ${body}`);
  }

  const data = await res.json();
  const players = (data.players || []).map((p) => ({
    id: p.id,
    fullName: p.fullName,
    isActive: Boolean(p.isActive),
    fromYear: p.fromYear ?? null,
    toYear: p.toYear ?? null,
  }));

  onProgress?.({ page: 1, playersFetched: players.length, done: true });
  return players;
}
