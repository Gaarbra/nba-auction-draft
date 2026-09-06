// Real logo artwork, hotlinked from the NBA's own official CDN -- same
// pattern already used for player headshots (PlayerHeadshot.jsx pulls from
// ak-static.cms.nba.com; this pulls from cdn.nba.com), not a downloaded/
// re-hosted copy. Team ids are nba_api's own static team list
// (nba_api.stats.static.teams.get_teams(), the exact same 30 real ids
// stats-service already has bundled offline) -- not guessed.
const CURRENT_TEAM_IDS = {
  ATL: 1610612737,
  BKN: 1610612751,
  BOS: 1610612738,
  CHA: 1610612766,
  CHI: 1610612741,
  CLE: 1610612739,
  DAL: 1610612742,
  DEN: 1610612743,
  DET: 1610612765,
  GSW: 1610612744,
  HOU: 1610612745,
  IND: 1610612754,
  LAC: 1610612746,
  LAL: 1610612747,
  MEM: 1610612763,
  MIA: 1610612748,
  MIL: 1610612749,
  MIN: 1610612750,
  NOP: 1610612740,
  NYK: 1610612752,
  OKC: 1610612760,
  ORL: 1610612753,
  PHI: 1610612755,
  PHX: 1610612756,
  POR: 1610612757,
  SAC: 1610612758,
  SAS: 1610612759,
  TOR: 1610612761,
  UTA: 1610612762,
  WAS: 1610612764,
};

// This is the actual "changes based on era" mechanism: a historical
// abbreviation resolves to whichever CURRENT franchise carries that
// lineage, so a 1990s Sonics player shows the real Thunder logo and a
// 1990s Hornets player shows the real (current) Hornets logo, while a
// 2020s Thunder/Hornets player shows the exact same logo -- correctly,
// since it's the same team. This is NOT the same as showing the actual
// vintage crest a team wore in that decade (the SuperSonics' own logo, the
// teal-era Hornets' own logo, etc.) -- there's no rights-clear, always-live
// source for that period-accurate artwork the way there is for each
// franchise's current official mark, and downloading/embedding a personal
// copy of dozens of real vintage trademarks is a meaningfully different
// (and riskier) thing to do than hotlinking a team's own live official CDN
// asset the way this file and PlayerHeadshot.jsx both already do.
//
// Deliberately conservative: only relocations/renames with well-documented,
// widely-agreed lineage are listed. A historical code left out (mostly
// 1940s-50s BAA/early-NBA teams -- Anderson Packers, the Providence
// Steamrollers, Sheboygan, the original Baltimore/St. Louis/Chicago-era
// teams whose exact lineage isn't confidently resolvable here, etc.) just
// falls through to the plain colored-initials badge below, same as any
// other unmapped code -- guessing a lineage would risk stating a false
// team history, which is worse than a neutral badge.
const HISTORICAL_ALIASES = {
  SEA: "OKC", // Seattle SuperSonics -> Oklahoma City Thunder, 2008
  VAN: "MEM", // Vancouver Grizzlies -> Memphis Grizzlies, 2001
  NOH: "NOP", // New Orleans Hornets -> Pelicans
  NOK: "NOP", // New Orleans/Oklahoma City Hornets (post-Katrina) -> Pelicans
  NOJ: "UTA", // New Orleans Jazz -> Utah Jazz, 1979 (not the Hornets/Pelicans lineage)
  NJN: "BKN", // New Jersey Nets -> Brooklyn Nets, 2012
  KCK: "SAC", // Kansas City Kings -> Sacramento Kings, 1985
  CIN: "SAC", // Cincinnati Royals -> ... -> Sacramento Kings
  ROC: "SAC", // Rochester Royals -> ... -> Sacramento Kings
  PHO: "PHX", // older abbreviation for the same Phoenix Suns franchise
  CHH: "CHA", // original Charlotte Hornets; NBA reassigned this history to CHA in 2014
  UTH: "UTA", // alternate abbreviation for the same Utah Jazz franchise
  PHW: "GSW", // Philadelphia Warriors -> Golden State Warriors, 1962
  SFW: "GSW", // San Francisco Warriors -> Golden State Warriors, 1971
  FTW: "DET", // Fort Wayne Pistons -> Detroit Pistons, 1957
  MNL: "LAL", // Minneapolis Lakers -> Los Angeles Lakers, 1960
  SYR: "PHI", // Syracuse Nationals -> Philadelphia 76ers, 1963
  TCB: "ATL", // Tri-Cities Blackhawks -> ... -> Atlanta Hawks
  MIH: "ATL", // Milwaukee Hawks -> ... -> Atlanta Hawks
  STL: "ATL", // St. Louis Hawks -> Atlanta Hawks, 1968
  SDC: "LAC", // San Diego Clippers -> Los Angeles Clippers, 1984
  SDR: "HOU", // San Diego Rockets -> Houston Rockets, 1971
};

/** Real logo URL for a team abbreviation, or null when there's no confident
 * mapping (an unmapped historical code, or no abbreviation at all) -- the
 * caller (TeamBadge) falls back to a colored-initials badge in that case,
 * never a broken image. */
export function getTeamLogoUrl(abbreviation) {
  if (!abbreviation) return null;
  const abbr = abbreviation.toUpperCase();
  const current = HISTORICAL_ALIASES[abbr] || abbr;
  const id = CURRENT_TEAM_IDS[current];
  if (!id) return null;
  return `https://cdn.nba.com/logos/nba/${id}/global/L/logo.svg`;
}
