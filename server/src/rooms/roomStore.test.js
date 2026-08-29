import test from "node:test";
import assert from "node:assert/strict";
import { computeNotablePoolOdds, DIFFICULTY_STATIC_ODDS } from "./roomStore.js";

test("computeNotablePoolOdds: a large notable pool gets the difficulty's full base odds", () => {
  assert.strictEqual(computeNotablePoolOdds("easy", 1161), DIFFICULTY_STATIC_ODDS.easy);
  assert.strictEqual(computeNotablePoolOdds("easy", 205), DIFFICULTY_STATIC_ODDS.easy);
});

test("computeNotablePoolOdds: exactly at the 30-player threshold still gets full odds", () => {
  assert.strictEqual(computeNotablePoolOdds("easy", 30), DIFFICULTY_STATIC_ODDS.easy);
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
  const at15 = computeNotablePoolOdds("normal", 15); // 15/30 = 0.5, above the 0.7 floor's threshold (0.7*30=21)... actually below it
  const at25 = computeNotablePoolOdds("normal", 25); // 25/30 ≈ 0.833, above the floor
  // 15/30=0.5 is below the 0.7 floor, so it should be clamped to the floor,
  // same as 10/30 would be — floor kicks in for anything below 21/30.
  assert.ok(Math.abs(at15 - DIFFICULTY_STATIC_ODDS.normal * 0.7) < 1e-9);
  // 25/30 ≈ 0.833 is above the floor, so it should reflect the real ratio.
  assert.ok(Math.abs(at25 - DIFFICULTY_STATIC_ODDS.normal * (25 / 30)) < 1e-9);
});
