import test from "node:test";
import assert from "node:assert/strict";
import { computeDraftResults } from "./computeResults.js";

test("peak results use the drafted season even when the stats service is offline", async (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("Must not request new stats"); });
  const player = { id: 1, fullName: "Peak Player", position: "G", stats: { season: "2015-16", gamesPlayed: 79,
    pointsPerGame: 30, reboundsPerGame: 5, assistsPerGame: 6, stealsPerGame: 2, blocksPerGame: .2,
    fgaPerGame: 20, ftaPerGame: 5, tovPerGame: 3, minutesPerGame: 34, usagePct: null } };
  const room = { gameMode: "peak", players: [{ id: "host", name: "Host" }], draft: {
    rosters: { host: { PG: player, SG: null, SF: null, PF: null, C: null } } } };
  const result = await computeDraftResults(room);
  assert.ok(result.teams[0].roster[0].total > 0);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});
