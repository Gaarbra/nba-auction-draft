import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, "..", "..", "..", "db", "schema.sql");

const DATABASE_URL = process.env.DATABASE_URL || null;

// Entirely optional, same philosophy as stats-service/db.py: with no
// DATABASE_URL, `pool` stays null and every exported function becomes a
// no-op — the app plays exactly as it did before there was a database at
// all. With one set, every completed draft also gets written here, so the
// generated-data tables (drafts/draft_teams/draft_picks — see
// db/schema.sql) build up organically from real games instead of needing a
// separate import step.
const pool = DATABASE_URL ? new pg.Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 5000 }) : null;

export async function initSchema() {
  if (!pool) return;
  try {
    const schemaSql = await readFile(SCHEMA_PATH, "utf-8");
    await pool.query(schemaSql);
    console.log("[db] schema ready");
  } catch (err) {
    console.warn(`[db] schema init failed: ${err.message}`);
  }
}

/**
 * Persists one completed draft — the room's settings, every team's final
 * standing, and every filled roster slot — as a single transaction. Called
 * once, right after computeDraftResults resolves (see maybeComputeResults
 * in roomHandlers.js). Failures are logged and swallowed, never thrown:
 * losing the analytics record for one draft shouldn't take down the game
 * that already finished successfully for the players in it.
 */
export async function saveDraftResults(room, results) {
  if (!pool) return;

  const client = await pool.connect().catch((err) => {
    console.warn(`[db] connection failed, skipping draft persistence: ${err.message}`);
    return null;
  });
  if (!client) return;

  try {
    await client.query("BEGIN");

    const draftInsert = await client.query(
      `INSERT INTO drafts (room_code, era, difficulty, allow_position_swaps, is_local)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [room.code, room.draftEra || "all", room.difficulty || null, Boolean(room.allowPositionSwaps), Boolean(room.isLocal)]
    );
    const draftId = draftInsert.rows[0].id;

    for (const team of results.teams) {
      const teamInsert = await client.query(
        `INSERT INTO draft_teams (draft_id, player_name, rank, final_score, sum_usage_pct, synergy_multiplier, forfeited)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [draftId, team.playerName, team.rank, team.finalScore, team.sumUsagePct, team.synergyMultiplier, Boolean(team.forfeited)]
      );
      const draftTeamId = teamInsert.rows[0].id;

      for (const pick of team.roster) {
        // draft_picks.player_id has a foreign key into players(id), but
        // stats-service (Python) owns writing real player rows and might
        // not have gotten to this one yet — e.g. their stats fetch failed
        // and nominatePlayer stored them as "unavailable" anyway. Ensure a
        // minimal stub row exists first so that FK never rejects an
        // otherwise-valid pick; ON CONFLICT DO NOTHING means this never
        // clobbers the richer row stats-service will fill in later.
        if (pick.nbaPlayerId != null) {
          await client.query(
            `INSERT INTO players (id, full_name, is_active, updated_at)
             VALUES ($1, $2, false, now())
             ON CONFLICT (id) DO NOTHING`,
            [pick.nbaPlayerId, pick.fullName || `Player ${pick.nbaPlayerId}`]
          );
        }

        await client.query(
          `INSERT INTO draft_picks (draft_team_id, player_id, slot, acquired_for, op_score, dir_score, total_score, usage_pct_estimated)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            draftTeamId,
            pick.nbaPlayerId ?? null,
            pick.slot,
            pick.acquiredFor ?? null,
            pick.op ?? null,
            pick.dir ?? null,
            pick.total ?? null,
            Boolean(pick.usagePctEstimated),
          ]
        );
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.warn(`[db] failed to persist draft for room ${room.code}: ${err.message}`);
  } finally {
    client.release();
  }
}
