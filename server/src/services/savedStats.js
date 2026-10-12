import { readFile } from "node:fs/promises";

// ponytail: a bundled snapshot survives a sleeping stats service; refresh the
// existing stats-service cache and redeploy when newer career totals are needed.
const snapshot = readFile(new URL("../../../stats-service/data/statsCache.json", import.meta.url), "utf8")
  .then(JSON.parse)
  .catch((error) => {
    console.warn(`[savedStats] snapshot unavailable: ${error.code || error.message}`);
    return {};
  });

export async function savedPlayerStats(playerId) {
  const entry = (await snapshot)[String(playerId)];
  if (!entry?.stats) return null;
  return { ...entry.stats, savedAt: entry.fetchedAt };
}
