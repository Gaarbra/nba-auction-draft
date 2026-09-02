import json
import os
import random
import threading
import time

import requests
from dotenv import load_dotenv

# Must run before `import db` — db.py reads DATABASE_URL from the
# environment at import time, so .env needs to be loaded first. Harmless
# locally-only convenience: production (Render/gunicorn) sets real
# environment variables directly, no .env file involved.
load_dotenv()

from flask import Flask, jsonify, request
from nba_api.stats.static import players
from nba_api.stats.endpoints import (
    playercareerstats,
    leaguedashplayerstats,
    commonallplayers,
    commonplayerinfo,
    alltimeleadersgrids,
)

import db
import ml
import photos

app = Flask(__name__)

# Module level, not inside `if __name__ == "__main__"`, so this also runs
# under gunicorn in production (which imports this module directly and
# never hits that guard) — see render.yaml. Idempotent (CREATE TABLE IF NOT
# EXISTS) and a no-op if DATABASE_URL isn't set, so it's safe to call from
# every worker process without coordination.
db.init_schema()

# price_model is just a local file read (joblib.load) — fast, stays
# synchronous. The similarity index is a Postgres query + a scikit-learn
# fit, which is NOT safe to leave synchronous here: this whole block runs at
# module import time, before Flask/gunicorn can bind a port at all, and a
# slow or briefly-unreachable free-tier Postgres turned that into a real
# outage once already (a 14-minute gap between gunicorn starting and the
# port actually opening, entirely spent waiting on this query — Render's own
# port-scan timeout very nearly killed the deploy). Building it in a
# background thread instead means the app can start serving immediately;
# SimilarityIndex.query() already returns [] gracefully while frame/model
# are still None, so /similar-players just degrades to empty until this
# finishes, the same "optional, never blocks anything else" contract the
# rest of this service's DB-backed features already follow.
_price_model = ml.load_price_model()
_similarity_index = ml.SimilarityIndex()


def _build_similarity_index_in_background():
    try:
        rows = db.fetch_all_player_stats_for_similarity()
        _similarity_index.build(rows)
        print(f"[ml] similarity index built over {0 if _similarity_index.frame is None else len(_similarity_index.frame)} players")
    except Exception as e:
        print(f"[ml] similarity index build failed, /similar-players will return empty: {e.__class__.__name__}: {e}")


threading.Thread(target=_build_similarity_index_in_background, daemon=True).start()
print(f"[ml] price model {'loaded' if _price_model else 'NOT FOUND (run scripts/train_price_model.py)'}; similarity index building in background")

# PORT is the convention most PaaS hosts (Render included) inject
# automatically; STATS_SERVICE_PORT is kept as a fallback for local dev
# habits from before that mattered.
PORT = int(os.environ.get("PORT", os.environ.get("STATS_SERVICE_PORT", 5001)))
# A player's career stats barely move day to day — even an active player's
# per-game averages only shift fractionally after one more game — so this
# can be long. Long TTLs plus disk persistence (see STATS_CACHE_FILE below)
# are what make the warm-up job's work actually stick between restarts,
# instead of every dev restart starting back at a cold, empty cache.
# Was 24h; bumped to a week (matching BIO_CACHE_TTL_SECONDS below) now that
# going stale has a real cost on Render specifically — stats.nba.com blocks
# that outbound IP outright, so every stale-triggered refresh there is
# doomed from the start (see fetch_stats_for_player's stale-while-revalidate
# handling). A week of extra staleness on a career per-game average is
# nothing; a week fewer wasted refresh attempts is a real win.
CACHE_TTL_SECONDS = 7 * 24 * 60 * 60
BIO_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60  # position/draft year never change
POOL_CACHE_TTL_SECONDS = 60 * 60
NOTABLE_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60  # all-time leaderboards barely move week to week

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
STATS_CACHE_FILE = os.path.join(DATA_DIR, "statsCache.json")
USAGE_CACHE_FILE = os.path.join(DATA_DIR, "usageCache.json")
PHOTO_CACHE_FILE = os.path.join(DATA_DIR, "photoCache.json")

# Render sets this env var to "true" for every service automatically. Used
# to skip live stats.nba.com calls we've confirmed always fail from here
# (that outbound IP is blocked outright, not just rate-limited — see the
# HANDOFF notes / this session's earlier debugging). This isn't just about
# avoiding a wasted call: on the roll path (roomHandlers.js's
# drawPlayerWithStats), Node is actually sitting there waiting on this
# response, so every second spent here discovering an already-known
# failure is a second directly added to how long a roll takes. Skipping the
# attempt outright — rather than just trying it with a shorter timeout — is
# what gets an uncached-player roll down to roughly the same speed as a
# cached one, instead of "a bit less slow."
ON_RENDER = bool(os.environ.get("RENDER"))

_cache = {}
_usage_cache = {}
_bio_cache = {}
_photo_cache = {}
_pool_cache = {"players": None, "fetchedAt": 0}
_notable_cache = {"ids": None, "fetchedAt": 0}
_warmup_status = {"running": False, "processed": 0, "total": 0, "warmed": 0, "startedAt": None, "finishedAt": None}

# How deep into each career-totals leaderboard to pull ids from, and which
# categories count toward "notable" — the counting stats that track with
# being a genuine standout, not shooting-percentage or empty-stat leaders
# (a guy with 3 career FTA and 100% FT% would otherwise qualify).
NOTABLE_TOPX = 500
NOTABLE_CATEGORIES = ["PTSLeaders", "REBLeaders", "ASTLeaders", "STLLeaders", "BLKLeaders"]

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


def last_real_team(df):
    """The team to display as "their team" — the last actual roster they
    were on, chronologically. This is deliberately NOT the same as the last
    row of dedupe_traded_seasons(): if a player's final season was itself a
    trade year, that row is the synthetic 'TOT' aggregate, not a real team,
    and showing "TOT" as someone's team is meaningless. Filtering TOT out
    and taking the last remaining row gives the team they actually finished
    with (df's row order is already chronological from playercareerstats)."""
    real_rows = df[df["TEAM_ABBREVIATION"] != "TOT"]
    if len(real_rows):
        return real_rows.iloc[-1]["TEAM_ABBREVIATION"]
    return None


def team_history(df):
    """Career games played per real team, most-played first. Built from the
    raw (non-deduped) rows on purpose — a traded season's per-team rows are
    exactly what's needed to split GP by team, unlike the TOT-collapsed rows
    dedupe_traded_seasons() produces for career per-game totals."""
    real_rows = df[df["TEAM_ABBREVIATION"] != "TOT"]
    if real_rows.empty:
        return []
    totals = real_rows.groupby("TEAM_ABBREVIATION")["GP"].sum()
    return [
        {"abbreviation": team, "gamesPlayed": int(gp)}
        for team, gp in totals.sort_values(ascending=False).items()
    ]


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


def load_stats_cache_from_disk():
    """Loads the per-player stats cache saved by a previous run (see
    save_stats_cache_to_disk) so a dev restart doesn't throw away every
    warmed player and start back at zero. JSON object keys are always
    strings, so player ids need converting back to int on the way in."""
    global _cache
    try:
        with open(STATS_CACHE_FILE, "r") as f:
            raw = json.load(f)
        _cache = {int(k): v for k, v in raw.items()}
        print(f"[stats cache] loaded {len(_cache)} players from disk")
    except FileNotFoundError:
        _cache = {}
    except (ValueError, OSError) as e:
        print(f"[stats cache] failed to load from disk, starting empty: {e}")
        _cache = {}


# Module level, not just under `if __name__ == "__main__"` — this used to
# only run for local `python app.py` dev, which meant gunicorn (production,
# see render.yaml) never loaded the committed statsCache.json at all and
# started every worker with an empty cache regardless of what shipped with
# the code. Safe to call per-worker: it's just reading a file into that
# worker's own memory, nothing to coordinate across workers.
load_stats_cache_from_disk()


def save_stats_cache_to_disk():
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(STATS_CACHE_FILE, "w") as f:
            json.dump(_cache, f)
    except OSError as e:
        print(f"[stats cache] failed to save to disk: {e}")


def load_photo_cache_from_disk():
    """Per-player fallback photo URLs (see photos.py) for players NBA's own
    CDN has no headshot for — {player_id: photoUrl or null}. Built offline
    (scripts/warm_photos.py, run locally like the other warm scripts) and
    shipped the same way as statsCache.json; never looked up live."""
    global _photo_cache
    try:
        with open(PHOTO_CACHE_FILE, "r") as f:
            raw = json.load(f)
        _photo_cache = {int(k): v for k, v in raw.items()}
        print(f"[photo cache] loaded {len(_photo_cache)} entries from disk")
    except FileNotFoundError:
        _photo_cache = {}
    except (ValueError, OSError) as e:
        print(f"[photo cache] failed to load from disk, starting empty: {e}")
        _photo_cache = {}


load_photo_cache_from_disk()


def save_photo_cache_to_disk():
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(PHOTO_CACHE_FILE, "w") as f:
            json.dump(_photo_cache, f)
    except OSError as e:
        print(f"[photo cache] failed to save to disk: {e}")


# Unlike stats.nba.com, /debug-reachability confirmed NBA's photo CDN and
# Wikipedia are BOTH reachable from Render — so this can safely resolve
# live, on the request path, for any player the offline warm_photos.py
# batch hasn't gotten to yet (new rookies included — this is what keeps
# photo coverage current going forward with no manual re-run ever needed,
# unlike everything stats.nba.com-sourced). Still never blocks the
# response: a genuine miss resolves in the background exactly like a
# stale stats cache entry does (see fetch_stats_for_player) — a player's
# first-ever nomination might show the plain placeholder, but the answer
# is cached for every nomination after that, for anyone.
_photo_lookup_in_flight = set()


def get_fallback_photo_url(player_id, full_name):
    """None means either "NBA has a real photo" (the client's default
    path) or "checked, nothing anywhere" — both already cached permanently,
    since neither answer changes for a given player. Only a genuine
    never-checked id costs anything, and even that never blocks: it's
    resolved in the background and simply isn't available for THIS
    response."""
    if player_id in _photo_cache:
        return _photo_cache[player_id]

    if player_id not in _photo_lookup_in_flight:
        _photo_lookup_in_flight.add(player_id)

        def _resolve():
            try:
                _photo_cache[player_id] = None if photos.has_nba_headshot(player_id) else photos.find_wikipedia_photo(full_name)
                save_photo_cache_to_disk()
            except Exception as e:
                print(f"[photo lookup failed] player_id={player_id} ({e.__class__.__name__}: {e})")
            finally:
                _photo_lookup_in_flight.discard(player_id)

        threading.Thread(target=_resolve, daemon=True).start()

    return None


def _is_stats_fresh(player_id):
    cached = _cache.get(player_id)
    return bool(cached) and (time.time() - cached["fetchedAt"]) < CACHE_TTL_SECONDS


def _usage_cache_key(player_id, season):
    # _usage_cache is keyed by (player_id, season) tuples in memory, but
    # JSON object keys must be strings — this is the shared string form
    # used on both sides of the disk round trip.
    return f"{player_id}:{season}"


def load_usage_cache_from_disk():
    """One real USG% lookup pulls that whole season's league-wide table, so
    this is unusually high-leverage to persist — warming it for even one
    player from a season makes every other player from that same season
    free for the rest of the cache's life, across restarts included."""
    global _usage_cache
    try:
        with open(USAGE_CACHE_FILE, "r") as f:
            raw = json.load(f)
        _usage_cache = {}
        for key, entry in raw.items():
            player_id_str, season = key.split(":", 1)
            _usage_cache[(int(player_id_str), season)] = entry
        print(f"[usage cache] loaded {len(_usage_cache)} (player, season) entries from disk")
    except FileNotFoundError:
        _usage_cache = {}
    except (ValueError, OSError) as e:
        print(f"[usage cache] failed to load from disk, starting empty: {e}")
        _usage_cache = {}


# Same reasoning as load_stats_cache_from_disk() above — module level so
# gunicorn workers load the committed usageCache.json too, not just local dev.
load_usage_cache_from_disk()


def save_usage_cache_to_disk():
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        serializable = {_usage_cache_key(pid, season): entry for (pid, season), entry in _usage_cache.items()}
        with open(USAGE_CACHE_FILE, "w") as f:
            json.dump(serializable, f)
    except OSError as e:
        print(f"[usage cache] failed to save to disk: {e}")


# Guards against piling up duplicate background refreshes for the same
# player — e.g. several nominations of a widely-cached-but-now-stale player
# arriving close together shouldn't each spawn their own stats.nba.com call.
_stats_refresh_in_flight = set()


def fetch_stats_for_player(player_id):
    cached = _cache.get(player_id)
    if cached:
        if (time.time() - cached["fetchedAt"]) < CACHE_TTL_SECONDS:
            print(f"[cache HIT] player_id={player_id}")
        else:
            # Stale, but real. Serve it immediately and refresh in the
            # background rather than block this request on a live
            # stats.nba.com call: on Render, that call doesn't just fail, it
            # times out after 15-30s (the outbound IP is blocked outright —
            # confirmed, not theoretical), which is already longer than
            # Node's own 3s client-side timeout (see fetchPlayerStats in
            # statsClient.js). Blocking here would just mean every stale
            # player looks identical to a never-cached one: "Stats
            # unavailable", no photo, no team — even though we have perfectly
            # good (if a few days old) numbers for them sitting right here.
            # A career average barely moves day to day, so stale is a fine
            # thing to serve while a fresher copy is fetched for next time.
            if ON_RENDER:
                # A background refresh here would just be a slow, silent way
                # to burn a thread on a call already known to fail — skip it
                # entirely rather than pay for a doomed attempt nothing is
                # even waiting on.
                print(f"[cache STALE, skipping refresh (blocked on Render)] player_id={player_id}")
            elif player_id not in _stats_refresh_in_flight:
                _stats_refresh_in_flight.add(player_id)

                def _refresh():
                    try:
                        _fetch_and_cache_stats(player_id)
                    except Exception as e:
                        print(f"[background stats refresh failed, stale cache stays in place] player_id={player_id}: {e.__class__.__name__}: {e}")
                    finally:
                        _stats_refresh_in_flight.discard(player_id)

                print(f"[cache STALE, serving stale + refreshing in background] player_id={player_id}")
                threading.Thread(target=_refresh, daemon=True).start()
            else:
                print(f"[cache STALE, refresh already in flight] player_id={player_id}")
        return cached["stats"]

    if ON_RENDER:
        # Known-doomed call — don't spend up to 15s (or however long
        # nba_api's own retry/backoff takes) finding that out again for a
        # player we already know isn't cached. Fail fast so the roll
        # waiting on this (drawPlayerWithStats in roomHandlers.js) isn't
        # stuck behind a call that can never succeed.
        print(f"[cache MISS, skipping live fetch (blocked on Render)] player_id={player_id}")
        raise RuntimeError(f"stats.nba.com unreachable from Render — player_id={player_id} not in cache")

    print(f"[cache MISS] player_id={player_id}")
    return _fetch_and_cache_stats(player_id)


def _fetch_and_cache_stats(player_id):
    """The actual live stats.nba.com lookup + cache write. Only called
    synchronously (and allowed to raise, same as always) when nothing is
    cached yet at all; called from a background thread — failures just get
    logged, see fetch_stats_for_player — once something stale already is."""
    try:
        career = playercareerstats.PlayerCareerStats(player_id=player_id, timeout=15)
        df = career.get_data_frames()[0]
    except KeyError:
        # Confirmed by hand on several ids that hit exactly this: the HTTP
        # request itself succeeds, but stats.nba.com's response body is a
        # genuinely empty {} for a player who's in the pool (drafted, on a
        # roster) but never actually appeared in a real box score — nba_api's
        # own parsing throws KeyError reaching for a "resultSet" key that
        # just isn't there. Not a network hiccup (those raise a requests/
        # urllib3 exception instead, and still propagate below to be retried
        # later) — this is stats.nba.com telling us there's nothing to find,
        # so caching it as "no stats" (same as the total_gp == 0 case right
        # below) is what stops every future warm run from retrying it
        # forever, and is the difference between capping out at ~96%
        # coverage and actually resolving the full pool.
        print(f"[no career record] player_id={player_id} — stats.nba.com has nothing for this id")
        df = None

    if df is None or df.empty:
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

            history = team_history(df)

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
                # "team" stays the last real team they suited up for (kept for
                # backward compat); "mostPlayedTeam" is the one Node picks for
                # color/branding on a retired player (see roomHandlers.js) —
                # an active player's last team already IS their current one,
                # so this split only matters once someone's career is over.
                "team": last_real_team(df),
                "mostPlayedTeam": history[0]["abbreviation"] if history else None,
                "teamHistory": history,
                "position": bio["position"],
                "draftYear": bio["draftYear"],
            }

    _cache[player_id] = {"stats": stats, "fetchedAt": time.time()}
    save_stats_cache_to_disk()

    if stats:
        try:
            identity = players.find_player_by_id(player_id)
            first_year = int(stats["firstSeason"].split("-")[0]) if stats.get("firstSeason") else None
            last_year = int(stats["lastSeason"].split("-")[0]) + 1 if stats.get("lastSeason") else None
            db.upsert_player_and_stats(
                player_id,
                identity["full_name"] if identity else str(player_id),
                bool(identity["is_active"]) if identity else False,
                first_year,
                last_year,
                stats,
            )
        except Exception as e:
            print(f"[db] persist skipped for player_id={player_id}: {e.__class__.__name__}: {e}")

    return stats


def fetch_usage_pct(player_id, season):
    """Real USG_PCT for one season, from stats.nba.com's Advanced boxscore
    dashboard. Only meaningful for `season >= EARLIEST_USG_SEASON`; the
    endpoint returns nothing usable before that regardless of player.

    The underlying endpoint returns the WHOLE season's league-wide table in
    one call, not just this player's row — so a cache miss caches every
    player found in that response, not only the one that was asked for.
    That's what makes this genuinely cheap after the first hit: scoring a
    room where several drafted players share a season only pays for one
    live fetch of that season, not one per player."""
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

    fetched_at = time.time()
    for _, row in df.iterrows():
        pct = round(float(row["USG_PCT"]) * 100, 1)
        _usage_cache[(int(row["PLAYER_ID"]), season)] = {"value": pct, "fetchedAt": fetched_at}
    save_usage_cache_to_disk()

    cached = _usage_cache.get(cache_key)
    if cached:
        # Just the one requested player, not every row in the season table —
        # most of that table is players who were never drafted in this app
        # and have no players/player_stats row to update anyway.
        try:
            db.update_usage_pct(player_id, cached["value"])
        except Exception as e:
            print(f"[db] usage_pct persist skipped for player_id={player_id}: {e.__class__.__name__}: {e}")
    return cached["value"] if cached else None


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


def fetch_notable_player_ids():
    """A data-driven 'notable players' pool — everyone who cracks the top
    NOTABLE_TOPX of career PER-GAME points, rebounds, assists, steals, or
    blocks — sourced straight from stats.nba.com's own all-time leaderboards
    in a single call, not a hand-picked list.

    Deliberately per-game, not career totals: totals reward longevity above
    all else (a mediocre player who compiled counting stats over 15
    forgettable seasons can out-total someone who was actually great for 8),
    which is why this used to occasionally surface journeymen instead of
    genuine stars/starters. Per-game rate stats track much closer to "was
    this person actually good" — stats.nba.com's own per-game leaderboards
    already apply a real eligibility/minutes qualifier server-side (they're
    correctly topped by Jordan/Wilt at PPG, not some one-game fluke), so
    this doesn't need its own games-played filtering on top.

    Meant to be layered with the room/draft system's random single-draw
    nomination sampling (see drawPlayerWithStats in roomHandlers.js):
    narrowing the drawn candidates down to this pool first makes it far more
    likely a genuinely strong player gets nominated on easier difficulties,
    especially against a big pool like "All Eras" where a random draw would
    otherwise almost always miss the players anyone actually recognizes."""
    cached = _notable_cache["ids"]
    if cached is not None and (time.time() - _notable_cache["fetchedAt"]) < NOTABLE_CACHE_TTL_SECONDS:
        return cached

    grids = alltimeleadersgrids.AllTimeLeadersGrids(topx=NOTABLE_TOPX, per_mode_simple="PerGame", timeout=30)
    raw = grids.nba_response.get_dict()

    ids = set()
    for result_set in raw["resultSets"]:
        if result_set["name"] not in NOTABLE_CATEGORIES:
            continue
        headers = result_set["headers"]
        id_index = headers.index("PLAYER_ID")
        for row in result_set["rowSet"]:
            ids.add(int(row[id_index]))

    ids = _topup_underrepresented_positions(ids)
    _notable_cache["ids"] = ids
    _notable_cache["fetchedAt"] = time.time()
    return ids


def _broad_position(position):
    """Collapses a possibly-hyphenated position ('F-C', 'G-F') down to its
    primary (first-listed) component — NBA's own convention lists the
    primary position first. Only used for the position-parity check below,
    not anywhere stats/UI-facing (those keep the full hyphenated detail)."""
    if not position:
        return None
    return position.split("-")[0]


# Minimum career games for a top-up candidate — keeps a tiny, fluky
# per-game sample (a handful of good garbage-time outings) from qualifying
# just because the sample size is too small for the composite score to
# mean anything.
NOTABLE_TOPUP_MIN_GAMES = 100
# Hard ceiling on how many extra players a single position can gain from
# the top-up pass, so a large measured gap can't balloon the notable pool
# unpredictably in one run.
NOTABLE_TOPUP_MAX_PER_POSITION = 150


def _topup_underrepresented_positions(ids):
    """The base notable pool (5 global per-game leaderboards — points,
    rebounds, assists, steals, blocks) systematically underrepresents
    Forwards: centers dominate REB/BLK outright and guards dominate AST/STL
    outright, so they clear a "top 500 in one category" bar easily, while
    forwards are often good across several categories without leading any
    single one. Measured, not assumed: 18.9% of cached forwards qualified
    for the base pool vs 30.8% of centers, as of this function being added.

    Tops up any broad position (G/F/C) whose notable RATE falls below the
    pool-wide average, ranked by combined per-game production (PTS+REB+AST)
    rather than requiring a #1 finish in any single category — that
    single-category bar is exactly what shuts out well-rounded-but-not-
    specialist players, which skews toward forwards specifically.

    Uses only per-game stats + position already sitting in `_cache` — no
    extra stats.nba.com calls — so this is most effective once a large
    chunk of the pool is already warmed, and degrades gracefully (adds
    little/nothing) on a colder cache rather than erroring."""
    ids = set(ids)
    candidates_by_position = {}
    total_by_position = {}
    notable_by_position = {}

    for pid_str, entry in _cache.items():
        stats = entry.get("stats")
        if not stats:
            continue
        pid = int(pid_str)
        position = _broad_position(stats.get("position"))
        if not position:
            continue

        total_by_position[position] = total_by_position.get(position, 0) + 1
        if pid in ids:
            notable_by_position[position] = notable_by_position.get(position, 0) + 1
            continue

        if (stats.get("gamesPlayed") or 0) < NOTABLE_TOPUP_MIN_GAMES:
            continue
        score = (stats.get("pointsPerGame") or 0) + (stats.get("reboundsPerGame") or 0) + (stats.get("assistsPerGame") or 0)
        candidates_by_position.setdefault(position, []).append((pid, score))

    total_cached = sum(total_by_position.values())
    total_notable = sum(notable_by_position.values())
    if not total_cached or not total_notable:
        return list(ids)
    overall_rate = total_notable / total_cached

    added = 0
    for position, total in total_by_position.items():
        current_notable = notable_by_position.get(position, 0)
        if total and current_notable / total >= overall_rate:
            continue
        gap = min(int(overall_rate * total) - current_notable, NOTABLE_TOPUP_MAX_PER_POSITION)
        if gap <= 0:
            continue
        ranked = sorted(candidates_by_position.get(position, []), key=lambda t: t[1], reverse=True)
        for pid, _score in ranked[:gap]:
            ids.add(pid)
            added += 1

    if added:
        print(f"[notable pool] topped up {added} players from underrepresented positions")
    return list(ids)


# Pacing for the background warm-up job below. stats.nba.com's rate limiting
# tracks request *rate*, not total volume — a burst of parallel/rapid calls
# trips it (and the throttled state can then linger for a good while), but
# slow, steady, one-at-a-time traffic doesn't. So this deliberately never
# fetches more than one player at a time, paces itself with jittered delays
# between requests, and backs off hard on repeated failures instead of
# plowing through and digging the hole deeper.
WARMUP_DELAY_RANGE = (1.0, 1.6)
WARMUP_FAILURE_THRESHOLD = 3
WARMUP_COOLDOWN_SECONDS = 45
WARMUP_SAVE_EVERY = 25


def warm_notable_pool():
    """Background job (run in its own thread, not on the request path):
    sequentially pre-fetches career stats for every notable player who isn't
    already freshly cached, so that once it's finished, ~90%+ of nominations
    on Easy/Normal resolve from a warm in-memory+on-disk cache instead of a
    live stats.nba.com round trip. Safe to call on every startup — anyone
    already fresh (including from a previous run's disk cache) is skipped,
    so a re-run only has to fetch what's missing or stale."""
    try:
        ids = fetch_notable_player_ids()
    except Exception as e:
        print(f"[warmup] couldn't fetch notable player ids, skipping warm-up: {e}")
        return

    todo = [pid for pid in ids if not _is_stats_fresh(pid)]
    _warmup_status.update(running=True, processed=0, total=len(todo), warmed=0, startedAt=time.time(), finishedAt=None)

    if not todo:
        print("[warmup] notable pool already warm, nothing to do")
        _warmup_status.update(running=False, finishedAt=time.time())
        return

    print(f"[warmup] starting — {len(todo)}/{len(ids)} notable players need fresh stats")
    consecutive_failures = 0
    warmed = 0

    for i, player_id in enumerate(todo):
        try:
            stats = fetch_stats_for_player(player_id)
            consecutive_failures = 0
            if stats is not None:
                warmed += 1
        except Exception as e:
            consecutive_failures += 1
            print(f"[warmup] fetch failed for player_id={player_id} ({consecutive_failures} in a row): {e}")

        _warmup_status.update(processed=i + 1, warmed=warmed)

        if (i + 1) % WARMUP_SAVE_EVERY == 0:
            print(f"[warmup] progress: {i + 1}/{len(todo)} processed, {warmed} warmed")

        if consecutive_failures >= WARMUP_FAILURE_THRESHOLD:
            print(f"[warmup] {consecutive_failures} failures in a row — cooling down for {WARMUP_COOLDOWN_SECONDS}s")
            time.sleep(WARMUP_COOLDOWN_SECONDS)
            consecutive_failures = 0

        time.sleep(random.uniform(*WARMUP_DELAY_RANGE))

    print(f"[warmup] done — warmed {warmed}/{len(todo)} players")
    _warmup_status.update(running=False, finishedAt=time.time())


@app.get("/predict-price")
def get_predicted_price():
    """Predicted auction price (in coins) for a player, given the room's era/
    slot/difficulty context — see ml.py and scripts/train_price_model.py.
    `slot` is optional (the client won't know it before an assignment
    happens for a fresh nomination); era/difficulty default sensibly inside
    ml.build_feature_row if omitted too."""
    if _price_model is None:
        return jsonify({"error": "MODEL_NOT_TRAINED"}), 404

    player = resolve_player(request)
    if not player:
        return jsonify({"error": "PLAYER_NOT_FOUND"}), 404

    try:
        stats = fetch_stats_for_player(player["id"])
    except Exception as e:
        print(f"[predict-price] stats lookup failed player_id={player['id']} ({e.__class__.__name__}: {e})")
        return jsonify({"error": "STATS_LOOKUP_FAILED"}), 502

    if stats is None:
        return jsonify({"error": "NO_STATS_AVAILABLE"}), 404

    era = request.args.get("era")
    slot = request.args.get("slot")
    difficulty = request.args.get("difficulty")

    try:
        predicted = ml.predict_price(_price_model, stats, era=era, slot=slot, difficulty=difficulty)
    except Exception as e:
        print(f"[predict-price] prediction failed player_id={player['id']} ({e.__class__.__name__}: {e})")
        return jsonify({"error": "PREDICTION_FAILED"}), 502

    # Best-effort — the hover-tooltip breakdown of what drove this number.
    # Never lets an explanation failure take down the prediction itself.
    try:
        explanation = ml.explain_prediction(_price_model, stats, era=era, slot=slot, difficulty=difficulty)
    except Exception as e:
        print(f"[predict-price] explanation failed player_id={player['id']} ({e.__class__.__name__}: {e})")
        explanation = []

    return jsonify(
        {
            "player": {"id": player["id"], "fullName": player["full_name"]},
            "predictedPrice": round(predicted, 1),
            "explanation": explanation,
        }
    )


@app.get("/similar-players")
def get_similar_players():
    """The k nearest players by per-game stat profile (see ml.SimilarityIndex)
    — playing style/production only, not context like era/slot/difficulty."""
    player = resolve_player(request)
    if not player:
        return jsonify({"error": "PLAYER_NOT_FOUND"}), 404

    try:
        k = max(1, min(10, int(request.args.get("k", 5))))
    except (TypeError, ValueError):
        k = 5

    results = _similarity_index.query(player["id"], k=k)
    return jsonify({"player": {"id": player["id"], "fullName": player["full_name"]}, "similar": results})


@app.get("/photo-url")
def get_photo_url():
    """Standalone from /stats on purpose: the client's retry for a player
    whose first-ever nomination resolved with no photo yet (see
    PlayerHeadshot.jsx) just wants this one answer a couple seconds later,
    not a full re-fetch of career stats too. Same instant-if-cached,
    resolve-in-background-if-not behavior as get_fallback_photo_url used
    from /stats — by the time this retry actually fires client-side, the
    background resolve kicked off by the original nomination has usually
    already finished."""
    player = resolve_player(request)
    if not player:
        return jsonify({"error": "PLAYER_NOT_FOUND"}), 404

    photo_url = get_fallback_photo_url(player["id"], player["full_name"])
    return jsonify({"player": {"id": player["id"], "fullName": player["full_name"]}, "photoUrl": photo_url})


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


@app.get("/warmup-status")
def warmup_status():
    """Diagnostic view into the background warm-up job — how far through
    the notable pool it's gotten, and how many players are actually cached
    right now. Not used by the app itself, just for checking progress."""
    return jsonify({**_warmup_status, "cachedPlayers": len(_cache)})


@app.get("/debug-reachability")
def debug_reachability():
    """One-off diagnostic: is stats.nba.com the only blocked host from
    wherever this is deployed, or does that block extend to NBA's separate
    photo CDN and/or Wikipedia too? Answers whether photos.py's lookups
    could ever safely run live (server-side, at nomination time) instead of
    only ever offline — see photoCache.json/warm_photos.py for the current
    (offline-only) approach. Not used by the app itself."""
    results = {}

    start = time.time()
    try:
        # Same nba_api call fetch_stats_for_player itself makes for a
        # genuine cache miss — the confirmed-blocked baseline everything
        # else here is being compared against.
        playercareerstats.PlayerCareerStats(player_id=2544, timeout=8)
        results["stats_nba_com"] = {"ok": True, "seconds": round(time.time() - start, 2)}
    except Exception as e:
        results["stats_nba_com"] = {"ok": False, "error": e.__class__.__name__, "seconds": round(time.time() - start, 2)}

    start = time.time()
    try:
        resp = requests.head(photos.NBA_HEADSHOT_URL.format(player_id=2544), timeout=8)
        results["ak_static_nba_photo_cdn"] = {"ok": resp.status_code == 200, "status": resp.status_code, "seconds": round(time.time() - start, 2)}
    except requests.RequestException as e:
        results["ak_static_nba_photo_cdn"] = {"ok": False, "error": e.__class__.__name__, "seconds": round(time.time() - start, 2)}

    start = time.time()
    try:
        resp = requests.get(
            photos.WIKIPEDIA_API_URL,
            params={"action": "query", "format": "json", "titles": "LeBron James"},
            timeout=8,
            headers=photos.REQUEST_HEADERS,
        )
        results["wikipedia_api"] = {"ok": resp.status_code == 200, "status": resp.status_code, "seconds": round(time.time() - start, 2)}
    except requests.RequestException as e:
        results["wikipedia_api"] = {"ok": False, "error": e.__class__.__name__, "seconds": round(time.time() - start, 2)}

    return jsonify(results)


@app.get("/players")
def get_players_pool():
    try:
        pool = fetch_players_pool()
    except Exception as e:
        print(f"[players pool fetch failed] ({e.__class__.__name__}: {e})")
        return jsonify({"error": "PLAYERS_POOL_FETCH_FAILED"}), 502

    return jsonify({"players": pool, "count": len(pool)})


@app.get("/notable-players")
def get_notable_players():
    try:
        ids = fetch_notable_player_ids()
    except Exception as e:
        print(f"[notable players fetch failed] ({e.__class__.__name__}: {e})")
        return jsonify({"error": "NOTABLE_PLAYERS_FETCH_FAILED"}), 502

    return jsonify({"playerIds": ids, "count": len(ids)})


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

    # Only set when NBA's own CDN has no real photo for this player (see
    # get_fallback_photo_url) — resolves instantly from cache for anyone
    # already checked (the offline warm_photos.py batch, or a previous
    # live nomination); a genuine first-ever miss never blocks this
    # response, see that function's docstring.
    fallback_photo_url = get_fallback_photo_url(player["id"], player["full_name"])
    if fallback_photo_url:
        stats = {**stats, "photoUrl": fallback_photo_url}

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

    fallback_photo_url = _photo_cache.get(player["id"])
    merged_stats = {**stats, "usagePct": usage_pct}
    if fallback_photo_url:
        merged_stats["photoUrl"] = fallback_photo_url

    return jsonify(
        {
            "player": {"id": player["id"], "fullName": player["full_name"]},
            "stats": merged_stats,
        }
    )


if __name__ == "__main__":
    # Runs the notable-pool warm-up once, in the background, only under
    # local dev (`python app.py`) — deliberately NOT at module level, since
    # production runs this file under gunicorn with multiple worker
    # processes (see render.yaml's --workers 2), and each worker importing
    # this module would otherwise kick off its own independent warm-up,
    # multiplying the request rate right back into the kind of burst that
    # trips stats.nba.com's rate limiting in the first place. Production
    # still benefits from the disk cache (each worker persists what it
    # fetches and reloads it on restart) — it just doesn't proactively
    # bulk-warm the notable pool the way local dev does here.
    threading.Thread(target=warm_notable_pool, daemon=True).start()

    # host="0.0.0.0" so this is reachable from outside the container/machine
    # it runs on (Flask's dev-server default of 127.0.0.1 only accepts local
    # connections) — needed for both Docker-style deploys and the Node
    # server calling in from a separate host on a cloud platform. In
    # production this file isn't actually the entry point at all — gunicorn
    # runs it directly (see render.yaml) since Flask's built-in server isn't
    # meant to take real traffic.
    #
    # threaded=True so a live request (e.g. a real nomination, or a
    # /warmup-status check) can be served immediately instead of queuing
    # behind whatever the warm-up background thread happens to be doing —
    # Werkzeug's dev server handles only one request at a time by default.
    app.run(host="0.0.0.0", port=PORT, threaded=True)
