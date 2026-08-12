// @ts-check

/**
 * Bridges raw stats-service output (real box-score numbers, some of them
 * legitimately missing for older eras — not just "we didn't fetch it" but
 * genuinely absent from any accessible source) into the PlayerStatLine
 * shape scoring.js expects. Two documented, clearly-labeled fallback
 * estimates live here:
 *
 * 1. USG% before 1996-97 — stats.nba.com only started computing Advanced
 *    (usage-derived) stats that season; nothing earlier exists there, from
 *    any source that isn't Basketball-Reference. Estimated from shot volume
 *    relative to minutes played, calibrated so a "15 shot-equivalents per
 *    36 minutes" workload reads as a roughly league-average ~20% usage.
 *
 * 2. Defensive Win Shares (the pre-1974 DIR fallback) — DWS is a
 *    Basketball-Reference metric with no official-NBA equivalent. Getting
 *    the real number would mean scraping BR, which is against their ToS
 *    and a fragile target; we don't do that. Estimated from rebounds per
 *    game instead, calibrated so a strong rebounding season (~15 REB/g)
 *    lands around a DIR of 5 — comparable in scale to a modern
 *    plus-defender's STL/BLK-based score.
 *
 * Both estimates are flagged (`usagePctEstimated`) or implicit (DIR
 * estimates only ever apply when scoring.js already detects untracked
 * STL/BLK) so downstream code and the results UI can distinguish real
 * numbers from approximations.
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
 * Synthetic "season DWS" that, when run through scoring.js's existing
 * (seasonDWS / gamesPlayed) * 100 formula, reproduces the rebound-based DIR
 * estimate described above. Kept in this shape — rather than changing
 * scoring.js's interface — so that already-tested pure function stays
 * untouched; all estimation logic lives here in one documented place.
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
    seasonDWS: estimateSeasonDWS(rawStats),
    gamesPlayed: rawStats.gamesPlayed,
    usagePct,
    usagePctEstimated,
  };
}
