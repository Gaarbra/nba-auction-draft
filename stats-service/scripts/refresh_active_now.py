"""Bootstrap only the season snapshot, using the configured NBA proxy."""
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["STATS_REFRESH_JOB"] = "1"
os.environ["STATS_CACHE_ONLY"] = "0"
import app as service
from active_now import refresh

if __name__ == "__main__":
    # Share the weekly refresh lock; never race its snapshot publish.
    import fcntl
    with open(Path(service.DATA_DIR) / ".refresh.lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        refresh(service, service.fetch_players_pool())
