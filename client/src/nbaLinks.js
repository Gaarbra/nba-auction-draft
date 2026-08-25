// stats.nba.com's own per-player page uses the same numeric person id the
// app already carries as nbaPlayerId (for headshots) — no separate lookup
// needed to link a name straight to their official stats page.
export function nbaStatsUrl(nbaPlayerId) {
  return nbaPlayerId ? `https://www.nba.com/stats/player/${nbaPlayerId}` : null;
}
