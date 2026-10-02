import { playerScore } from "../scoring/scoring.js";
import { toPlayerStatLine } from "../scoring/statsAdapter.js";

const FIELDS = ["pointsPerGame", "reboundsPerGame", "assistsPerGame", "stealsPerGame", "blocksPerGame", "fgaPerGame", "ftaPerGame", "tovPerGame", "minutesPerGame", "usagePct", "gamesPlayed"];

export function validSeasonStats(stats, season) {
  return stats?.statsBasis === "season" && stats.season === season && stats.gamesPlayed > 0
    && FIELDS.every((field) => Number.isFinite(stats[field]) && stats[field] >= 0);
}

export function prepareActiveSnapshot(snapshot) {
  if (!/^\d{4}-\d{2}$/.test(snapshot?.season) || !Array.isArray(snapshot.players)
      || !Number.isFinite(snapshot.fetchedAt) || Date.now() / 1000 - snapshot.fetchedAt > 8 * 86400) {
    throw new Error("ACTIVE_NOW_UNAVAILABLE");
  }
  const seen = new Set();
  const players = snapshot.players.filter((p) => {
    if (!Number.isInteger(p.id) || !p.isActive || !p.fullName || seen.has(p.id) || !validSeasonStats(p.stats, snapshot.season)) return false;
    seen.add(p.id);
    return true;
  }).map((p) => ({ ...p, seasonScore: Math.max(0, playerScore(toPlayerStatLine(p.stats)).total) }))
    .sort((a, b) => b.seasonScore - a.seasonScore);
  if (!players.length) throw new Error("ACTIVE_NOW_UNAVAILABLE");
  const average = players.reduce((sum, p) => sum + p.seasonScore, 0) / players.length || 1;
  return { ...snapshot, players: players.map((p) => ({ ...p,
    // A five-player roster has 20 coins. Compare value within this season only.
    suggestedPrice: Math.round(Math.min(16, Math.max(1, 4 * p.seasonScore / average)) * 10) / 10,
  })) };
}

export async function fetchActiveSnapshot() {
  const response = await fetch(`${process.env.STATS_SERVICE_URL || "http://127.0.0.1:5001"}/active-now`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("ACTIVE_NOW_UNAVAILABLE");
  return prepareActiveSnapshot(await response.json());
}

export function drawActivePlayer(room, excludeIds = [], random = Math.random) {
  const excluded = new Set([...(room.draft?.draftedPlayerIds || []), ...excludeIds]);
  const ranked = room.activeNowSnapshot.players;
  // Difficulty tiers derive solely from this season's scoring, never career honours.
  const fraction = room.difficulty === "veryeasy" ? 0.15
    : room.difficulty === "easy" && random() < 0.75 ? 0.35
      : room.difficulty === "normal" && random() < 0.5 ? 0.6 : 1;
  const available = ranked.filter((p) => !excluded.has(p.id));
  const tier = ranked.slice(0, Math.max(20, Math.ceil(ranked.length * fraction))).filter((p) => !excluded.has(p.id));
  const pool = tier.length ? tier : available;
  return pool.length ? { player: pool[Math.floor(random() * pool.length)] } : { error: "NO_PLAYERS_LEFT" };
}
