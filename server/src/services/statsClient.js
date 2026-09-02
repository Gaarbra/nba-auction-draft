const STATS_SERVICE_URL = process.env.STATS_SERVICE_URL || "http://127.0.0.1:5001";

/**
 * Looks players up by NBA person id — the pool (server/src/services/
 * nbaPlayersClient.js) already carries the real id for every player, so
 * there's no need for stats-service to fuzzy-match on name anymore.
 */
export async function fetchPlayerStats(playerId) {
  try {
    const res = await fetch(`${STATS_SERVICE_URL}/stats?id=${encodeURIComponent(playerId)}`, {
      // A cache hit on the stats-service side answers in single-digit
      // milliseconds (see fetch_stats_for_player in app.py) — this timeout
      // only ever actually gets used on a genuine cache miss, and on Render
      // that live stats.nba.com lookup is confirmed to never succeed (the
      // outbound IP is blocked outright, not just rate-limited). Was 3000ms;
      // with up to MAX_STATS_DRAW_ATTEMPTS misses per roll, that made a
      // roll that happened to draw two uncached players take up to 6s for
      // no payoff. 1500ms halves that worst case while staying well above
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
 * Like fetchPlayerStats, but also includes FGA/FTA/TOV/USG% — the extra
 * fields the scoring module needs. Only used for the one-time end-of-draft
 * results computation, not the live nomination reveal, since the USG%
 * lookup costs an extra stats.nba.com call.
 */
export async function fetchFullPlayerStats(playerId) {
  try {
    // Longer than fetchPlayerStats on purpose: this endpoint does an extra
    // real-USG% lookup server-side (a heavier whole-season query, not
    // cached by the notable-pool warm-up) on top of the base stats fetch,
    // and its own internal timeout for that step is 20s (see
    // fetch_usage_pct in app.py). This needs to stay comfortably above
    // that, or Node routinely gives up right as the Python side was about
    // to return a perfectly good (if USG%-less) response.
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
 * fetchFullPlayerStats with a couple of retries (exponential backoff + a
 * little jitter) on failure, before falling back to null. Used for the
 * end-of-draft results computation, where up to 20 of these run for one
 * results page — a single flaky call there shouldn't need someone to
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
 * tooltip — see stats-service/ml.py (predict_price / explain_prediction)
 * and scripts/train_price_model.py. Returns predictedPrice: null (and
 * explanation: []) on any failure (model not trained yet, player not
 * found, timeout) — this is a "nice to have" hint for the bidding UI, never
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
