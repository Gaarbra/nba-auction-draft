import test from "node:test";
import assert from "node:assert/strict";
import { computeNotablePoolOdds, computeStarPoolOdds, DIFFICULTY_STATIC_ODDS, DIFFICULTY_STATIC_STAR_ODDS } from "./roomStore.js";

test("computeNotablePoolOdds: a large notable pool (e.g. All Eras' ~1,160) gets the difficulty's full base odds", () => {
  assert.strictEqual(computeNotablePoolOdds("easy", 1161), DIFFICULTY_STATIC_ODDS.easy);
  assert.strictEqual(computeNotablePoolOdds("easy", 500), DIFFICULTY_STATIC_ODDS.easy);
});

test("computeNotablePoolOdds: exactly at the 400-player threshold still gets full odds", () => {
  assert.strictEqual(computeNotablePoolOdds("easy", 400), DIFFICULTY_STATIC_ODDS.easy);
});

// The actual bug this threshold exists to fix: every single-era bucket
// ("active" ~140, a typical decade ~60-205) sits nowhere near All Eras'
// ~1,160, but the old threshold (30) was low enough that all of them still
// got the exact same full, unscaled odds -- players correctly reported
// easy+active nominating the same names constantly, since 92% of every
// roll was coming from the same ~140-player list. Both should land on the
// floor now, not full odds.
test("computeNotablePoolOdds: single-era-sized pools (active ~140, a decade ~200) now scale down to the floor", () => {
  const active = computeNotablePoolOdds("easy", 140);
  const decade = computeNotablePoolOdds("easy", 200);
  assert.ok(Math.abs(active - DIFFICULTY_STATIC_ODDS.easy * 0.7) < 1e-9, `expected ~${DIFFICULTY_STATIC_ODDS.easy * 0.7}, got ${active}`);
  assert.ok(Math.abs(decade - DIFFICULTY_STATIC_ODDS.easy * 0.7) < 1e-9, `expected ~${DIFFICULTY_STATIC_ODDS.easy * 0.7}, got ${decade}`);
});

test("computeNotablePoolOdds: a narrow pool (e.g. 2020s' 10 notable players) scales down but never below the 0.7 floor", () => {
  const odds = computeNotablePoolOdds("easy", 10);
  assert.ok(Math.abs(odds - DIFFICULTY_STATIC_ODDS.easy * 0.7) < 1e-9, `expected ~${DIFFICULTY_STATIC_ODDS.easy * 0.7}, got ${odds}`);
});

test("computeNotablePoolOdds: an empty or tiny notable pool still hits the 0.7 floor, not 0", () => {
  assert.ok(Math.abs(computeNotablePoolOdds("easy", 0) - DIFFICULTY_STATIC_ODDS.easy * 0.7) < 1e-9);
  assert.ok(Math.abs(computeNotablePoolOdds("easy", 1) - DIFFICULTY_STATIC_ODDS.easy * 0.7) < 1e-9);
});

test("computeNotablePoolOdds: hard difficulty is always 0 regardless of pool size", () => {
  assert.strictEqual(computeNotablePoolOdds("hard", 1161), 0);
  assert.strictEqual(computeNotablePoolOdds("hard", 10), 0);
  assert.strictEqual(computeNotablePoolOdds("hard", 0), 0);
});

test("computeNotablePoolOdds: an unrecognized difficulty falls back to normal's odds", () => {
  assert.strictEqual(computeNotablePoolOdds("bogus", 1161), DIFFICULTY_STATIC_ODDS.normal);
});

test("computeNotablePoolOdds: scales smoothly between the floor and full odds", () => {
  // 140/400 = 0.35, below the 0.7 floor's threshold (0.7*400=280), so it
  // clamps to the floor, same as any smaller pool would.
  const at140 = computeNotablePoolOdds("normal", 140);
  // 350/400 = 0.875, above the floor, so it should reflect the real ratio.
  const at350 = computeNotablePoolOdds("normal", 350);
  assert.ok(Math.abs(at140 - DIFFICULTY_STATIC_ODDS.normal * 0.7) < 1e-9);
  assert.ok(Math.abs(at350 - DIFFICULTY_STATIC_ODDS.normal * (350 / 400)) < 1e-9);
});

// computeStarPoolOdds: same shape as computeNotablePoolOdds (base *
// pool-size scale, floored), just its own smaller threshold (150, not 400)
// and lower floor (0.5, not 0.7) -- see its own comment in roomStore.js for
// why: the star pool (award-driven, MVP/All-NBA/a real All-Star selection)
// is inherently narrower than the stat-driven notable pool, so a narrow
// era's star subset can be genuinely tiny.

test("computeStarPoolOdds: a large star pool (e.g. All Eras' 450+) gets the difficulty's full base odds", () => {
  assert.strictEqual(computeStarPoolOdds("easy", 457), DIFFICULTY_STATIC_STAR_ODDS.easy);
  assert.strictEqual(computeStarPoolOdds("easy", 150), DIFFICULTY_STATIC_STAR_ODDS.easy);
});

test("computeStarPoolOdds: a narrow pool scales down but never below the 0.5 floor", () => {
  const odds = computeStarPoolOdds("easy", 20);
  assert.ok(Math.abs(odds - DIFFICULTY_STATIC_STAR_ODDS.easy * 0.5) < 1e-9, `expected ~${DIFFICULTY_STATIC_STAR_ODDS.easy * 0.5}, got ${odds}`);
});

test("computeStarPoolOdds: an empty star pool still hits the 0.5 floor, not 0", () => {
  assert.ok(Math.abs(computeStarPoolOdds("easy", 0) - DIFFICULTY_STATIC_STAR_ODDS.easy * 0.5) < 1e-9);
});

test("computeStarPoolOdds: hard difficulty is always 0 regardless of pool size", () => {
  assert.strictEqual(computeStarPoolOdds("hard", 457), 0);
  assert.strictEqual(computeStarPoolOdds("hard", 0), 0);
});

test("computeStarPoolOdds: an unrecognized difficulty falls back to normal's odds", () => {
  assert.strictEqual(computeStarPoolOdds("bogus", 457), DIFFICULTY_STATIC_STAR_ODDS.normal);
});

test("computeStarPoolOdds: scales smoothly between the floor and full odds", () => {
  // 75/150 = 0.5, exactly at the floor's own threshold (0.5*150=75).
  const at75 = computeStarPoolOdds("normal", 75);
  // 120/150 = 0.8, above the floor, so it should reflect the real ratio.
  const at120 = computeStarPoolOdds("normal", 120);
  assert.ok(Math.abs(at75 - DIFFICULTY_STATIC_STAR_ODDS.normal * 0.5) < 1e-9);
  assert.ok(Math.abs(at120 - DIFFICULTY_STATIC_STAR_ODDS.normal * (120 / 150)) < 1e-9);
});
