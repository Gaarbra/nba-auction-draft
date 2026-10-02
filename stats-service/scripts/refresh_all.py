"""Bounded, resumable refresh. Run only where the NBA API is reachable.
Docker uses a shared data volume; local/CI runs also update server catalogues.
"""
import os
from pathlib import Path
import sys
import time
import signal

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "stats-service"))
DAY = 86400


def due_players(pool, cache, now, active_days=7):
    # Weekly refreshes never fetch retired players, even when their cache is missing.
    due = [p for p in pool if p["isActive"] and (p["id"] not in cache or
           now - cache[p["id"]].get("fetchedAt", 0) >= active_days * DAY)]
    return sorted(due, key=lambda p: (cache.get(p["id"], {}).get("fetchedAt", 0), p["id"]))


def refresh_batch(candidates, fetch, publish, budget, clock=time.monotonic, sleep=time.sleep):
    deadline = clock() + budget
    completed = failed = consecutive = 0
    try:
        for player in candidates:
            if clock() >= deadline:
                break
            try:
                fetch(player["id"])
                completed += 1
                consecutive = 0
            except Exception as error:
                failed += 1
                consecutive += 1
                print(f"[refresh] id={player['id']} failed: {type(error).__name__}")
                if consecutive >= 3:
                    raise RuntimeError("Three consecutive failures; keeping saved data and stopping") from None
                sleep(10 * consecutive)
            if completed and completed % 25 == 0:
                publish()
            sleep(2)
    finally:
        publish()
    print(f"[refresh] completed={completed} failed={failed} pending={len(candidates)-completed}")
    return failed


def main():
    # Set before importing app: never build ML indexes or start background fetches here.
    os.environ["STATS_REFRESH_JOB"] = "1"
    os.environ["STATS_CACHE_ONLY"] = "0"
    os.environ.pop("RENDER", None)
    from dotenv import load_dotenv
    load_dotenv(ROOT / "stats-service" / ".env")
    data = ROOT / "stats-service" / "data"
    data.mkdir(exist_ok=True)
    # Linux job lock also protects against manual runs overlapping the weekly timer.
    import fcntl
    with open(data / ".refresh.lock", "a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("[refresh] Another refresh is already running; skipped.")
            return 0
        import app as service

        def publish():
            service._atomic_write_json(service.STATS_CACHE_FILE, service._cache)
            service._atomic_write_json(service.AWARDS_CACHE_FILE, service._awards_cache)
            service._atomic_write_json(service.USAGE_CACHE_FILE, {
                service._usage_cache_key(*key): value for key, value in service._usage_cache.items()
            })

        def catalogue(name, value):
            service._atomic_write_json(str(data / name), value)
            if os.environ.get("REFRESH_SERVER_CATALOGUES", "1") == "1":
                service._atomic_write_json(str(ROOT / "server" / "data" / name), value)

        active_days = max(0, int(os.environ.get("REFRESH_ACTIVE_DAYS", "7")))
        started = time.time()
        status = {"startedAt": started, "state": "running", "activePlayersOnly": True}
        def interrupted(signum, frame):
            raise RuntimeError("Refresh interrupted; checkpointing")
        signal.signal(signal.SIGTERM, interrupted)
        service._atomic_write_json(str(data / "refreshStatus.json"), status)
        try:
            pool = service.fetch_players_pool()
            if not pool:
                raise ValueError("Empty player catalogue; preserving saved data")
            catalogue("players.json", {"players": pool, "fetchedAt": time.time() * 1000})
            from active_now import refresh as refresh_active_now
            refresh_active_now(service, pool)
            time.sleep(2)
            notable = service.fetch_notable_player_ids()
            if not notable:
                raise ValueError("Empty notable catalogue; preserving saved data")
            catalogue("notablePlayers.json", {"ids": sorted(notable), "fetchedAt": time.time() * 1000})
            time.sleep(2)
            team, ids = service.fetch_top_team_player_ids()
            if team and ids:
                catalogue("topTeamPlayers.json", {"ids": sorted(ids), "teamAbbreviation": team, "fetchedAt": time.time() * 1000})
            stats_candidates = due_players(pool, service._cache, time.time(), active_days)
            failed = refresh_batch(
                stats_candidates,
                service._fetch_and_cache_stats, publish,
                max(1, int(os.environ.get("REFRESH_MAX_RUNTIME_SECONDS", "1200"))),
            )
            award_pool = [p for p in pool if service._cache.get(p["id"], {}).get("stats")]
            award_candidates = due_players(award_pool, service._awards_cache, time.time(), active_days)
            failed += refresh_batch(
                award_candidates,
                service._fetch_and_cache_awards, publish,
                max(1, int(os.environ.get("REFRESH_AWARDS_MAX_RUNTIME_SECONDS", "600"))),
            )
            # Usage is a league-wide endpoint. Refresh only the latest active
            # season; never request historical seasons as part of this job.
            seasons = {}
            for player in pool:
                if not player["isActive"]:
                    continue
                stats = service._cache.get(player["id"], {}).get("stats") or {}
                season = stats.get("lastSeason")
                if season and season >= service.EARLIEST_USG_SEASON:
                    seasons[season] = player["id"]
            current = max(seasons, default="")
            pending_usage = []
            for season, pid in sorted(seasons.items(), reverse=True):
                if season != current:
                    continue
                entries = [v for (_, s), v in service._usage_cache.items() if s == season]
                if entries and (season != current or time.time() - max(v["fetchedAt"] for v in entries) < 7 * DAY):
                    continue
                pending_usage.append((season, pid))
            usage_deadline = time.monotonic() + 300
            status["pendingUsageSeasons"] = len(pending_usage)
            for season, pid in pending_usage:
                if time.monotonic() >= usage_deadline:
                    break
                service.fetch_usage_pct(pid, season)
                publish()
                status["pendingUsageSeasons"] -= 1
                time.sleep(2)
            status["state"] = "partial" if failed else "complete"
            status["pendingStats"] = sum(service._cache.get(p["id"], {}).get("fetchedAt", 0) < started for p in stats_candidates)
            status["pendingAwards"] = sum(service._awards_cache.get(p["id"], {}).get("fetchedAt", 0) < started for p in award_candidates)
            if status["pendingStats"] or status["pendingAwards"] or status["pendingUsageSeasons"]:
                status["state"] = "partial"
            return 1 if failed else 0
        except Exception as error:
            status.update(state="failed", error=type(error).__name__)
            print(f"[refresh] Stopped: {type(error).__name__}; saved data retained.")
            return 1
        finally:
            publish()
            status["finishedAt"] = time.time()
            service._atomic_write_json(str(data / "refreshStatus.json"), status)


if __name__ == "__main__":
    raise SystemExit(main())
