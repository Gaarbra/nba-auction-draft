import { toPlayerStatLine } from "./statsAdapter.js";
import { rankTeams, pairwiseMatchups } from "./scoring.js";
import { fetchFullPlayerStatsWithRetry } from "../services/statsClient.js";
import { mapWithConcurrency } from "../utils/concurrency.js";

const POSITIONS = ["PG", "SG", "SF", "PF", "C"];

// Capped, not unbounded Promise.all: stats-service (and, behind it,
// stats.nba.com) is the same rate-limited upstream the live draft loop is
// careful with — a full room's worth of slots run concurrently but not all
// 20 at once, so one results page doesn't hammer it the way an early
// version of this app's difficulty-rolling logic once did.
const STATS_FETCH_CONCURRENCY = 4;

/**
 * Fetches full stats (including FGA/FTA/TOV/USG%) for every player on every
 * roster in a completed room, scores each team, and ranks them. This is a
 * one-time, post-draft computation — not part of the live draft loop — so
 * it's fine for it to take a while, but the up-to-20 stats-service calls run
 * concurrently (capped, with retries) rather than one at a time.
 * @param {object} room A room whose draft.rosters are all full.
 * @returns {Promise<{
 *   teams: Array<{ id: string, playerName: string, rank: number, finalScore: number,
 *     sumUsagePct: number, synergyMultiplier: number,
 *     roster: Array<{ slot: string, fullName: string|null, nbaPlayerId: number|null,
 *       realPosition: string|null, acquiredFor: number|null, usagePctEstimated: boolean,
 *       op: number, dir: number, total: number }> }>,
 *   matchups: Array<{ teamAId: string, teamBId: string, probA: number, probB: number }>,
 *   computedAt: number
 * }>}
 */
export async function computeDraftResults(room) {
  // Flatten every (player, position) slot across the whole room into one
  // list up front, so the concurrency cap below applies across the entire
  // room's fetches at once — not per-team, which would still serialize
  // team-by-team and undercut the point of raising concurrency at all.
  const slots = [];
  for (const player of room.players) {
    const roster = room.draft.rosters[player.id];
    for (const pos of POSITIONS) {
      slots.push({ playerId: player.id, pos, drafted: roster[pos] });
    }
  }

  const statLines = await mapWithConcurrency(slots, STATS_FETCH_CONCURRENCY, async (slot) => {
    const rawStats = slot.drafted ? await fetchFullPlayerStatsWithRetry(slot.drafted.id) : null;
    return toPlayerStatLine(rawStats || { gamesPlayed: 0, usagePct: null });
  });

  const rosterByTeam = new Map();
  const displayByTeam = new Map();
  for (const player of room.players) {
    rosterByTeam.set(player.id, []);
    displayByTeam.set(player.id, []);
  }
  slots.forEach((slot, i) => {
    const statLine = statLines[i];
    rosterByTeam.get(slot.playerId).push(statLine);
    displayByTeam.get(slot.playerId).push({
      slot: slot.pos,
      fullName: slot.drafted?.fullName ?? null,
      nbaPlayerId: slot.drafted?.nbaPlayerId ?? null,
      realPosition: slot.drafted?.position ?? null,
      acquiredFor: slot.drafted?.acquiredFor ?? null,
      usagePctEstimated: statLine.usagePctEstimated,
    });
  });

  const teamsInput = room.players.map((player) => ({ id: player.id, roster: rosterByTeam.get(player.id) }));
  const rankedTeams = rankTeams(teamsInput);
  const matchups = pairwiseMatchups(rankedTeams);

  const teams = rankedTeams.map((team) => {
    const player = room.players.find((p) => p.id === team.id);
    const display = displayByTeam.get(team.id);
    const filledSlots = display.filter((slot) => slot.fullName).length;
    return {
      id: team.id,
      playerName: player?.name ?? "Unknown",
      forfeited: Boolean(player?.forfeited),
      filledSlots,
      rank: team.rank,
      finalScore: team.finalScore,
      sumUsagePct: team.breakdown.sumUsagePct,
      synergyMultiplier: team.breakdown.synergyMultiplier,
      roster: display.map((slotInfo, i) => ({
        ...slotInfo,
        op: team.breakdown.playerScores[i].op,
        dir: team.breakdown.playerScores[i].dir,
        total: team.breakdown.playerScores[i].total,
      })),
    };
  });

  return { teams, matchups, computedAt: Date.now() };
}
