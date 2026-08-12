import { toPlayerStatLine } from "./statsAdapter.js";
import { rankTeams, pairwiseMatchups } from "./scoring.js";
import { fetchFullPlayerStats } from "../services/statsClient.js";

const POSITIONS = ["PG", "SG", "SF", "PF", "C"];

/**
 * Fetches full stats (including FGA/FTA/TOV/USG%) for every player on every
 * roster in a completed room, scores each team, and ranks them. This is a
 * one-time, post-draft computation — not part of the live draft loop — so
 * it's fine for it to take a while (up to ~20 stats-service calls).
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
  const teamsInput = [];
  const displayByTeam = {};

  for (const player of room.players) {
    const roster = room.draft.rosters[player.id];
    const statLines = [];
    const display = [];

    for (const pos of POSITIONS) {
      const drafted = roster[pos];
      const rawStats = drafted ? await fetchFullPlayerStats(drafted.id) : null;
      const statLine = toPlayerStatLine(rawStats || { gamesPlayed: 0, usagePct: null });

      statLines.push(statLine);
      display.push({
        slot: pos,
        fullName: drafted?.fullName ?? null,
        nbaPlayerId: drafted?.nbaPlayerId ?? null,
        realPosition: drafted?.position ?? null,
        acquiredFor: drafted?.acquiredFor ?? null,
        usagePctEstimated: statLine.usagePctEstimated,
      });
    }

    teamsInput.push({ id: player.id, roster: statLines });
    displayByTeam[player.id] = display;
  }

  const rankedTeams = rankTeams(teamsInput);
  const matchups = pairwiseMatchups(rankedTeams);

  const teams = rankedTeams.map((team) => ({
    id: team.id,
    playerName: room.players.find((p) => p.id === team.id)?.name ?? "Unknown",
    rank: team.rank,
    finalScore: team.finalScore,
    sumUsagePct: team.breakdown.sumUsagePct,
    synergyMultiplier: team.breakdown.synergyMultiplier,
    roster: displayByTeam[team.id].map((slotInfo, i) => ({
      ...slotInfo,
      op: team.breakdown.playerScores[i].op,
      dir: team.breakdown.playerScores[i].dir,
      total: team.breakdown.playerScores[i].total,
    })),
  }));

  return { teams, matchups, computedAt: Date.now() };
}
