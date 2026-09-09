// @ts-check

/**
 * Bridges raw stats-service output, real box-score numbers, some of which
 * are genuinely missing for older eras rather than just unfetched, into the
 * PlayerStatLine shape scoring.js expects. There are two labeled fallback
 * estimates in here:
 *
 * 1. USG% before 1996-97. stats.nba.com has no Advanced stats that far
 *    back, from any source that isn't scraping. This estimates it from
 *    shot volume relative to minutes played, calibrated so that 15
 *    shot-equivalents per 36 minutes reads as a roughly league-average 20%
 *    usage rate.
 *
 * 2. Defensive Win Shares, used as the pre-1974 DIR fallback. DWS is a
 *    Basketball-Reference metric with no official NBA equivalent, and we
 *    deliberately don't scrape BR (it's against their ToS, and a fragile
 *    thing to depend on anyway). This estimates it from rebounds per game,
 *    calibrated so a strong rebounding season (around 15 REB/g) lands
 *    around a DIR of 5, roughly in scale with a modern plus-defender's real
 *    STL/BLK score. It's one fixed calibration point, not a real per-era
 *    fit, so treat it as "in the right ballpark" rather than a precise era
 *    adjustment.
 *
 * Both estimates are flagged so downstream code can tell a real number from
 * an approximation: USG% explicitly via `usagePctEstimated`, and DWS
 * implicitly, since scoring.js only reaches for the DIR estimate once it
 * detects untracked STL/BLK in the first place.
 */

const USG_SHOT_EQUIV_BASELINE_PER_36 = 15; // "average" workload -> ~20% usage
const USG_ESTIMATE_SCALE = 20 / USG_SHOT_EQUIV_BASELINE_PER_36;
const USG_ESTIMATE_MIN = 5;
const USG_ESTIMATE_MAX = 45;

const DWS_REB_BASELINE_PER_GAME = 15; // strong rebounding season
const DWS_TARGET_DIR_AT_BASELINE = 5; // target DIR for that rebounding rate

/**
 * @param {{ fgaPerGame?: number|null, ftaPerGame?: number|null, tovPerGame?: number|null, minutesPerGame?: number|null }} stats
 * @returns {number}
 */
export function estimateUsagePct({ fgaPerGame, ftaPerGame, tovPerGame, minutesPerGame }) {
  if (!minutesPerGame) return 0;

  const shotEquiv = (fgaPerGame ?? 0) + 0.44 * (ftaPerGame ?? 0) + (tovPerGame ?? 0);
  const shotEquivPer36 = shotEquiv * (36 / minutesPerGame);
  const estimate = shotEquivPer36 * USG_ESTIMATE_SCALE;

  return Math.min(USG_ESTIMATE_MAX, Math.max(USG_ESTIMATE_MIN, Math.round(estimate * 10) / 10));
}

/**
 * Builds a synthetic "season DWS" that, once run through scoring.js's
 * existing (seasonDWS / gamesPlayed) * 100 formula, reproduces the
 * rebound-based DIR estimate described above. It's shaped this way instead
 * of changing scoring.js's interface, so that file's already-tested pure
 * functions stay untouched, and all the estimation logic stays in one
 * documented place: here.
 * @param {{ reboundsPerGame?: number|null, gamesPlayed: number }} stats
 * @returns {number}
 */
export function estimateSeasonDWS({ reboundsPerGame, gamesPlayed }) {
  if (!gamesPlayed) return 0;
  const reb = reboundsPerGame ?? 0;
  const targetDirPerGame = (reb / DWS_REB_BASELINE_PER_GAME) * DWS_TARGET_DIR_AT_BASELINE;
  return (targetDirPerGame / 100) * gamesPlayed;
}

/**
 * @param {{
 *   pointsPerGame?: number|null, fgaPerGame?: number|null, ftaPerGame?: number|null,
 *   assistsPerGame?: number|null, tovPerGame?: number|null,
 *   stealsPerGame?: number|null, blocksPerGame?: number|null,
 *   reboundsPerGame?: number|null, minutesPerGame?: number|null,
 *   gamesPlayed: number, usagePct?: number|null
 * }} rawStats Raw `stats` payload from stats-service's /full-stats.
 * @returns {import("./scoring.js").PlayerStatLine & { usagePctEstimated: boolean }}
 */
export function toPlayerStatLine(rawStats) {
  const usagePctEstimated = rawStats.usagePct == null;
  const usagePct = usagePctEstimated ? estimateUsagePct(rawStats) : rawStats.usagePct;

  return {
    pts: rawStats.pointsPerGame ?? 0,
    fga: rawStats.fgaPerGame ?? 0,
    fta: rawStats.ftaPerGame ?? 0,
    ast: rawStats.assistsPerGame ?? 0,
    // Turnovers weren't tracked before 1977-78; there's no principled estimate
    // for them (unlike USG%/DWS above), so an untracked TOV is treated as 0.
    // This is a known, minor bias in favor of very old players' Op scores.
    tov: rawStats.tovPerGame ?? 0,
    stl: rawStats.stealsPerGame ?? null,
    blk: rawStats.blocksPerGame ?? null,
    // Feeds the tracked-era DIR branch's small rebounding term (see
    // REB_WEIGHT in scoring.js). This is a separate use from this same
    // reboundsPerGame value just below, which seeds the pre-1974 DWS
    // estimate instead.
    reb: rawStats.reboundsPerGame ?? 0,
    seasonDWS: estimateSeasonDWS(rawStats),
    gamesPlayed: rawStats.gamesPlayed,
    usagePct,
    usagePctEstimated,
  };
}
