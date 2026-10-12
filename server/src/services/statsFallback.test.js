import test from "node:test";
import assert from "node:assert/strict";
import { fetchPlayerStats, fetchFullPlayerStats, fetchMarketIndex } from "./statsClient.js";

test("stats outage uses real saved careers, preserves NBA id, and never invents missing players", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("test service outage"); });
  const result = await fetchPlayerStats(2544);
  assert.equal(result.nbaPlayerId, 2544);
  assert.ok(result.stats.gamesPlayed > 1000);
  assert.ok(result.stats.savedAt > 0);
  assert.equal(await fetchPlayerStats(-1), null);
  assert.ok((await fetchFullPlayerStats(2544)).pointsPerGame > 0);
  assert.ok((await fetchMarketIndex()).some((player) => player.id === 2544));
  globalThis.fetch.mock.mockImplementation(async () => ({ ok: true, json: async () => ({ player: { id: 2544 }, stats: { gamesPlayed: 2000 } }) }));
  assert.deepEqual((await fetchPlayerStats(2544)).stats, { gamesPlayed: 2000 });
});

test("peak requests reject career-only responses during service failures", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => ({ stats: { gamesPlayed: 1000 } }) }));
  const id = -999;
  assert.equal(await fetchPlayerStats(id, "peak"), null);
  assert.equal(await fetchFullPlayerStats(id, "peak"), null);
  const peak = { season: "2015-16", gamesPlayed: 79, pointsPerGame: 30.1 };
  globalThis.fetch.mock.mockImplementation(async () => ({ ok: true, json: async () => ({ stats: peak, player: { id: 201939 } }) }));
  assert.deepEqual((await fetchPlayerStats(201939, "peak")).stats, peak);
});
