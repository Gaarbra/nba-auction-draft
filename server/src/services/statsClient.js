const STATS_SERVICE_URL = process.env.STATS_SERVICE_URL || "http://127.0.0.1:5001";

/**
 * Looks players up by NBA person id — the pool (server/src/services/
 * nbaPlayersClient.js) already carries the real id for every player, so
 * there's no need for stats-service to fuzzy-match on name anymore.
 */
export async function fetchPlayerStats(playerId) {
  try {
    const res = await fetch(`${STATS_SERVICE_URL}/stats?id=${encodeURIComponent(playerId)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.warn(`[statsClient] ${res.status} for id=${playerId}`);
      return null;
    }
    const data = await res.json();
    if (!data.stats) return null;
    return { stats: data.stats, nbaPlayerId: data.player?.id ?? null };
  } catch (err) {
    console.warn(`[statsClient] fetch failed for id=${playerId}: ${err.message}`);
    return null;
  }
}

/**
 * Like fetchPlayerStats, but also includes FGA/FTA/TOV/USG% — the extra
 * fields the scoring module needs. Only used for the one-time end-of-draft
 * results computation, not the live nomination reveal, since the USG%
 * lookup costs an extra stats.nba.com call.
 */
export async function fetchFullPlayerStats(playerId) {
  try {
    const res = await fetch(`${STATS_SERVICE_URL}/full-stats?id=${encodeURIComponent(playerId)}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.warn(`[statsClient] full-stats ${res.status} for id=${playerId}`);
      return null;
    }
    const data = await res.json();
    if (!data.stats) return null;
    return data.stats;
  } catch (err) {
    console.warn(`[statsClient] full-stats fetch failed for id=${playerId}: ${err.message}`);
    return null;
  }
}
