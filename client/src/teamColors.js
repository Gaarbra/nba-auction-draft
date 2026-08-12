// Primary/secondary brand colors per NBA team, keyed by the abbreviation the
// stats pipeline returns (see stats-service/app.py). Covers the 30 current
// franchises plus abbreviations that show up for historical/relocated teams
// in older-era data. Anything unmapped falls back to the app's neutral
// accent color rather than breaking the layout.
const TEAM_COLORS = {
  ATL: { primary: "#E03A3E", secondary: "#26282A" },
  BOS: { primary: "#007A33", secondary: "#BA9653" },
  BKN: { primary: "#000000", secondary: "#FFFFFF" },
  NJN: { primary: "#00479B", secondary: "#FFFFFF" },
  CHA: { primary: "#1D1160", secondary: "#00788C" },
  CHH: { primary: "#008CA8", secondary: "#1D1160" },
  CHI: { primary: "#CE1141", secondary: "#000000" },
  CLE: { primary: "#860038", secondary: "#FDBB30" },
  DAL: { primary: "#00538C", secondary: "#B8C4CA" },
  DEN: { primary: "#0E2240", secondary: "#FEC524" },
  DET: { primary: "#C8102E", secondary: "#1D42BA" },
  GSW: { primary: "#1D428A", secondary: "#FFC72C" },
  HOU: { primary: "#CE1141", secondary: "#000000" },
  IND: { primary: "#002D62", secondary: "#FDBB30" },
  LAC: { primary: "#C8102E", secondary: "#1D428A" },
  LAL: { primary: "#552583", secondary: "#FDB927" },
  MEM: { primary: "#5D76A9", secondary: "#12173F" },
  VAN: { primary: "#00B2A9", secondary: "#12173F" },
  MIA: { primary: "#98002E", secondary: "#F9A01B" },
  MIL: { primary: "#00471B", secondary: "#EEE1C6" },
  MIN: { primary: "#0C2340", secondary: "#236192" },
  NOP: { primary: "#0C2340", secondary: "#B4975A" },
  NOH: { primary: "#00788C", secondary: "#B4975A" },
  NOK: { primary: "#00788C", secondary: "#B4975A" },
  NYK: { primary: "#006BB6", secondary: "#F58426" },
  OKC: { primary: "#007AC1", secondary: "#EF3B24" },
  SEA: { primary: "#00653A", secondary: "#FFC200" },
  ORL: { primary: "#0077C0", secondary: "#000000" },
  PHI: { primary: "#006BB6", secondary: "#ED174C" },
  PHX: { primary: "#1D1160", secondary: "#E56020" },
  PHO: { primary: "#1D1160", secondary: "#E56020" },
  POR: { primary: "#E03A3E", secondary: "#000000" },
  SAC: { primary: "#5A2D81", secondary: "#63727A" },
  KCK: { primary: "#5A2D81", secondary: "#63727A" },
  SAS: { primary: "#C4CED4", secondary: "#000000" },
  TOR: { primary: "#CE1141", secondary: "#000000" },
  UTA: { primary: "#002B5C", secondary: "#F9A01B" },
  WAS: { primary: "#002B5C", secondary: "#E31837" },
  WSB: { primary: "#002B5C", secondary: "#E31837" },
};

const FALLBACK = { primary: "#7a3a10", secondary: "#34495e" };

export function getTeamColors(abbreviation) {
  if (!abbreviation) return FALLBACK;
  return TEAM_COLORS[abbreviation.toUpperCase()] || FALLBACK;
}
