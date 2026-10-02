"""One regular-season snapshot, independent of every career-stat cache."""
from datetime import date
import math
import time


FIELDS = {"PTS": "pointsPerGame", "REB": "reboundsPerGame", "AST": "assistsPerGame",
          "STL": "stealsPerGame", "BLK": "blocksPerGame", "FGA": "fgaPerGame",
          "FTA": "ftaPerGame", "TOV": "tovPerGame", "MIN": "minutesPerGame"}


def season_for(today):
    year = today.year if today.month >= 7 else today.year - 1
    return f"{year}-{str(year + 1)[-2:]}"


def build_snapshot(fetch_rows, pool, bios, today=None):
    current = season_for(today or date.today())
    season = current
    rows = fetch_rows(season, "Base")
    # Only a successful, empty season response permits last-season fallback.
    # A timeout or malformed response must preserve the previous saved snapshot.
    if not any(float(row.get("GP", 0)) > 0 for row in rows):
        year = int(current[:4]) - 1
        season = f"{year}-{str(year + 1)[-2:]}"
        rows = fetch_rows(season, "Base")
    usage = {int(row["PLAYER_ID"]): float(row["USG_PCT"]) * 100
             for row in fetch_rows(season, "Advanced")}
    active = {int(p["id"]) for p in pool if p.get("isActive")}
    players = {}
    for row in rows:
        pid = int(row["PLAYER_ID"])
        if pid not in active or float(row["GP"]) <= 0:
            continue
        stats = {field: float(row[key]) for key, field in FIELDS.items()}
        stats.update(gamesPlayed=int(row["GP"]), usagePct=usage.get(pid))
        if any(value is None or not math.isfinite(value) or value < 0 for value in stats.values()):
            continue
        stats.update(season=season, statsBasis="season", savedAt=time.time())
        # Copy identity only. Never copy career averages, honours or career teams.
        bio = bios.get(pid, {}).get("stats", {})
        stats["photoUrl"] = bio.get("photoUrl")
        player = {"id": pid, "nbaPlayerId": pid, "fullName": row["PLAYER_NAME"],
                  "position": bio.get("position"), "isActive": True,
                  "team": {"abbreviation": row["TEAM_ABBREVIATION"]}, "stats": stats}
        # NBA aggregate rows (TEAM_ID=0) take precedence over trade stints.
        previous = players.get(pid)
        if previous is None or row.get("TEAM_ID") == 0:
            players[pid] = player
    if not players:
        raise ValueError("No complete active-player season stats; preserving saved snapshot")
    return {"season": season, "currentSeason": current, "usesPreviousSeason": season != current,
            "fetchedAt": time.time(), "players": list(players.values())}


def refresh(service, pool):
    def fetch_rows(season, measure):
        response = service.leaguedashplayerstats.LeagueDashPlayerStats(
            season=season, season_type_all_star="Regular Season",
            measure_type_detailed_defense=measure, per_mode_detailed="PerGame", timeout=30)
        rows = response.get_normalized_dict()["LeagueDashPlayerStats"]
        time.sleep(2)
        return rows
    snapshot = build_snapshot(fetch_rows, pool, service._cache)
    service._atomic_write_json(service.os.path.join(service.DATA_DIR, "activeNowCache.json"), snapshot)
    print(f"[active now] {snapshot['season']}: {len(snapshot['players'])} active players", flush=True)
    return snapshot
