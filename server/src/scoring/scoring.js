// @ts-check

/**
 * Post-draft team scoring. Pure functions only — no I/O, no framework
 * dependencies, no knowledge of rooms/sockets/etc. Given the same inputs,
 * these always return the same outputs, which is what makes them safe to
 * unit test in isolation and reuse from both the server and, later, a
 * results-screen preview.
 *
 * Formulas (as specified):
 *   TS%  = PTS / (2 * (FGA + 0.44 * FTA))
 *   Op   = (PTS * TS%) + (AST * 1.5) - (TOV * 2.0)
 *   DIR  = (STL * 2.5) + (BLK * 2.0)                    [stats tracked]
 *        = (Season DWS / Games Played) * 100            [stats untracked, pre-1974]
 *   Ms   = 1.10 if sum(USG%) <= 105
 *        = 1.00 if 105 < sum(USG%) <= 125
 *        = 0.85 if sum(USG%) > 125
 *   Final Team Score = sum(Op + DIR across 5 starters) * Ms
 */

/** @typedef {{
 *   pts: number, fga: number, fta: number, ast: number, tov: number,
 *   stl: number | null, blk: number | null,
 *   seasonDWS?: number | null, gamesPlayed?: number | null,
 *   usagePct?: number
 * }} PlayerStatLine */

const ROSTER_SIZE = 5;

/**
 * TS% with a guarded zero-division: a player who never attempted a shot
 * or free throw (FGA=0 and FTA=0) has an undefined shooting percentage,
 * not an infinite or NaN one — treated as 0 so downstream math stays finite.
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
 * Steals and blocks were not tracked by the NBA before the 1973-74 season.
 * Our stats pipeline (server/src/services/... via stats-service) already
 * represents that as `stl`/`blk` being `null` rather than `0` — a real
 * measured zero-steal game is not the same thing as "this stat doesn't
 * exist for this era". This function keys off that null distinction rather
 * than sniffing for a literal 0, which is a more faithful (and safer)
 * implementation of "untracked" than the literal value comparison.
 * @param {{ stl: number | null, blk: number | null, seasonDWS?: number | null, gamesPlayed?: number | null }} stats
 * @returns {number}
 */
export function defensiveImpactRating({ stl, blk, seasonDWS, gamesPlayed }) {
  const tracked = stl != null && blk != null;
  if (tracked) {
    return stl * 2.5 + blk * 2.0;
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
 * Simple logistic win-probability estimate from the delta between two
 * Final Team Scores. Not statistically fitted to real outcome data — it's
 * a documented heuristic, tuned so that a ~50-point score gap (a
 * substantial but not implausible edge given the scale of these formulas)
 * lands around a 73/27 split, rather than snapping straight to near-0/100.
 * SCALE_K is the one knob; raise it to make the same delta feel more
 * decisive, lower it to flatten predictions toward a coin flip.
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
