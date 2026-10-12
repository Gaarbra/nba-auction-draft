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
import argparse
import os
import random
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

PLAYERS_POOL_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "server", "data", "players.json"
)

DELAY_RANGE = (3, 5)
RETRY_DELAYS = (30, 90)
FAILURE_THRESHOLD = 3
COOLDOWN_SECONDS = 300


def needs_peak(player_id, cache, include_team_history=False):
    entry = cache.get(player_id)
    if entry is None:
        return True  # never fetched; a fresh fetch will include peakSeason
    stats = entry.get("stats")
    if stats is None:
        return False  # confirmed no career stats; nothing to compute
    history = stats.get("teamHistory") or []
    missing_dates = not history or any(not isinstance(stint.get("seasons"), list) for stint in history)
    return not stats.get("peakSeason") or (include_team_history and missing_dates)


def fetch_peak_with_retry(player_id, fetch, sleep=time.sleep):
    for attempt in range(len(RETRY_DELAYS) + 1):
        try:
            result = fetch(player_id)
            if result is None:
                return "no_stats"
            if result.get("peakSeason"):
                return "done"
            # A stale career returned after a failed fetch is not a success.
            error = "MissingPeakSeason"
        except Exception as exc:
            error = type(exc).__name__
        print(f"  id={player_id} attempt={attempt + 1}/3 failed: {error}", flush=True)
        if attempt < len(RETRY_DELAYS):
            delay = RETRY_DELAYS[attempt] + random.uniform(0, 10)
            print(f"  Retry in {delay:.0f}s", flush=True)
            sleep(delay)
    return "failed"


def main(include_team_history=False):
    import app as stats_app

    if stats_app.CACHE_ONLY:
        raise SystemExit("Run in the maintenance container with STATS_CACHE_ONLY=0")
    with open(PLAYERS_POOL_FILE, "r", encoding="utf-8") as f:
        pool_data = json.load(f)
    all_players = pool_data.get("players", pool_data)
    to_fetch = [p["id"] for p in all_players if needs_peak(p["id"], stats_app._cache, include_team_history)]

    target = "peakSeason or team-season history" if include_team_history else "peakSeason"
    print(f"Full pool: {len(all_players)} players. Missing {target}: {len(to_fetch)}.")
    print("Pacing: 3-5s between players; up to 3 attempts; 5-minute outage pauses.", flush=True)
    if not to_fetch:
        print("Nothing to do.")
        return

    consecutive_failures = 0
    done = 0
    no_stats = 0
    failed = 0

    for i, player_id in enumerate(to_fetch, 1):
        outcome = fetch_peak_with_retry(player_id, stats_app._fetch_and_cache_stats)
        if outcome == "failed":
            failed += 1
            consecutive_failures += 1
        else:
            consecutive_failures = 0
            done += outcome == "done"
            no_stats += outcome == "no_stats"

        print(f"  [{i}/{len(to_fetch)}] done={done} no_stats={no_stats} failed={failed}", flush=True)

        if consecutive_failures >= FAILURE_THRESHOLD:
            raise SystemExit("Stopping after 3 consecutive players exhausted their retries; saved progress retained. Retry later.")
        if outcome == "failed":
            print(f"  Cooling down {COOLDOWN_SECONDS}s before the next player...", flush=True)
            time.sleep(COOLDOWN_SECONDS)

        time.sleep(random.uniform(*DELAY_RANGE))

    print(f"Done. done={done} no_stats={no_stats} failed={failed}.")
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--team-history", action="store_true", help="Also backfill missing team-season dates")
    main(parser.parse_args().team_history)
