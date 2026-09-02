"""Refreshes the three data files stats-service/server ship to production:
server/data/players.json, server/data/notablePlayers.json, and
stats-service/data/statsCache.json.

This exists because Render's own outbound IP is confirmed blocked by
stats.nba.com (every live lookup from there fails outright — see
app.py's ON_RENDER handling), so production can never refresh this data on
its own. It has to be fetched from somewhere that *can* reach stats.nba.com
and shipped via a normal commit + push, which then triggers Render's usual
auto-deploy. Meant to be run on a schedule (see
.github/workflows/refresh-data.yml) rather than only by hand.

Run from stats-service/:  python scripts/refresh_all.py
"""

import json
import os
import random
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

import app as stats_app  # noqa: E402  (side-effect-safe to import — see warm_full_pool.py)

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER_DATA_DIR = os.path.join(ROOT_DIR, "server", "data")
PLAYERS_FILE = os.path.join(SERVER_DATA_DIR, "players.json")
NOTABLE_FILE = os.path.join(SERVER_DATA_DIR, "notablePlayers.json")

# Same jittered, one-at-a-time pacing as warm_full_pool.py — stats.nba.com's
# rate limiting tracks request rate, not total volume.
DELAY_RANGE = (1.0, 1.6)
FAILURE_THRESHOLD = 3
COOLDOWN_SECONDS = 45
SAVE_EVERY = 25

# Bounded so a routine scheduled run can't hang for hours. In steady state
# only a handful of players are ever missing between runs (a new draftee, a
# rare late-career debut), so this ceiling is normally never hit — a big
# backlog (e.g. right after a season's rookie class gets added to the pool)
# just means the run picks up where it left off next time instead of
# finishing in one shot.
MAX_RUNTIME_SECONDS = int(os.environ.get("REFRESH_MAX_RUNTIME_SECONDS", 20 * 60))


def refresh_players_pool():
    print("Refreshing player pool...")
    pool = stats_app.fetch_players_pool()
    entry = {"fetchedAt": int(time.time() * 1000), "players": pool}
    with open(PLAYERS_FILE, "w", encoding="utf-8") as f:
        json.dump(entry, f, indent=2)
    print(f"  wrote {len(pool)} players")
    return pool


def refresh_notable_players():
    print("Refreshing notable-players pool...")
    ids = stats_app.fetch_notable_player_ids()
    entry = {"fetchedAt": int(time.time() * 1000), "ids": ids}
    with open(NOTABLE_FILE, "w", encoding="utf-8") as f:
        json.dump(entry, f, indent=2)
    print(f"  wrote {len(ids)} ids")
    return ids


def warm_missing_stats(all_ids):
    already_cached = set(stats_app._cache.keys())
    to_fetch = [pid for pid in all_ids if pid not in already_cached]
    print(f"Stats cache: {len(already_cached)} already cached, {len(to_fetch)} missing.")
    if not to_fetch:
        return

    start = time.time()
    consecutive_failures = 0
    fetched = 0
    failed = 0

    for i, player_id in enumerate(to_fetch, 1):
        if time.time() - start > MAX_RUNTIME_SECONDS:
            print(
                f"  hit the {MAX_RUNTIME_SECONDS}s runtime budget, stopping early "
                f"({i - 1}/{len(to_fetch)} attempted) — picks up where it left off next run."
            )
            break

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
            print(f"  [{i}/{len(to_fetch)}] fetched={fetched} failed={failed}")

        if consecutive_failures >= FAILURE_THRESHOLD:
            print(f"  {consecutive_failures} failures in a row, cooling down {COOLDOWN_SECONDS}s...")
            time.sleep(COOLDOWN_SECONDS)
            consecutive_failures = 0

        time.sleep(random.uniform(*DELAY_RANGE))

    print(f"Stats warm-up done. fetched={fetched} failed={failed}. Cache now {len(stats_app._cache)} total.")


def main():
    players = refresh_players_pool()
    refresh_notable_players()
    warm_missing_stats([p["id"] for p in players])
    print("Done.")


if __name__ == "__main__":
    main()
