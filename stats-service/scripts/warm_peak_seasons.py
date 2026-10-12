"""Backfills the `peakSeason` field (game mode "peak") into statsCache.json.

New fetches already compute peakSeason (see app.py's _fetch_and_cache_stats),
but players cached before that change don't have it. Peak-season picking needs
the raw season-by-season rows, which only exist during a live stats.nba.com
fetch, so this re-fetches each player still missing the field. Run explicitly
in the VPS maintenance container using its configured proxy and writable data
volume. This is a one-time historical backfill, separate from active-only weekly refreshes.

Skips players that already have a peakSeason and players cached as "no stats"
(nothing to compute from), so it's safe to stop, resume, and re-run cheaply.

Run from stats-service/:  python scripts/warm_peak_seasons.py
"""

import json
import os
import random
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

import app as stats_app  # noqa: E402

PLAYERS_POOL_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "server", "data", "players.json"
)

DELAY_RANGE = (0.5, 0.9)
FAILURE_THRESHOLD = 3
COOLDOWN_SECONDS = 45
SAVE_EVERY = 25


def needs_peak(player_id):
    entry = stats_app._cache.get(player_id)
    if entry is None:
        return True  # never fetched; a fresh fetch will include peakSeason
    stats = entry.get("stats")
    if stats is None:
        return False  # confirmed no career stats; nothing to compute
    return not stats.get("peakSeason")


def main():
    if stats_app.CACHE_ONLY:
        raise SystemExit("Run in the maintenance container with STATS_CACHE_ONLY=0")
    with open(PLAYERS_POOL_FILE, "r", encoding="utf-8") as f:
        pool_data = json.load(f)
    all_players = pool_data.get("players", pool_data)
    to_fetch = [p["id"] for p in all_players if needs_peak(p["id"])]

    print(f"Full pool: {len(all_players)} players. Missing peakSeason: {len(to_fetch)}.")
    if not to_fetch:
        print("Nothing to do.")
        return

    consecutive_failures = 0
    done = 0
    no_stats = 0
    failed = 0

    for i, player_id in enumerate(to_fetch, 1):
        try:
            # Direct, not fetch_stats_for_player: that one returns the stale
            # cached entry (without peakSeason) instead of re-fetching. This
            # forces the live lookup that recomputes peakSeason.
            result = stats_app._fetch_and_cache_stats(player_id)
            if result and result.get("peakSeason"):
                done += 1
            elif result:
                failed += 1
            else:
                no_stats += 1
            consecutive_failures = 0
        except Exception as e:
            failed += 1
            consecutive_failures += 1
            print(f"  [{i}/{len(to_fetch)}] id={player_id} failed: {e.__class__.__name__}: {e}")

        if i % SAVE_EVERY == 0:
            print(f"  [{i}/{len(to_fetch)}] done={done} no_stats={no_stats} failed={failed}")

        if consecutive_failures >= FAILURE_THRESHOLD:
            print(f"  {consecutive_failures} failures in a row, cooling down {COOLDOWN_SECONDS}s...")
            time.sleep(COOLDOWN_SECONDS)
            consecutive_failures = 0

        time.sleep(random.uniform(*DELAY_RANGE))

    print(f"Done. done={done} no_stats={no_stats} failed={failed}.")


if __name__ == "__main__":
    main()
