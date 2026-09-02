"""Fills in photoCache.json for players NBA's own CDN has no real headshot
for. Confirmed empirically (not a guess): NBA's "latest" headshot set
403s for a player it has no photo of, and there's no alternate NBA URL
that secretly has it — an alternate CDN host just serves back a generic,
byte-identical placeholder image under a 200 instead of erring. See
photos.py's module docstring for the full story.

This checks every player already in statsCache.json (real career stats,
so a real person worth having a photo for) against NBA's CDN, and for
anyone missing one, searches Wikipedia via photos.py.find_wikipedia_photo.
Only ever run locally/offline — never on a live request path — same
reasoning as warm_full_pool.py: paced, resumable, safe to stop and rerun.

Run from stats-service/:  python scripts/warm_photos.py
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
import photos  # noqa: E402

PLAYERS_POOL_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "server", "data", "players.json"
)

# NBA's CDN check is a cheap HEAD request (no rate-limit history observed
# there the way stats.nba.com has), but the Wikipedia lookup is a real
# external API — paced the same conservative way as every other warm
# script in this project.
DELAY_RANGE = (0.8, 1.4)
SAVE_EVERY = 25


def main():
    with open(PLAYERS_POOL_FILE, "r", encoding="utf-8") as f:
        pool_data = json.load(f)
    names_by_id = {p["id"]: p["fullName"] for p in pool_data.get("players", pool_data)}

    # Only players with a confirmed real career (in statsCache.json with
    # actual stats, not a confirmed-no-record entry) are worth a photo
    # lookup at all.
    candidate_ids = [pid for pid, entry in stats_app._cache.items() if entry.get("stats")]
    already_checked = set(stats_app._photo_cache.keys())
    to_check = [pid for pid in candidate_ids if pid not in already_checked]

    print(f"Players with real stats: {len(candidate_ids)}. Already checked for a photo: {len(already_checked)}. To check: {len(to_check)}.")
    if not to_check:
        print("Nothing to do.")
        return

    has_nba = 0
    found_fallback = 0
    no_photo_anywhere = 0

    for i, player_id in enumerate(to_check, 1):
        if photos.has_nba_headshot(player_id):
            has_nba += 1
            stats_app._photo_cache[player_id] = None
        else:
            name = names_by_id.get(player_id)
            fallback_url = photos.find_wikipedia_photo(name) if name else None
            stats_app._photo_cache[player_id] = fallback_url
            if fallback_url:
                found_fallback += 1
            else:
                no_photo_anywhere += 1
            time.sleep(random.uniform(*DELAY_RANGE))  # only the Wikipedia path hits an external search API

        if i % SAVE_EVERY == 0:
            stats_app.save_photo_cache_to_disk()
            print(f"  [{i}/{len(to_check)}] has_nba={has_nba} found_fallback={found_fallback} no_photo_anywhere={no_photo_anywhere}")

    stats_app.save_photo_cache_to_disk()
    print(f"Done. has_nba={has_nba} found_fallback={found_fallback} no_photo_anywhere={no_photo_anywhere}.")


if __name__ == "__main__":
    main()
