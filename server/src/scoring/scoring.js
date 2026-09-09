// @ts-check

/**
 * Post-draft team scoring. Everything in here is a pure function: no I/O,
 * no framework dependencies, no knowledge of rooms or sockets. Same
 * inputs always give the same outputs, which is what makes these easy to
 * unit test on their own and reuse anywhere (the server today, maybe a
 * results-screen preview later).
 *
 * The formulas:
 *   TS%  = PTS / (2 * (FGA + 0.44 * FTA))
 *   Op   = (PTS * TS%) + (AST * 1.5) - (TOV * 2.0)
 *   DIR  = (STL * 2.5) + (BLK * 2.0) + (REB * 0.3)      [stats tracked]
 *        = (Season DWS / Games Played) * 100            [stats untracked, pre-1974]
 *   Ms   = 1.10 if sum(USG%) <= 105
 *        = 1.00 if 105 < sum(USG%) <= 125
 *        = 0.85 if sum(USG%) > 125
 *   Final Team Score = sum(Op + DIR across 5 starters) * Ms
 *
 * One thing worth knowing if you're new to this file: every stat here
 * (PTS, AST, TOV, STL, BLK, REB) is a PER-GAME average, not a season
 * total. If you mixed the two, Op and DIR would end up on wildly
 * different scales, since a season point total is in the hundreds while
 * per-game assists is a single digit, and adding them together would be
 * meaningless. statsAdapter.js is the file that does that per-game
 * shaping. scoring.js itself never touches a season total.
 */

/** @typedef {{
 *   pts: number, fga: number, fta: number, ast: number, tov: number,
 *   stl: number | null, blk: number | null, reb?: number,
 *   seasonDWS?: number | null, gamesPlayed?: number | null,
 *   usagePct?: number
 * }} PlayerStatLine */

const ROSTER_SIZE = 5;

// This weight is small on purpose. A dominant rebounder pulling down about
// 15 boards a game only contributes around 4.5 points here, which keeps
// rebounding in the same range as the STL/BLK terms instead of letting it
// take over the whole defensive score. It also isn't applied in the
// untracked (pre-1974) branch below, because that branch's DWS estimate is
// already built from rebounds per game (see estimateSeasonDWS in
// statsAdapter.js). Adding a second rebounding term there would just be
// counting the same signal twice.
const REB_WEIGHT = 0.3;

/**
 * True Shooting %, guarded against division by zero. If a player has no
 * field goal attempts and no free throw attempts, their shooting
 * percentage is genuinely undefined, not Infinity or NaN, so this just
 * returns 0 instead of letting the math blow up.
 * @param {{ pts: number, fga: number, fta: number }} stats
 * @returns {number}
 */
export function trueShootingPercentage({ pts, fga, fta }) {
  const denominator = 2 * (fga + 0.44 * fta);
  if (denominator === 0) return 0;
  return pts / denominator;
}

/**
 * @param {{ pts: number, fga: number, fta: number, ast: number, tov: number }} stats
 * @returns {number}
 */
export function offenseScore({ pts, fga, fta, ast, tov }) {
  const tsPct = trueShootingPercentage({ pts, fga, fta });
  return pts * tsPct + ast * 1.5 - tov * 2.0;
}

/**
 * Steals and blocks weren't officially tracked before the 1973-74 season.
 * The stats pipeline represents that gap as `stl`/`blk` being `null`,
 * not `0`, because a real game where a player recorded zero steals is a
 * completely different thing from "this stat wasn't tracked yet." So this
 * function checks for null specifically, instead of just checking whether
 * the value happens to equal 0.
 * @param {{ stl: number | null, blk: number | null, reb?: number, seasonDWS?: number | null, gamesPlayed?: number | null }} stats
 * @returns {number}
 */
export function defensiveImpactRating({ stl, blk, reb, seasonDWS, gamesPlayed }) {
  const tracked = stl != null && blk != null;
  if (tracked) {
    return stl * 2.5 + blk * 2.0 + (reb ?? 0) * REB_WEIGHT;
  }

  if (!gamesPlayed) return 0;
  const dws = seasonDWS ?? 0;
  return (dws / gamesPlayed) * 100;
}

/**
 * @param {number} sumUsagePct
 * @returns {number}
 */
export function synergyMultiplier(sumUsagePct) {
  if (sumUsagePct <= 105) return 1.1;
  if (sumUsagePct <= 125) return 1.0;
  return 0.85;
}

/**
 * @param {PlayerStatLine} stats
 * @returns {{ op: number, dir: number, total: number }}
 */
export function playerScore(stats) {
  const op = offenseScore(stats);
  const dir = defensiveImpactRating(stats);
  return { op, dir, total: op + dir };
}

/**
 * @param {PlayerStatLine[]} roster Exactly 5 starters, no bench.
 * @returns {{
 *   playerScores: Array<{ op: number, dir: number, total: number }>,
 *   sumUsagePct: number,
 *   synergyMultiplier: number,
 *   finalScore: number
 * }}
 */
export function teamScore(roster) {
  if (roster.length !== ROSTER_SIZE) {
    throw new Error(`teamScore expects exactly ${ROSTER_SIZE} players, got ${roster.length}`);
  }

  const playerScores = roster.map(playerScore);
  const sumTotal = playerScores.reduce((sum, p) => sum + p.total, 0);
  const sumUsagePct = roster.reduce((sum, p) => sum + (p.usagePct ?? 0), 0);
  const ms = synergyMultiplier(sumUsagePct);

  return {
    playerScores,
    sumUsagePct,
    synergyMultiplier: ms,
    finalScore: sumTotal * ms,
  };
}

/**
 * Turns the gap between two Final Team Scores into a win probability using
 * a logistic curve. This is a heuristic we picked by hand, not a model
 * fitted to real outcome data, and it's tuned so that a roughly 50-point
 * gap lands around a 73/27 split instead of snapping straight to near
 * 0/100. SCALE_K is the one dial here: turn it up for more decisive splits,
 * turn it down to flatten things back toward a coin flip.
 * @param {number} scoreA
 * @param {number} scoreB
 * @returns {{ probA: number, probB: number }}
 */
const WIN_PROB_SCALE_K = 0.02;

export function winProbability(scoreA, scoreB) {
  const delta = scoreA - scoreB;
  const probA = 1 / (1 + Math.exp(-WIN_PROB_SCALE_K * delta));
  return { probA, probB: 1 - probA };
}

/**
 * @param {Array<{ id: string, roster: PlayerStatLine[] }>} teams
 * @returns {Array<{ id: string, finalScore: number, rank: number, breakdown: ReturnType<typeof teamScore> }>}
 */
export function rankTeams(teams) {
  const scored = teams.map((team) => {
    const breakdown = teamScore(team.roster);
    return { id: team.id, finalScore: breakdown.finalScore, breakdown };
  });

  scored.sort((a, b) => b.finalScore - a.finalScore);

  return scored.map((team, index) => ({ ...team, rank: index + 1 }));
}

/**
 * Every unordered pair of teams, with a win-probability estimate for each
 * side. For 4 teams this returns 6 matchups (4 choose 2).
 * @param {Array<{ id: string, finalScore: number }>} rankedTeams
 * @returns {Array<{ teamAId: string, teamBId: string, probA: number, probB: number }>}
 */
export function pairwiseMatchups(rankedTeams) {
  const matchups = [];
  for (let i = 0; i < rankedTeams.length; i += 1) {
    for (let j = i + 1; j < rankedTeams.length; j += 1) {
      const teamA = rankedTeams[i];
      const teamB = rankedTeams[j];
      const { probA, probB } = winProbability(teamA.finalScore, teamB.finalScore);
      matchups.push({ teamAId: teamA.id, teamBId: teamB.id, probA, probB });
    }
  }
  return matchups;
}
