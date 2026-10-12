export async function loadMarketCatalogue(url, request = fetch) {
  const response = await request(url);
  if (!response.ok) throw new Error("Player catalogue unavailable");
  const data = await response.json();
  if (!Array.isArray(data.players)) throw new Error("Invalid player catalogue");
  return data.players;
}

// Seasons belong to the decade in which they began. Do not infer team dates
// from draft year or from the span between two separate stints.
export function marketTeams(player, era = "all") {
  const start = Number.parseInt(era, 10);
  const inEra = season => Number.parseInt(season, 10) >= start && Number.parseInt(season, 10) <= start + 9;
  const matches = new Set();
  for (const stint of player.teamHistory || []) {
    if (era === "all" || stint.seasons?.some(inEra)) matches.add(stint.abbreviation);
  }
  if (player.currentTeam && (era === "all" || inEra(player.rosterSeason))) matches.add(player.currentTeam);
  if (era === "all" && !matches.size && player.team) matches.add(player.team);
  return [...matches].filter(team => team && team !== "TOT");
}

export function playedInMarketEra(player, era) {
  if (era === "all" || marketTeams(player, era).length) return true;
  if (player.teamHistory?.some(stint => Array.isArray(stint.seasons))) return false;
  const start = Number.parseInt(era, 10);
  const first = Number.parseInt(player.firstSeason, 10);
  const last = Number.parseInt(player.lastSeason, 10);
  return first <= start + 9 && last >= start;
}
