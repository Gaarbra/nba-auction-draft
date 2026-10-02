import unittest
from datetime import date
from active_now import build_snapshot, season_for


class ActiveNowTests(unittest.TestCase):
    def test_one_season_only_and_preseason_fallback(self):
        row = dict(PLAYER_ID=1, PLAYER_NAME="Active Player", TEAM_ID=1, TEAM_ABBREVIATION="BOS",
                   GP=10, PTS=8, REB=4, AST=2, STL=1, BLK=0, FGA=7, FTA=2, TOV=1, MIN=20)
        pool = [{"id": 1, "isActive": True}, {"id": 2, "isActive": False}, {"id": 3, "isActive": True}]
        bios = {1: {"stats": {"pointsPerGame": 99, "position": "G", "usagePct": 99}}}
        calls = []
        def fetch(season, measure):
            calls.append((season, measure))
            if season == "2026-27": return []
            if measure == "Advanced": return [dict(PLAYER_ID=1, USG_PCT=.2), dict(PLAYER_ID=2, USG_PCT=.3)]
            return [row, dict(row, PLAYER_ID=2), dict(row, PLAYER_ID=3, GP=0)]
        snapshot = build_snapshot(fetch, pool, bios, date(2026, 10, 2))
        self.assertEqual(snapshot["season"], "2025-26")
        self.assertTrue(snapshot["usesPreviousSeason"])
        self.assertEqual([p["id"] for p in snapshot["players"]], [1])
        self.assertEqual(snapshot["players"][0]["stats"]["pointsPerGame"], 8)
        self.assertEqual(snapshot["players"][0]["stats"]["usagePct"], 20)
        self.assertEqual(calls, [("2026-27", "Base"), ("2025-26", "Base"), ("2025-26", "Advanced")])
        calls.clear()
        def current(season, measure):
            calls.append(season)
            return [dict(PLAYER_ID=1, USG_PCT=.2)] if measure == "Advanced" else [dict(row, GP=1, PTS=3)]
        snapshot = build_snapshot(current, pool, bios, date(2026, 10, 25))
        self.assertEqual(snapshot["season"], "2026-27")
        self.assertEqual(snapshot["players"][0]["stats"]["pointsPerGame"], 3)
        self.assertEqual(calls, ["2026-27", "2026-27"])
        self.assertEqual(season_for(date(2027, 1, 1)), "2026-27")

    def test_outage_never_falls_back(self):
        def fail(*args): raise TimeoutError("upstream unavailable")
        with self.assertRaises(TimeoutError): build_snapshot(fail, [], {}, date(2026, 10, 2))


if __name__ == "__main__":
    unittest.main()
