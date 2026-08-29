import test from "node:test";
import assert from "node:assert/strict";
import { estimateUsagePct, estimateSeasonDWS, toPlayerStatLine } from "./statsAdapter.js";
import { defensiveImpactRating } from "./scoring.js";

// --- estimateUsagePct -------------------------------------------------------

test("estimateUsagePct: zero minutes returns 0, no division by zero", () => {
  const result = estimateUsagePct({ fgaPerGame: 10, ftaPerGame: 2, tovPerGame: 1, minutesPerGame: 0 });
  assert.strictEqual(result, 0);
});

test("estimateUsagePct: missing minutes (null) returns 0", () => {
  const result = estimateUsagePct({ fgaPerGame: 10, ftaPerGame: 2, tovPerGame: 1, minutesPerGame: null });
  assert.strictEqual(result, 0);
});

test("estimateUsagePct: a high-volume, high-minutes season lands in a plausible star-usage range", () => {
  // Roughly peak-Wilt-shaped inputs: heavy shot volume, near-full minutes.
  const result = estimateUsagePct({ fgaPerGame: 22.5, ftaPerGame: 11.4, tovPerGame: null, minutesPerGame: 46.4 });
  assert.ok(result > 25 && result < 35, `expected a plausible star usage rate, got ${result}`);
});

test("estimateUsagePct: a low-volume role player lands lower than a high-volume star", () => {
  const roleSlayer = estimateUsagePct({ fgaPerGame: 7, ftaPerGame: 1, tovPerGame: 1, minutesPerGame: 20 });
  const star = estimateUsagePct({ fgaPerGame: 20, ftaPerGame: 6, tovPerGame: 3, minutesPerGame: 35 });
  assert.ok(roleSlayer < star);
});

test("estimateUsagePct: is clamped to a sane [5, 45] range", () => {
  const tiny = estimateUsagePct({ fgaPerGame: 0.1, ftaPerGame: 0, tovPerGame: 0, minutesPerGame: 40 });
  const huge = estimateUsagePct({ fgaPerGame: 40, ftaPerGame: 20, tovPerGame: 10, minutesPerGame: 10 });
  assert.ok(tiny >= 5);
  assert.ok(huge <= 45);
});

// --- estimateSeasonDWS -------------------------------------------------------

test("estimateSeasonDWS: zero games played returns 0, no division by zero", () => {
  assert.strictEqual(estimateSeasonDWS({ reboundsPerGame: 20, gamesPlayed: 0 }), 0);
});

test("estimateSeasonDWS: missing rebounds defaults to 0 rebounds, not a crash", () => {
  assert.strictEqual(estimateSeasonDWS({ gamesPlayed: 70 }), 0);
});

test("estimateSeasonDWS: round-tripped through defensiveImpactRating reproduces the calibrated DIR target", () => {
  // Calibration promise: 15 REB/game -> DIR of 5 when run through the same
  // (seasonDWS/gamesPlayed)*100 formula scoring.js already uses.
  const gamesPlayed = 70;
  const seasonDWS = estimateSeasonDWS({ reboundsPerGame: 15, gamesPlayed });
  const dir = defensiveImpactRating({ stl: null, blk: null, seasonDWS, gamesPlayed });
  assert.ok(Math.abs(dir - 5) < 1e-9, `expected DIR ~5, got ${dir}`);
});

test("estimateSeasonDWS: a bigger rebounder produces a proportionally bigger DIR", () => {
  const gamesPlayed = 82;
  const lowReb = defensiveImpactRating({
    stl: null,
    blk: null,
    seasonDWS: estimateSeasonDWS({ reboundsPerGame: 5, gamesPlayed }),
    gamesPlayed,
  });
  const highReb = defensiveImpactRating({
    stl: null,
    blk: null,
    seasonDWS: estimateSeasonDWS({ reboundsPerGame: 20, gamesPlayed }),
    gamesPlayed,
  });
  assert.ok(highReb > lowReb);
});

// --- toPlayerStatLine ---------------------------------------------------------

test("toPlayerStatLine: real usagePct is passed through unchanged and flagged as not estimated", () => {
  const raw = {
    pointsPerGame: 22.2,
    fgaPerGame: 15.2,
    ftaPerGame: 5.0,
    assistsPerGame: 7.5,
    tovPerGame: 3.0,
    stealsPerGame: 1.3,
    blocksPerGame: 0.7,
    reboundsPerGame: 11.1,
    minutesPerGame: 34.6,
    gamesPlayed: 810,
    usagePct: 28.9,
  };
  const line = toPlayerStatLine(raw);
  assert.strictEqual(line.usagePct, 28.9);
  assert.strictEqual(line.usagePctEstimated, false);
  assert.strictEqual(line.pts, 22.2);
  assert.strictEqual(line.stl, 1.3);
});

test("toPlayerStatLine: null usagePct triggers the estimate and is flagged as estimated", () => {
  const raw = {
    pointsPerGame: 30.1,
    fgaPerGame: 22.5,
    ftaPerGame: 11.4,
    assistsPerGame: 4.4,
    tovPerGame: null,
    stealsPerGame: null,
    blocksPerGame: null,
    reboundsPerGame: 22.9,
    minutesPerGame: 45.8,
    gamesPlayed: 1045,
    usagePct: null,
  };
  const line = toPlayerStatLine(raw);
  assert.strictEqual(line.usagePctEstimated, true);
  assert.strictEqual(line.usagePct, estimateUsagePct(raw));
  assert.strictEqual(line.tov, 0); // untracked TOV defaults to 0
  assert.strictEqual(line.stl, null); // untracked STL/BLK stay null for scoring.js to detect
  assert.strictEqual(line.blk, null);
});

test("toPlayerStatLine: missing fields default to 0 rather than crashing downstream math", () => {
  const line = toPlayerStatLine({ gamesPlayed: 10, usagePct: null });
  assert.strictEqual(line.pts, 0);
  assert.strictEqual(line.fga, 0);
  assert.strictEqual(line.fta, 0);
  assert.strictEqual(line.ast, 0);
  assert.strictEqual(line.tov, 0);
  assert.strictEqual(line.reb, 0);
  assert.ok(Number.isFinite(line.usagePct));
});

test("toPlayerStatLine: reboundsPerGame is threaded through to `reb` for scoring.js's tracked-era DIR term", () => {
  const line = toPlayerStatLine({
    reboundsPerGame: 11.4,
    stealsPerGame: 1.2,
    blocksPerGame: 0.6,
    gamesPlayed: 70,
    usagePct: 25,
  });
  assert.strictEqual(line.reb, 11.4);
});
