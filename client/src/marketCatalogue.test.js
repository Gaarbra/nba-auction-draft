import assert from "node:assert/strict";
import { test } from "node:test";
import { loadMarketCatalogue } from "./marketCatalogue.js";

test("catalogue failures reach the retry UI instead of looking like an empty pool", async () => {
  const request = (status, body) => async () => new Response(JSON.stringify(body), { status });
  await assert.rejects(loadMarketCatalogue("/players", request(503, { players: [] })), /unavailable/);
  await assert.rejects(loadMarketCatalogue("/players", request(200, { error: "offline" })), /Invalid/);
  await assert.rejects(loadMarketCatalogue("/players", async () => { throw new Error("Network failed"); }), /Network/);
  assert.deepEqual(await loadMarketCatalogue("/players", request(200, { players: [] })), []);
  const players = [{ id: 1, fullName: "Test player" }];
  assert.deepEqual(await loadMarketCatalogue("/players", request(200, { players })), players);
});
