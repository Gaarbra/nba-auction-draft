"""One-off admin script: pushes everything already sitting in the local
statsCache.json cache into Postgres, so the players/player_stats/
player_team_stints tables start out populated instead of only slowly
accumulating from live cache-miss traffic (fetch_stats_for_player only
persists to the DB on a fresh fetch — a cache HIT never reaches that code,
which is exactly what happens for every player this cache already has).

Usage (from the stats-service directory, with DATABASE_URL set via .env
or the environment):
    python scripts/backfill_players_db.py
"""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from nba_api.stats.static import players

import db

STATS_CACHE_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "statsCache.json")


def main():
    if not os.environ.get("DATABASE_URL"):
        print("DATABASE_URL isn't set — nothing to backfill into.")
        return

    with open(STATS_CACHE_FILE, "r", encoding="utf-8") as f:
        cache = json.load(f)

    total = len(cache)
    persisted = 0
    skipped = 0

    for i, (player_id_str, entry) in enumerate(cache.items(), start=1):
        player_id = int(player_id_str)
        stats = entry.get("stats")
        if not stats or stats.get("unavailable"):
            skipped += 1
            continue

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
        persisted += 1

        if i % 100 == 0:
            print(f"  {i}/{total} processed ({persisted} persisted, {skipped} skipped)")

    print(f"Done. {persisted} players persisted, {skipped} skipped (no usable stats).")


if __name__ == "__main__":
    main()
