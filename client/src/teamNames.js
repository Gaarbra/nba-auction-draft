// Display names for the historical/relocated franchise codes in
// teamLogos.js's HISTORICAL_ALIASES -- that map resolves an old abbreviation
// to its current-lineage logo, but the abbreviation itself (MNL, TCB, SYR...)
// means nothing to a player who wasn't around for it. This is the other half:
// what to actually call the team. Covers the same codes, nothing more.
const HISTORICAL_TEAM_NAMES = {
  SEA: "Seattle SuperSonics",
  VAN: "Vancouver Grizzlies",
  NOH: "New Orleans Hornets",
  NOK: "New Orleans/Oklahoma City Hornets",
  NOJ: "New Orleans Jazz",
  NJN: "New Jersey Nets",
  KCK: "Kansas City Kings",
  CIN: "Cincinnati Royals",
  ROC: "Rochester Royals",
  PHO: "Phoenix Suns",
  CHH: "Charlotte Hornets",
  UTH: "Utah Jazz",
  PHW: "Philadelphia Warriors",
  SFW: "San Francisco Warriors",
  FTW: "Fort Wayne Pistons",
  MNL: "Minneapolis Lakers",
  SYR: "Syracuse Nationals",
  TCB: "Tri-Cities Blackhawks",
  MIH: "Milwaukee Hawks",
  STL: "St. Louis Hawks",
  SDC: "San Diego Clippers",
  SDR: "San Diego Rockets",
};

/** The historical franchise name for a code, or null when it's a current
 * abbreviation (or unmapped) -- callers fall back to showing the plain
 * abbreviation in that case, same "never invent a name" stance as
 * teamLogos.js. */
export function getHistoricalTeamName(abbreviation) {
  if (!abbreviation) return null;
  return HISTORICAL_TEAM_NAMES[abbreviation.toUpperCase()] || null;
}
