const STATS_SERVICE_URL = process.env.STATS_SERVICE_URL || "http://127.0.0.1:5001";

/**
 * Fire-and-forget wake-up ping for stats-service. On Render's free tier it
 * spins down after ~15 min idle and takes ~20-60s to wake up. Without this,
 * the first roll of a draft pays that cost, and the roll path's own timeout
 * (1.5s, see fetchPlayerStats) is nowhere near long enough to wait it out.
 * Called from GET /api/warm-stats-service on homepage load, so the wake-up
 * mostly happens while someone's still typing their name. Never awaited:
 * the caller doesn't need to know if it succeeds.
 */
export function pingStatsService() {
  fetch(`${STATS_SERVICE_URL}/health`, { signal: AbortSignal.timeout(60000) }).catch(() => {});
}

/**
 * Looks players up by NBA person id. The pool (server/src/services/
 * nbaPlayersClient.js) already carries the real id for every player, so
 * there's no need for stats-service to fuzzy-match on name anymore.
 */
export async function fetchPlayerStats(playerId) {
  try {
    const res = await fetch(`${STATS_SERVICE_URL}/stats?id=${encodeURIComponent(playerId)}`, {
      // A cache hit answers in single-digit ms; this timeout only matters on
      // a genuine miss, where the live stats.nba.com lookup is confirmed to
      // never succeed on Render (outbound IP is blocked). This was 3000ms,
      // and with up to MAX_STATS_DRAW_ATTEMPTS misses per roll, that cost up
      // to 6s for no payoff. 1500ms halves the worst case, still well above
      // what any cache hit needs.
      signal: AbortSignal.timeout(1500),
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
 * Like fetchPlayerStats, but also includes FGA/FTA/TOV/USG%, the extra
 * fields the scoring module needs. Only used for the one-time end-of-draft
 * results computation, not the live nomination reveal, since the USG%
 * lookup costs an extra stats.nba.com call.
 */
export async function fetchFullPlayerStats(playerId) {
  try {
    // Longer than fetchPlayerStats on purpose: this endpoint does an extra
    // real-USG% lookup server-side (a heavier query, not cached by the
    // warm-up), with its own 20s internal timeout (see fetch_usage_pct in
    // app.py). This needs to stay comfortably above that, or Node gives up
    // right as Python was about to return a good response.
    const res = await fetch(`${STATS_SERVICE_URL}/full-stats?id=${encodeURIComponent(playerId)}`, {
      signal: AbortSignal.timeout(25000),
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

const FULL_STATS_MAX_ATTEMPTS = 2;
const FULL_STATS_RETRY_BASE_MS = 500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * fetchFullPlayerStats with a couple of retries (exponential backoff plus a
 * little jitter) on failure, before falling back to null. Used for the
 * end-of-draft results computation, where up to 20 of these run for one
 * results page. A single flaky call there shouldn't need someone to
 * manually recompute, and a plain null (no stats) fallback is a worse
 * outcome than one quick retry when the first attempt was just transient
 * (a timeout, a 502, stats.nba.com hiccuping).
 */
export async function fetchFullPlayerStatsWithRetry(playerId, attempts = FULL_STATS_MAX_ATTEMPTS) {
  let lastResult = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    lastResult = await fetchFullPlayerStats(playerId);
    if (lastResult) return lastResult;
    if (attempt < attempts - 1) {
      const backoffMs = FULL_STATS_RETRY_BASE_MS * 2 ** attempt + Math.random() * 200;
      await sleep(backoffMs);
    }
  }
  return lastResult;
}

/**
 * Predicted auction price (in coins) from the trained price model, plus a
 * short "what this is mainly based on" breakdown for the UI's hover
 * tooltip. See stats-service/ml.py (predict_price / explain_prediction)
 * and scripts/train_price_model.py. Returns predictedPrice: null (and
 * explanation: []) on any failure (model not trained yet, player not
 * found, timeout). This is a "nice to have" hint for the bidding UI, never
 * something the draft flow should block or error on.
 */
export async function fetchPredictedPrice(playerId, { era, difficulty, slot } = {}) {
  try {
    const params = new URLSearchParams({ id: String(playerId) });
    if (era) params.set("era", era);
    if (difficulty) params.set("difficulty", difficulty);
    if (slot) params.set("slot", slot);

    const res = await fetch(`${STATS_SERVICE_URL}/predict-price?${params}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { predictedPrice: null, explanation: [] };
    const data = await res.json();
    return {
      predictedPrice: typeof data.predictedPrice === "number" ? data.predictedPrice : null,
      explanation: Array.isArray(data.explanation) ? data.explanation : [],
    };
  } catch (err) {
    console.warn(`[statsClient] predict-price failed for id=${playerId}: ${err.message}`);
    return { predictedPrice: null, explanation: [] };
  }
}

/**
 * Up to `k` nearest players by per-game stat profile (see
 * stats-service/ml.SimilarityIndex). Returns [] on any failure.
 */
export async function fetchSimilarPlayers(playerId, k = 5) {
  try {
    const params = new URLSearchParams({ id: String(playerId), k: String(k) });
    const res = await fetch(`${STATS_SERVICE_URL}/similar-players?${params}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.similar) ? data.similar : [];
  } catch (err) {
    console.warn(`[statsClient] similar-players failed for id=${playerId}: ${err.message}`);
    return [];
  }
}

/**
 * Real usage rate (USG%) for whichever cached season stats-service has for
 * this player. See /usage-pct's own docstring for why this never falls
 * back to a live lookup. Returns { usagePct: null, season: null } on any
 * failure or when nothing's cached, same "just don't show it" contract as
 * every other best-effort stats call in this file.
 */
export async function fetchUsagePct(playerId) {
  try {
    const res = await fetch(`${STATS_SERVICE_URL}/usage-pct?id=${encodeURIComponent(playerId)}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { usagePct: null, season: null };
    const data = await res.json();
    return {
      usagePct: typeof data.usagePct === "number" ? data.usagePct : null,
      season: typeof data.season === "string" ? data.season : null,
    };
  } catch (err) {
    console.warn(`[statsClient] usage-pct failed for id=${playerId}: ${err.message}`);
    return { usagePct: null, season: null };
  }
}

let marketIndexCache = null; // { players, fetchedAt } | null
const MARKET_INDEX_CACHE_TTL_MS = 60 * 60 * 1000; // an hour, see fetchMarketIndex

/**
 * The Market tab's era/team/player picker data: every player stats-service
 * already has real cached stats for, with team/position/draft year. Backed
 * entirely by stats-service's own on-disk cache (see /market-index's own
 * docstring for why that's what makes this Render-safe), so the only thing
 * worth caching here is the network round-trip plus JSON size (a few
 * thousand small objects) itself. A stale-for-up-to-an-hour list is fine,
 * since this data changes on the order of "a new season starts," not per
 * request, and returning the last good list on a transient failure beats a
 * blank picker for something this static.
 */
export async function fetchMarketIndex() {
  if (marketIndexCache && Date.now() - marketIndexCache.fetchedAt < MARKET_INDEX_CACHE_TTL_MS) {
    return marketIndexCache.players;
  }

  try {
    const res = await fetch(`${STATS_SERVICE_URL}/market-index`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    const list = Array.isArray(data.players) ? data.players : [];
    marketIndexCache = { players: list, fetchedAt: Date.now() };
    return list;
  } catch (err) {
    console.warn(`[statsClient] market-index fetch failed: ${err.message}`);
    return marketIndexCache?.players ?? [];
  }
}

/**
 * Standalone from fetchPlayerStats on purpose: this is only ever called
 * as a client-side retry a couple seconds after a nomination reveal that
 * had no photo yet (see PlayerHeadshot.jsx), and doesn't need a full
 * career-stats re-fetch just to ask "did the fallback resolve by now?".
 * Returns null on any failure, same as a genuine "nothing found."
 */
export async function fetchPhotoUrl(playerId) {
  try {
    const res = await fetch(`${STATS_SERVICE_URL}/photo-url?id=${encodeURIComponent(playerId)}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.photoUrl === "string" ? data.photoUrl : null;
  } catch (err) {
    console.warn(`[statsClient] photo-url failed for id=${playerId}: ${err.message}`);
    return null;
  }
}
