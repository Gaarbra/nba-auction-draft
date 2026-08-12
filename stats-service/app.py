import os
import time

from flask import Flask, jsonify, request
from nba_api.stats.static import players
from nba_api.stats.endpoints import (
    playercareerstats,
    leaguedashplayerstats,
    commonallplayers,
    commonplayerinfo,
)

app = Flask(__name__)

PORT = int(os.environ.get("STATS_SERVICE_PORT", 5001))
CACHE_TTL_SECONDS = 60 * 60
BIO_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60  # position/draft year never change
POOL_CACHE_TTL_SECONDS = 60 * 60

_cache = {}
_usage_cache = {}
_bio_cache = {}
_pool_cache = {"players": None, "fetchedAt": 0}

# stats.nba.com only computes Advanced-measure stats (which USG_PCT comes
# from) from this season onward. Earlier seasons genuinely have no official
# usage-percentage figure anywhere, from any source that isn't Basketball-
# Reference (see EARLIEST_USG_SEASON usage in fetch_usage_pct below).
EARLIEST_USG_SEASON = "1996-97"

POSITION_ABBREVIATIONS = {"Guard": "G", "Forward": "F", "Center": "C"}


def abbreviate_position(full_position):
    """commonplayerinfo returns full words ('Forward', 'Guard-Forward');
    the rest of the app expects short codes ('F', 'G-F')."""
    if not full_position:
        return None
    parts = [p.strip() for p in full_position.split("-") if p.strip()]
    if not parts:
        return None
    return "-".join(POSITION_ABBREVIATIONS.get(p, p[:1]) for p in parts)


def resolve_player(req):
    """The draft pool (from /players) hands back real NBA person ids, so the
    normal path is id-based — no fuzzy name matching needed. `name` is kept
    as a fallback for any other caller."""
    id_param = (req.args.get("id") or "").strip()
    if id_param:
        try:
            return players.find_player_by_id(int(id_param))
        except (ValueError, TypeError):
            return None

    name = (req.args.get("name") or "").strip()
    if not name:
        return None
    matches = players.find_players_by_full_name(name)
    if not matches:
        return None
    lowered = name.lower()
    exact = next((m for m in matches if m["full_name"].lower() == lowered), None)
    return exact or matches[0]


def dedupe_traded_seasons(df):
    """Seasons where a player was traded include one row per team plus a
    'TOT' (total) row for that season. Summing every row would double-count
    those seasons, so keep only the TOT row when one exists."""
    rows = []
    for season_id, group in df.groupby("SEASON_ID", sort=False):
        tot_rows = group[group["TEAM_ABBREVIATION"] == "TOT"]
        rows.append(tot_rows.iloc[0] if len(tot_rows) else group.iloc[0])
    return rows


def fetch_player_bio(player_id):
    """Position and draft year, from commonplayerinfo. Note: this endpoint's
    own TEAM_NAME/TEAM_ABBREVIATION fields are NOT used for "current team" —
    spot-checking showed they reflect some other snapshot (Wilt Chamberlain
    comes back as "Warriors", a mid-career team, not the Lakers he actually
    finished with). "Team" is sourced from career-stats' last season row
    instead (see fetch_stats_for_player), which we've verified is correct."""
    cached = _bio_cache.get(player_id)
    if cached and (time.time() - cached["fetchedAt"]) < BIO_CACHE_TTL_SECONDS:
        return cached["bio"]

    info = commonplayerinfo.CommonPlayerInfo(player_id=player_id, timeout=15)
    df = info.get_data_frames()[0]

    if df.empty:
        bio = {"position": None, "draftYear": None}
    else:
        row = df.iloc[0]
        draft_year = row.get("DRAFT_YEAR")
        bio = {
            "position": abbreviate_position(row.get("POSITION")),
            "draftYear": int(draft_year) if str(draft_year).isdigit() else None,
        }

    _bio_cache[player_id] = {"bio": bio, "fetchedAt": time.time()}
    return bio


def fetch_stats_for_player(player_id):
    cached = _cache.get(player_id)
    if cached and (time.time() - cached["fetchedAt"]) < CACHE_TTL_SECONDS:
        print(f"[cache HIT] player_id={player_id}")
        return cached["stats"]
    print(f"[cache MISS] player_id={player_id}")

    career = playercareerstats.PlayerCareerStats(player_id=player_id, timeout=15)
    df = career.get_data_frames()[0]

    if df.empty:
        stats = None
    else:
        season_rows = dedupe_traded_seasons(df)
        total_gp = sum(int(row["GP"]) for row in season_rows)

        if total_gp == 0:
            stats = None
        else:
            def total_of(stat_key):
                # TOV is None/NaN for every season before 1977-78 (the NBA
                # didn't record turnovers as a box-score stat before then) —
                # skip those rows rather than let a NaN poison the sum, and
                # report null (not 0) when nothing was ever tracked so callers
                # can tell "never recorded" apart from "recorded as zero".
                values = [row[stat_key] for row in season_rows if row[stat_key] is not None and row[stat_key] == row[stat_key]]
                return sum(values) if values else None

            total_pts = total_of("PTS")
            total_reb = total_of("REB")
            total_ast = total_of("AST")
            total_stl = total_of("STL")
            total_blk = total_of("BLK")
            total_fga = total_of("FGA")
            total_fta = total_of("FTA")
            total_tov = total_of("TOV")
            total_min = total_of("MIN")

            def per_game(total):
                return round(total / total_gp, 1) if total is not None else None

            try:
                bio = fetch_player_bio(player_id)
            except Exception as e:
                print(f"[bio lookup failed] player_id={player_id} ({e.__class__.__name__}: {e})")
                bio = {"position": None, "draftYear": None}

            stats = {
                "firstSeason": season_rows[0]["SEASON_ID"],
                "lastSeason": season_rows[-1]["SEASON_ID"],
                "seasonsPlayed": len(season_rows),
                "gamesPlayed": total_gp,
                "pointsPerGame": per_game(total_pts),
                "reboundsPerGame": per_game(total_reb),
                "assistsPerGame": per_game(total_ast),
                "stealsPerGame": per_game(total_stl),
                "blocksPerGame": per_game(total_blk),
                "fgaPerGame": per_game(total_fga),
                "ftaPerGame": per_game(total_fta),
                "tovPerGame": per_game(total_tov),
                "minutesPerGame": per_game(total_min),
                "team": season_rows[-1]["TEAM_ABBREVIATION"],
                "position": bio["position"],
                "draftYear": bio["draftYear"],
            }

    _cache[player_id] = {"stats": stats, "fetchedAt": time.time()}
    return stats


def fetch_usage_pct(player_id, season):
    """Real USG_PCT for one season, from stats.nba.com's Advanced boxscore
    dashboard. Only meaningful for `season >= EARLIEST_USG_SEASON`; the
    endpoint returns nothing usable before that regardless of player."""
    cache_key = (player_id, season)
    cached = _usage_cache.get(cache_key)
    if cached and (time.time() - cached["fetchedAt"]) < CACHE_TTL_SECONDS:
        return cached["value"]

    resp = leaguedashplayerstats.LeagueDashPlayerStats(
        season=season,
        season_type_all_star="Regular Season",
        measure_type_detailed_defense="Advanced",
        timeout=20,
    )
    df = resp.get_data_frames()[0]
    row = df[df["PLAYER_ID"] == player_id]
    value = round(float(row.iloc[0]["USG_PCT"]) * 100, 1) if len(row) else None

    _usage_cache[cache_key] = {"value": value, "fetchedAt": time.time()}
    return value


def fetch_players_pool():
    """The full draft-eligible player pool, in one bulk API call rather than
    one call per player. This is what the room/draft system draws random
    nominations from."""
    cached = _pool_cache["players"]
    if cached and (time.time() - _pool_cache["fetchedAt"]) < POOL_CACHE_TTL_SECONDS:
        return cached

    resp = commonallplayers.CommonAllPlayers(is_only_current_season=0, timeout=30)
    df = resp.get_data_frames()[0]

    pool = []
    for _, row in df.iterrows():
        from_year = row.get("FROM_YEAR")
        to_year = row.get("TO_YEAR")
        pool.append(
            {
                "id": int(row["PERSON_ID"]),
                "fullName": row["DISPLAY_FIRST_LAST"],
                "isActive": bool(row["ROSTERSTATUS"]),
                "fromYear": int(from_year) if str(from_year).isdigit() else None,
                "toYear": int(to_year) if str(to_year).isdigit() else None,
            }
        )

    _pool_cache["players"] = pool
    _pool_cache["fetchedAt"] = time.time()
    return pool


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


@app.get("/players")
def get_players_pool():
    try:
        pool = fetch_players_pool()
    except Exception as e:
        print(f"[players pool fetch failed] ({e.__class__.__name__}: {e})")
        return jsonify({"error": "PLAYERS_POOL_FETCH_FAILED"}), 502

    return jsonify({"players": pool, "count": len(pool)})


@app.get("/stats")
def get_stats():
    player = resolve_player(request)
    if not player:
        return jsonify({"error": "PLAYER_NOT_FOUND"}), 404

    try:
        stats = fetch_stats_for_player(player["id"])
    except Exception as e:
        print(f"[stats lookup failed] player_id={player['id']} ({e.__class__.__name__}: {e})")
        return jsonify({"error": "STATS_LOOKUP_FAILED"}), 502

    if stats is None:
        return jsonify({"error": "NO_STATS_AVAILABLE"}), 404

    return jsonify({"player": {"id": player["id"], "fullName": player["full_name"]}, "stats": stats})


@app.get("/full-stats")
def get_full_stats():
    """Like /stats, but also attempts a real USG_PCT lookup. This costs one
    extra stats.nba.com call (per player, cached after), so it's kept as a
    separate route rather than folded into /stats — the draft-reveal screen
    doesn't need USG%, only the end-of-draft scoring step does, and there's
    no reason to slow down every single reveal for a field most requests
    won't use."""
    player = resolve_player(request)
    if not player:
        return jsonify({"error": "PLAYER_NOT_FOUND"}), 404

    try:
        stats = fetch_stats_for_player(player["id"])
    except Exception as e:
        print(f"[stats lookup failed] player_id={player['id']} ({e.__class__.__name__}: {e})")
        return jsonify({"error": "STATS_LOOKUP_FAILED"}), 502

    if stats is None:
        return jsonify({"error": "NO_STATS_AVAILABLE"}), 404

    usage_pct = None
    if stats["lastSeason"] >= EARLIEST_USG_SEASON:
        try:
            usage_pct = fetch_usage_pct(player["id"], stats["lastSeason"])
        except Exception as e:
            print(f"[usage lookup failed] player_id={player['id']} ({e.__class__.__name__}: {e})")
            usage_pct = None

    return jsonify(
        {
            "player": {"id": player["id"], "fullName": player["full_name"]},
            "stats": {**stats, "usagePct": usage_pct},
        }
    )


if __name__ == "__main__":
    app.run(port=PORT)
