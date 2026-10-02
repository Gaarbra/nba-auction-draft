import test from "node:test";
import assert from "node:assert/strict";
import { prepareActiveSnapshot, drawActivePlayer } from "./activeNow.js";
import { computeDraftResults } from "../scoring/computeResults.js";
import { playerScore } from "../scoring/scoring.js";
import { toPlayerStatLine } from "../scoring/statsAdapter.js";
import { createRoom, addPlayerToRoom, startDraft } from "../rooms/roomStore.js";

test("Active Now values, nominations and scoring use one frozen season without career requests", async () => {
  const stats = { statsBasis: "season", season: "2026-27", gamesPlayed: 1, pointsPerGame: 4,
    reboundsPerGame: 2, assistsPerGame: 1, stealsPerGame: 0, blocksPerGame: 0,
    fgaPerGame: 4, ftaPerGame: 0, tovPerGame: 1, minutesPerGame: 20, usagePct: 20 };
  const player = { id: 1, nbaPlayerId: 1, fullName: "Season Player", isActive: true, position: "G", stats };
  const snapshot = prepareActiveSnapshot({ season: "2026-27", fetchedAt: Date.now() / 1000,
    players: [player, { ...player, id: 2, isActive: false }, { ...player, id: 3, stats: { ...stats, season: "2025-26", pointsPerGame: 99 } }] });
  assert.equal(snapshot.players.length, 1);
  assert.equal(snapshot.players[0].suggestedPrice, 4);
  const roster = { PG: snapshot.players[0], SG: null, SF: null, PF: null, C: null };
  const room = { gameMode: "active-now", activeNowSnapshot: structuredClone(snapshot), difficulty: "hard",
    players: [{ id: "a", name: "A" }], draft: { draftedPlayerIds: [], rosters: { a: roster } } };
  assert.equal(drawActivePlayer(room, [], () => 0).player.id, 1);
  assert.equal(drawActivePlayer(room, [1]).error, "NO_PLAYERS_LEFT");
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("Career API must never be called"); };
  try {
    const result = await computeDraftResults(room);
    assert.equal(result.statsSeason, "2026-27");
    assert.equal(result.teams[0].roster[0].total, playerScore({ ...toPlayerStatLine(stats), position: "G", slot: "PG" }).total);
    roster.PG = { ...player, stats: { ...stats, statsBasis: "career" } };
    await assert.rejects(computeDraftResults(room), /refusing career-stat fallback/);
  } finally { globalThis.fetch = oldFetch; }
  assert.throws(() => prepareActiveSnapshot({ ...snapshot, fetchedAt: 0 }), /UNAVAILABLE/);
  const lobby = createRoom("private", true);
  const host = addPlayerToRoom(lobby.code, { name: "Host", socketId: "test" }).player;
  assert.equal(startDraft(lobby.code, host.id, "all", true, "normal", "open", "wrong").error, "INVALID_GAME_MODE");
  assert.equal(startDraft(lobby.code, host.id, "all", true, "normal", "open", "active-now").error, "ACTIVE_NOW_UNAVAILABLE");
  const enough = { ...snapshot, players: Array.from({ length: 6 }, (_, i) => ({ ...player, id: i + 1, stats: { ...stats } })) };
  assert.equal(startDraft(lobby.code, host.id, "all", true, "normal", "open", "active-now", enough).room.gameMode, "active-now");
  enough.players[0].stats.pointsPerGame = 99;
  assert.equal(lobby.activeNowSnapshot.players[0].stats.pointsPerGame, 4);
});
