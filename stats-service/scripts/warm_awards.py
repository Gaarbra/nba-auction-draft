"""Fills in awardsCache.json the same way warm_photos.py fills in
photoCache.json. Needed for the identical reason: fetch_player_awards has
the same ON_RENDER guard as fetch_stats_for_player (stats.nba.com is
confirmed unreachable from Render's outbound IP), so on Render /awards
only ever serves what's already in the cache -- and unlike
statsCache.json/photoCache.json, awardsCache.json was never actually
shipped, so production currently returns [] for every player. This
builds a real one locally (which *can* reach stats.nba.com) and the
result gets committed and shipped, same as the other two caches.

Same candidate set as warm_photos.py: only players already in
statsCache.json with a confirmed real career are worth an awards lookup.

Run from stats-service/:  python scripts/warm_awards.py
"""

import os
import random
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

import app as stats_app  # noqa: E402

DELAY_RANGE = (1.0, 1.6)  # same jittered pacing as warm_full_pool.py's live stats.nba.com calls
FAILURE_THRESHOLD = 3
COOLDOWN_SECONDS = 45
SAVE_EVERY = 25


def main():
    candidate_ids = [pid for pid, entry in stats_app._cache.items() if entry.get("stats")]
    already_cached = set(stats_app._awards_cache.keys())
    to_fetch = [pid for pid in candidate_ids if pid not in already_cached]

    print(f"Players with real stats: {len(candidate_ids)}. Already have awards cached: {len(already_cached)}. To fetch: {len(to_fetch)}.")
    if not to_fetch:
        print("Nothing to do.")
        return

    consecutive_failures = 0
    fetched = 0
    no_awards = 0
    failed = 0

    for i, player_id in enumerate(to_fetch, 1):
        try:
            # Calls the live lookup directly (not fetch_player_awards' public
            # wrapper) because that wrapper's ON_RENDER guard would skip the
            # fetch entirely if this script were ever accidentally run with
            # ON_RENDER set -- this is only ever meant to run locally, and
            # going straight to the real fetch makes that assumption explicit
            # instead of silently no-op'ing.
            awards = stats_app._fetch_and_cache_awards(player_id)
            if awards:
                fetched += 1
            else:
                no_awards += 1
            consecutive_failures = 0
        except Exception as e:
            failed += 1
            consecutive_failures += 1
            print(f"  [{i}/{len(to_fetch)}] id={player_id} failed: {e.__class__.__name__}: {e}")

        if i % SAVE_EVERY == 0:
            print(f"  [{i}/{len(to_fetch)}] fetched={fetched} no_awards={no_awards} failed={failed} (cache now {len(stats_app._awards_cache)} total)")

        if consecutive_failures >= FAILURE_THRESHOLD:
            print(f"  {consecutive_failures} failures in a row, cooling down {COOLDOWN_SECONDS}s...")
            time.sleep(COOLDOWN_SECONDS)
            consecutive_failures = 0

        time.sleep(random.uniform(*DELAY_RANGE))

    print(f"Done. fetched={fetched} no_awards={no_awards} failed={failed}. Cache now {len(stats_app._awards_cache)} total players.")


if __name__ == "__main__":
    main()
