import "dotenv/config";
import { getPlayers, getCacheInfo } from "../services/playerCache.js";
import { summarizeEras } from "../services/era.js";

const start = Date.now();
console.log("Fetching the player pool from stats-service (nba_api)…");

try {
  const players = await getPlayers({
    forceRefresh: true,
    onProgress: ({ playersFetched }) => {
      console.log(`  ${playersFetched} players fetched…`);
    },
  });
  const info = await getCacheInfo();
  const seconds = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nCached ${players.length} players in ${seconds}s.`);
  console.log(info);
  console.log("\nEra breakdown:");
  for (const era of summarizeEras(players)) {
    console.log(`  ${era.label.padEnd(10)} ${era.count}`);
  }
} catch (err) {
  console.error("Failed to sync players:", err.message);
  process.exit(1);
}
