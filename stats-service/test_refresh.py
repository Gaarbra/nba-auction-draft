"""Offline regression checks: no NBA calls and no production cache writes."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock

ROOT = Path(__file__).parent
spec = importlib.util.spec_from_file_location("refresh", ROOT / "scripts" / "refresh_all.py")
refresh = importlib.util.module_from_spec(spec)
spec.loader.exec_module(refresh)


class RefreshTests(unittest.TestCase):
    def test_selection_resume_and_failure_budget(self):
        now = 100 * refresh.DAY
        pool = [{"id": i, "isActive": i < 4} for i in range(1, 6)]
        cache = {1: {"fetchedAt": now}, 2: {"fetchedAt": 0}, 4: {"fetchedAt": 0}}
        self.assertEqual([p["id"] for p in refresh.due_players(pool, cache, now)], [2, 3])
        self.assertEqual([p["id"] for p in refresh.due_players(pool, cache, now, active_days=0)], [2, 3, 1])
        self.assertEqual(refresh.due_players([{"id": 99, "isActive": False}], {}, now), [])
        fetched, published = [], []
        def fetch(pid):
            fetched.append(pid)
            cache[pid] = {"fetchedAt": now}
        refresh.refresh_batch(refresh.due_players(pool, cache, now), fetch,
                              lambda: published.append(True), 20, sleep=lambda _: None)
        self.assertFalse(refresh.due_players(pool, cache, now))
        self.assertTrue(published)
        def fail(pid):
            raise TimeoutError("must not be printed")
        with self.assertRaises(RuntimeError):
            refresh.refresh_batch(pool, fail, lambda: published.append(True), 20, sleep=lambda _: None)
        self.assertEqual(len(published), 2)
        refresh.refresh_batch(pool, fetch, lambda: None, 1, clock=iter([0, 2]).__next__)
        self.assertEqual(fetched, [2, 3])

    def test_cached_serving_and_atomic_reload(self):
        # Environment is explicit so local .env credentials can never be used.
        with patch.dict(os.environ, {"STATS_CACHE_ONLY": "1", "STATS_REFRESH_JOB": "1",
                                    "DATABASE_URL": "", "PROXY_URL": "", "S3_RAW_ARCHIVE_BUCKET": ""}), \
             patch("requests.sessions.Session.send", side_effect=AssertionError("Unexpected network call")):
            import app
            with tempfile.TemporaryDirectory() as directory, \
                 patch.object(app, "DATA_DIR", directory), \
                 patch.object(app, "_snapshot_versions", {}), \
                 patch.object(app, "_snapshot_checked_at", 0), \
                 patch.object(app, "_cache", {}), patch.object(app, "_awards_cache", {}), \
                 patch.object(app, "_photo_cache", {}), patch.object(app, "_usage_cache", {}), \
                 patch.object(app, "_pool_cache", {}), patch.object(app, "_notable_cache", {}), \
                 patch.object(app, "_top_team_cache", {}):
                path = Path(directory) / "statsCache.json"
                app._atomic_write_json(str(path), {"42": {"stats": {"pointsPerGame": 12}, "fetchedAt": 0}})
                app._atomic_write_json(str(Path(directory) / "players.json"), {"players": [{"id": 42}], "fetchedAt": 1000})
                app._atomic_write_json(str(Path(directory) / "notablePlayers.json"), {"ids": [42], "fetchedAt": 1000})
                app._atomic_write_json(str(Path(directory) / "topTeamPlayers.json"), {"ids": [42], "teamAbbreviation": "LAL", "fetchedAt": 1000})
                app.reload_saved_snapshots()
                self.assertEqual(app.fetch_stats_for_player(42)["pointsPerGame"], 12)
                self.assertIsNone(app.fetch_stats_for_player(99))
                self.assertEqual(app.fetch_player_awards(99), [])
                self.assertIsNone(app.fetch_usage_pct(99, "2025-26"))
                self.assertIsNone(app.get_fallback_photo_url(99, "Missing"))
                self.assertEqual(app.fetch_players_pool(), [{"id": 42}])
                self.assertEqual(app.fetch_notable_player_ids(), {42})
                self.assertEqual(app.fetch_top_team_player_ids(), ("LAL", {42}))
                self.assertEqual(app.app.test_client().get("/debug-reachability").status_code, 403)
                app._atomic_write_json(str(path), {"42": {"stats": {"pointsPerGame": 15}, "fetchedAt": 1}})
                app._snapshot_checked_at = 0
                app.reload_saved_snapshots()
                self.assertEqual(app.fetch_stats_for_player(42)["pointsPerGame"], 15)
                career = Mock()
                career.get_data_frames.return_value = [Mock(empty=True)]
                with patch.object(app.playercareerstats, "PlayerCareerStats", return_value=career), \
                     patch.object(app.s3_archive, "archive_raw_response"):
                    with self.assertRaises(ValueError):
                        app._fetch_and_cache_stats(42)
                self.assertEqual(app.fetch_stats_for_player(42)["pointsPerGame"], 15)
                app._awards_cache[42] = {"fetchedAt": 0, "awards": [{"label": "MVP"}]}
                awards = Mock()
                awards.get_normalized_dict.return_value = {"PlayerAwards": []}
                with patch.object(app.playerawards, "PlayerAwards", return_value=awards), \
                     patch.object(app.s3_archive, "archive_raw_response"):
                    with self.assertRaises(ValueError):
                        app._fetch_and_cache_awards(42)
                self.assertEqual(app.fetch_player_awards(42), [{"label": "MVP"}])
                path.write_text("{broken", encoding="utf-8")
                app._snapshot_checked_at = 0
                app.reload_saved_snapshots()
                self.assertEqual(app.fetch_stats_for_player(42)["pointsPerGame"], 15)


if __name__ == "__main__":
    unittest.main()
