// @ts-check

/**
 * Maps `items` through `mapper` with at most `limit` calls in flight at
 * once, preserving output order. Used for batches of external calls (e.g.
 * the end-of-draft stats lookups in computeResults.js) where full
 * `Promise.all` parallelism would risk hammering a rate-limited upstream
 * (stats.nba.com, fronted by stats-service) — this app already fought that
 * exact problem once this session (aggressive parallel testing cascaded into
 * ReadTimeout/ConnectionReset errors across the whole stack).
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} mapper
 * @returns {Promise<R[]>}
 */
export async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    for (;;) {
      const i = nextIndex;
      nextIndex += 1;
      if (i >= items.length) return;
      results[i] = await mapper(items[i], i);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}
