"""Postgres persistence for player reference data (players, player_stats,
player_team_stints — see db/schema.sql at the repo root). Entirely optional:
if DATABASE_URL isn't set, every function here becomes a no-op, so the
stats-service caches (statsCache.json etc.) keep working exactly as before
with no database at all. When it IS set, every successful stats fetch also
upserts into Postgres, so the reference tables build up the same way the
JSON caches do — organically, from real usage and the warm-up job — rather
than needing a separate one-time import.
"""

import os

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:
    psycopg = None

DATABASE_URL = os.environ.get("DATABASE_URL")

_pool_warned = False


def _connect():
    """A fresh connection per call rather than a real pool — this service's
    write volume is low (one upsert per stats fetch, not per request), so
    the extra complexity of a connection pool isn't worth it yet. Returns
    None (not a connection) if DATABASE_URL isn't configured or psycopg
    isn't installed, so every caller can `if not conn: return` and stay a
    no-op."""
    global _pool_warned
    if not DATABASE_URL:
        return None
    if psycopg is None:
        if not _pool_warned:
            print("[db] DATABASE_URL is set but psycopg isn't installed — skipping persistence")
            _pool_warned = True
        return None
    try:
        return psycopg.connect(DATABASE_URL, row_factory=dict_row, connect_timeout=5)
    except Exception as e:
        print(f"[db] connection failed, skipping this write: {e.__class__.__name__}: {e}")
        return None


def init_schema():
    """Runs db/schema.sql (CREATE TABLE IF NOT EXISTS ... — safe to re-run)
    once at startup. A no-op if there's no DATABASE_URL."""
    conn = _connect()
    if not conn:
        return
    schema_path = os.path.join(os.path.dirname(__file__), "..", "db", "schema.sql")
    try:
        with open(schema_path, "r") as f:
            schema_sql = f.read()
        with conn, conn.cursor() as cur:
            cur.execute(schema_sql)
        print("[db] schema ready")
    except Exception as e:
        print(f"[db] schema init failed: {e.__class__.__name__}: {e}")
    finally:
        conn.close()


def upsert_player_and_stats(player_id, full_name, is_active, from_year, to_year, stats):
    """Called after every successful stats fetch (live or from the warm-up
    job) — writes the player's identity row and their career-stats row in
    one transaction. `stats` is the same dict shape fetch_stats_for_player
    returns (or None, if the fetch came back empty)."""
    conn = _connect()
    if not conn:
        return
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO players (id, full_name, is_active, from_year, to_year, draft_year, position, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, now())
                ON CONFLICT (id) DO UPDATE SET
                    full_name = EXCLUDED.full_name,
                    is_active = EXCLUDED.is_active,
                    from_year = EXCLUDED.from_year,
                    to_year = EXCLUDED.to_year,
                    draft_year = EXCLUDED.draft_year,
                    position = EXCLUDED.position,
                    updated_at = now()
                """,
                (
                    player_id,
                    full_name,
                    is_active,
                    from_year,
                    to_year,
                    stats.get("draftYear") if stats else None,
                    stats.get("position") if stats else None,
                ),
            )

            if stats:
                cur.execute(
                    """
                    INSERT INTO player_stats (
                        player_id, first_season, last_season, seasons_played, games_played,
                        points_per_game, rebounds_per_game, assists_per_game, steals_per_game, blocks_per_game,
                        fga_per_game, fta_per_game, tov_per_game, minutes_per_game,
                        last_team, most_played_team, usage_pct, fetched_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
                    ON CONFLICT (player_id) DO UPDATE SET
                        first_season = EXCLUDED.first_season,
                        last_season = EXCLUDED.last_season,
                        seasons_played = EXCLUDED.seasons_played,
                        games_played = EXCLUDED.games_played,
                        points_per_game = EXCLUDED.points_per_game,
                        rebounds_per_game = EXCLUDED.rebounds_per_game,
                        assists_per_game = EXCLUDED.assists_per_game,
                        steals_per_game = EXCLUDED.steals_per_game,
                        blocks_per_game = EXCLUDED.blocks_per_game,
                        fga_per_game = EXCLUDED.fga_per_game,
                        fta_per_game = EXCLUDED.fta_per_game,
                        tov_per_game = EXCLUDED.tov_per_game,
                        minutes_per_game = EXCLUDED.minutes_per_game,
                        last_team = EXCLUDED.last_team,
                        most_played_team = EXCLUDED.most_played_team,
                        usage_pct = COALESCE(EXCLUDED.usage_pct, player_stats.usage_pct),
                        fetched_at = now()
                    """,
                    (
                        player_id,
                        stats.get("firstSeason"),
                        stats.get("lastSeason"),
                        stats.get("seasonsPlayed"),
                        stats.get("gamesPlayed"),
                        stats.get("pointsPerGame"),
                        stats.get("reboundsPerGame"),
                        stats.get("assistsPerGame"),
                        stats.get("stealsPerGame"),
                        stats.get("blocksPerGame"),
                        stats.get("fgaPerGame"),
                        stats.get("ftaPerGame"),
                        stats.get("tovPerGame"),
                        stats.get("minutesPerGame"),
                        stats.get("team"),
                        stats.get("mostPlayedTeam"),
                        stats.get("usagePct"),
                    ),
                )

                team_history = stats.get("teamHistory") or []
                for stint in team_history:
                    cur.execute(
                        """
                        INSERT INTO player_team_stints (player_id, team, games_played)
                        VALUES (%s, %s, %s)
                        ON CONFLICT (player_id, team) DO UPDATE SET games_played = EXCLUDED.games_played
                        """,
                        (player_id, stint["abbreviation"], stint["gamesPlayed"]),
                    )
    except Exception as e:
        print(f"[db] upsert failed for player_id={player_id}: {e.__class__.__name__}: {e}")
    finally:
        conn.close()


def update_usage_pct(player_id, usage_pct):
    """Usage% arrives later than the rest of a player's stats (it's a
    separate, heavier fetch — see fetch_usage_pct in app.py), so it gets its
    own small update rather than going through the full upsert above. A
    no-op if the player's base stats row doesn't exist yet."""
    conn = _connect()
    if not conn:
        return
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE player_stats SET usage_pct = %s, fetched_at = now() WHERE player_id = %s",
                (usage_pct, player_id),
            )
    except Exception as e:
        print(f"[db] usage_pct update failed for player_id={player_id}: {e.__class__.__name__}: {e}")
    finally:
        conn.close()
