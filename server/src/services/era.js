export const ERA_BUCKETS = [
  { id: "1950s", label: "1950s", start: 1950, end: 1959 },
  { id: "1960s", label: "1960s", start: 1960, end: 1969 },
  { id: "1970s", label: "1970s", start: 1970, end: 1979 },
  { id: "1980s", label: "1980s", start: 1980, end: 1989 },
  { id: "1990s", label: "1990s", start: 1990, end: 1999 },
  { id: "2000s", label: "2000s", start: 2000, end: 2009 },
  { id: "2010s", label: "2010s", start: 2010, end: 2019 },
  { id: "2020s", label: "2020s", start: 2020, end: 2029 },
];

/** Decade bucket a player's career start (fromYear) falls into. */
export function getEraId(fromYear) {
  if (fromYear == null) return "other";
  const bucket = ERA_BUCKETS.find((b) => fromYear >= b.start && fromYear <= b.end);
  return bucket ? bucket.id : "other";
}

/**
 * "active" is a special filter (real players currently on an NBA roster,
 * via nba_api's ROSTERSTATUS flag) rather than a decade bucket — a player
 * can be both "active" and "2020s" at once, so it's checked independently
 * of the fromYear-based decade buckets.
 */
export function filterPlayersByEra(players, eraId) {
  if (!eraId || eraId === "all") return players;
  if (eraId === "active") return players.filter((p) => p.isActive);
  return players.filter((p) => getEraId(p.fromYear) === eraId);
}

export function summarizeEras(players) {
  const counts = new Map();
  let activeCount = 0;
  for (const p of players) {
    const eraId = getEraId(p.fromYear);
    counts.set(eraId, (counts.get(eraId) || 0) + 1);
    if (p.isActive) activeCount += 1;
  }

  const summary = [
    { id: "all", label: "All Eras", count: players.length },
    { id: "active", label: "Active Now", count: activeCount },
  ];
  for (const bucket of ERA_BUCKETS) {
    summary.push({ id: bucket.id, label: bucket.label, count: counts.get(bucket.id) || 0 });
  }

  return summary;
}
