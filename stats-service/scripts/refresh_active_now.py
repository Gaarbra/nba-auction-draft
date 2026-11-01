"""Refresh current rosters, season stats and active-player careers through the proxy."""
import os
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["STATS_REFRESH_JOB"] = "1"
os.environ["STATS_CACHE_ONLY"] = "0"
import app as service
from active_now import refresh
from refresh_all import due_players, refresh_batch

if __name__ == "__main__":
    # Share the weekly refresh lock; never race its snapshot publish.
    import fcntl
    with open(Path(service.DATA_DIR) / ".refresh.lock", "a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit("Another data refresh is running; try after it finishes.")
        pool = service.fetch_players_pool()
        if not pool:
            raise SystemExit("Empty roster response; saved data retained.")
        service._atomic_write_json(str(Path(service.DATA_DIR) / "players.json"),
                                   {"players": pool, "fetchedAt": time.time() * 1000})
        refresh(service, pool)
        # Publish as we go. Existing games keep their frozen season snapshot.
        def publish():
            service._atomic_write_json(service.STATS_CACHE_FILE, service._cache)
        def interrupted(signum, frame):
            raise SystemExit("Refresh interrupted; saving progress.")
        import signal
        signal.signal(signal.SIGTERM, interrupted)
        failed = refresh_batch(due_players(pool, service._cache, time.time(), active_days=1),
                               service._fetch_and_cache_stats, publish, 1200)
        raise SystemExit(1 if failed else 0)
