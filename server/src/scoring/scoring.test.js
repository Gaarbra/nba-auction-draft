import test from "node:test";
import assert from "node:assert/strict";
import {
  trueShootingPercentage,
  offenseScore,
  defensiveImpactRating,
  synergyMultiplier,
  playerScore,
  teamScore,
  winProbability,
  rankTeams,
  pairwiseMatchups,
} from "./scoring.js";

// --- mock data -------------------------------------------------------------

const modernStarter = {
  pts: 25,
  fga: 18,
  fta: 6,
  ast: 5,
  tov: 3,
  stl: 1.5,
  blk: 0.5,
  usagePct: 28,
};

const preTrackingStarter = {
  pts: 20,
  fga: 16,
  fta: 4,
  ast: 3,
  tov: 2,
  stl: null,
  blk: null,
  seasonDWS: 3.5,
  gamesPlayed: 70,
  usagePct: 22,
};

function mockRoster() {
  return [
    { ...modernStarter },
    { ...preTrackingStarter },
    { pts: 12, fga: 10, fta: 2, ast: 8, tov: 4, stl: 1.0, blk: 0.2, usagePct: 18 },
    { pts: 8, fga: 7, fta: 1, ast: 2, tov: 1, stl: 0.6, blk: 1.1, usagePct: 15 },
    { pts: 14, fga: 11, fta: 3, ast: 4, tov: 2, stl: 0.9, blk: 0.4, usagePct: 20 },
  ];
}

// --- trueShootingPercentage -------------------------------------------------

test("trueShootingPercentage: normal case matches PTS / (2*(FGA + 0.44*FTA))", () => {
  const stats = { pts: 25, fga: 18, fta: 6 };
  const expected = 25 / (2 * (18 + 0.44 * 6));
  assert.strictEqual(trueShootingPercentage(stats), expected);
});

test("trueShootingPercentage: zero FGA and zero FTA returns 0, not NaN/Infinity", () => {
  const result = trueShootingPercentage({ pts: 0, fga: 0, fta: 0 });
  assert.strictEqual(result, 0);
  assert.ok(Number.isFinite(result));
});

// --- offenseScore ------------------------------------------------------------

test("offenseScore: matches (PTS*TS%) + (AST*1.5) - (TOV*2.0)", () => {
  const stats = { pts: 25, fga: 18, fta: 6, ast: 5, tov: 3 };
  const ts = 25 / (2 * (18 + 0.44 * 6));
  const expected = 25 * ts + 5 * 1.5 - 3 * 2.0;
  assert.strictEqual(offenseScore(stats), expected);
});

test("offenseScore: a player with zero FGA/FTA doesn't blow up (guarded TS%)", () => {
  const result = offenseScore({ pts: 0, fga: 0, fta: 0, ast: 2, tov: 1 });
  // PTS*TS% term is 0, so this is just AST*1.5 - TOV*2.0
  assert.strictEqual(result, 2 * 1.5 - 1 * 2.0);
});

// --- defensiveImpactRating ---------------------------------------------------

test("defensiveImpactRating: tracked stats use STL*2.5 + BLK*2.0", () => {
  const result = defensiveImpactRating({ stl: 1.5, blk: 0.5 });
  assert.strictEqual(result, 1.5 * 2.5 + 0.5 * 2.0);
});

test("defensiveImpactRating: untracked stats (null) fall back to (DWS/GP)*100", () => {
  const result = defensiveImpactRating({ stl: null, blk: null, seasonDWS: 3.5, gamesPlayed: 70 });
  assert.strictEqual(result, (3.5 / 70) * 100);
});

test("defensiveImpactRating: a real measured zero (STL=0, BLK=0) is NOT treated as untracked", () => {
  // This is the key distinction from the literal spec wording ("if untracked/0"):
  // a modern player who genuinely posted 0 STL and 0 BLK in a game/season is
  // a real data point, not a missing one, so this must use the direct formula
  // (which correctly evaluates to 0) rather than silently switching to DWS.
  const result = defensiveImpactRating({ stl: 0, blk: 0, seasonDWS: 99, gamesPlayed: 1 });
  assert.strictEqual(result, 0);
});

test("defensiveImpactRating: partially-null STL/BLK is treated as untracked", () => {
  const result = defensiveImpactRating({ stl: 2, blk: null, seasonDWS: 4, gamesPlayed: 80 });
  assert.strictEqual(result, (4 / 80) * 100);
});

test("defensiveImpactRating: untracked with 0 games played returns 0, no division by zero", () => {
  const result = defensiveImpactRating({ stl: null, blk: null, seasonDWS: 5, gamesPlayed: 0 });
  assert.strictEqual(result, 0);
  assert.ok(Number.isFinite(result));
});

test("defensiveImpactRating: untracked with missing DWS defaults to 0 DWS", () => {
  const result = defensiveImpactRating({ stl: null, blk: null, gamesPlayed: 50 });
  assert.strictEqual(result, 0);
});

// --- synergyMultiplier --------------------------------------------------------

test("synergyMultiplier: boundaries are inclusive on the low side of each band", () => {
  assert.strictEqual(synergyMultiplier(80), 1.1);
  assert.strictEqual(synergyMultiplier(105), 1.1); // exactly 105 -> still the top band
  assert.strictEqual(synergyMultiplier(105.01), 1.0);
  assert.strictEqual(synergyMultiplier(125), 1.0); // exactly 125 -> still the mid band
  assert.strictEqual(synergyMultiplier(125.01), 0.85);
  assert.strictEqual(synergyMultiplier(150), 0.85);
});

// --- playerScore ---------------------------------------------------------------

test("playerScore: total is the sum of op and dir", () => {
  const result = playerScore(modernStarter);
  assert.strictEqual(result.op, offenseScore(modernStarter));
  assert.strictEqual(result.dir, defensiveImpactRating(modernStarter));
  assert.strictEqual(result.total, result.op + result.dir);
});

// --- teamScore -------------------------------------------------------------------

test("teamScore: finalScore is sum(op+dir over 5 starters) * synergy multiplier", () => {
  const roster = mockRoster();
  const result = teamScore(roster);

  const expectedSumTotal = roster.reduce((sum, p) => sum + offenseScore(p) + defensiveImpactRating(p), 0);
  const expectedUsage = roster.reduce((sum, p) => sum + p.usagePct, 0);
  const expectedMs = synergyMultiplier(expectedUsage);

  assert.strictEqual(result.sumUsagePct, expectedUsage);
  assert.strictEqual(result.synergyMultiplier, expectedMs);
  assert.strictEqual(result.finalScore, expectedSumTotal * expectedMs);
  assert.strictEqual(result.playerScores.length, 5);
});

test("teamScore: throws if roster is not exactly 5 players (no bench slot in this app)", () => {
  assert.throws(() => teamScore(mockRoster().slice(0, 4)), /exactly 5/);
  assert.throws(() => teamScore([...mockRoster(), { ...modernStarter }]), /exactly 5/);
});

test("teamScore: missing usagePct is treated as 0 contribution, not a crash", () => {
  const roster = mockRoster().map((p) => ({ ...p, usagePct: undefined }));
  const result = teamScore(roster);
  assert.strictEqual(result.sumUsagePct, 0);
  assert.strictEqual(result.synergyMultiplier, 1.1);
});

// --- winProbability ----------------------------------------------------------------

test("winProbability: equal scores split 50/50", () => {
  const { probA, probB } = winProbability(100, 100);
  assert.strictEqual(probA, 0.5);
  assert.strictEqual(probB, 0.5);
});

test("winProbability: probA and probB always sum to 1", () => {
  const { probA, probB } = winProbability(140, 95);
  assert.ok(Math.abs(probA + probB - 1) < 1e-12);
});

test("winProbability: higher score has probA > 0.5, and the pairing is symmetric", () => {
  const ahead = winProbability(150, 100);
  const behind = winProbability(100, 150);
  assert.ok(ahead.probA > 0.5);
  assert.ok(Math.abs(ahead.probA - behind.probB) < 1e-12);
});

test("winProbability: a bigger lead produces a more lopsided probability", () => {
  const smallLead = winProbability(110, 100);
  const bigLead = winProbability(160, 100);
  assert.ok(bigLead.probA > smallLead.probA);
});

// --- rankTeams -----------------------------------------------------------------------

test("rankTeams: sorts descending by finalScore and assigns rank 1..N", () => {
  const teams = [
    { id: "low", roster: mockRoster().map((p) => ({ ...p, pts: p.pts - 5 })) },
    { id: "high", roster: mockRoster().map((p) => ({ ...p, pts: p.pts + 10 })) },
    { id: "mid", roster: mockRoster() },
  ];

  const ranked = rankTeams(teams);

  assert.strictEqual(ranked.length, 3);
  assert.strictEqual(ranked[0].rank, 1);
  assert.strictEqual(ranked[1].rank, 2);
  assert.strictEqual(ranked[2].rank, 3);
  assert.ok(ranked[0].finalScore >= ranked[1].finalScore);
  assert.ok(ranked[1].finalScore >= ranked[2].finalScore);
  assert.strictEqual(ranked[0].id, "high");
});

// --- pairwiseMatchups ------------------------------------------------------------------

test("pairwiseMatchups: 4 teams produce 6 unique matchups (4 choose 2)", () => {
  const teams = [
    { id: "a", finalScore: 200 },
    { id: "b", finalScore: 180 },
    { id: "c", finalScore: 150 },
    { id: "d", finalScore: 120 },
  ];

  const matchups = pairwiseMatchups(teams);
  assert.strictEqual(matchups.length, 6);

  const pairKeys = new Set(matchups.map((m) => `${m.teamAId}-${m.teamBId}`));
  assert.strictEqual(pairKeys.size, 6);

  for (const m of matchups) {
    assert.ok(Math.abs(m.probA + m.probB - 1) < 1e-12);
  }
});
