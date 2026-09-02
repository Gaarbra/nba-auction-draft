"""Fetches every player in the full pool that isn't already in
statsCache.json — not just the "notable" leaderboard subset app.py's
warm_notable_pool() covers. Needed because Render can't reach
stats.nba.com live (confirmed — see HANDOFF notes), so any player outside
the shipped cache currently comes back "stats unavailable" in production.
This runs locally (which *can* reach stats.nba.com) and the resulting
expanded statsCache.json gets committed and shipped, the same way the
original 1,354-player snapshot was.

Saves progressively (every SAVE_EVERY players), so it's safe to stop and
resume, or to ship whatever's accumulated even if it doesn't finish.

Run from stats-service/:  python scripts/warm_full_pool.py
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

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
PLAYERS_POOL_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "server", "data", "players.json"
)

DELAY_RANGE = (1.0, 1.6)  # same jittered pacing as the existing notable-pool warm-up
FAILURE_THRESHOLD = 3
COOLDOWN_SECONDS = 45
SAVE_EVERY = 25


def main():
    with open(PLAYERS_POOL_FILE, "r", encoding="utf-8") as f:
        pool_data = json.load(f)
    all_players = pool_data.get("players", pool_data)
    all_ids = [p["id"] for p in all_players]

    already_cached = set(stats_app._cache.keys())
    to_fetch = [pid for pid in all_ids if pid not in already_cached]

    print(f"Full pool: {len(all_ids)} players. Already cached: {len(already_cached)}. To fetch: {len(to_fetch)}.")
    if not to_fetch:
        print("Nothing to do.")
        return

    consecutive_failures = 0
    fetched = 0
    failed = 0

    for i, player_id in enumerate(to_fetch, 1):
        try:
            result = stats_app.fetch_stats_for_player(player_id)
            if result:
                fetched += 1
                consecutive_failures = 0
            else:
                failed += 1
                consecutive_failures += 1
        except Exception as e:
            failed += 1
            consecutive_failures += 1
            print(f"  [{i}/{len(to_fetch)}] id={player_id} failed: {e.__class__.__name__}: {e}")

        if i % SAVE_EVERY == 0:
            print(f"  [{i}/{len(to_fetch)}] fetched={fetched} failed={failed} (cache now {len(stats_app._cache)} total)")

        if consecutive_failures >= FAILURE_THRESHOLD:
            print(f"  {consecutive_failures} failures in a row, cooling down {COOLDOWN_SECONDS}s...")
            time.sleep(COOLDOWN_SECONDS)
            consecutive_failures = 0

        time.sleep(random.uniform(*DELAY_RANGE))

    print(f"Done. fetched={fetched} failed={failed}. Cache now {len(stats_app._cache)} total players.")


if __name__ == "__main__":
    main()
