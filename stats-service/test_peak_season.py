"""Checks for Peak Season mode's season picker and per-game swap (app.py)."""

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import app


def _season(season_id, gp, pts, reb, ast, stl, blk, fga, fta, tov, mins):
    return pd.Series({
        "SEASON_ID": season_id, "GP": gp, "PTS": pts, "REB": reb, "AST": ast,
        "STL": stl, "BLK": blk, "FGA": fga, "FTA": fta, "TOV": tov, "MIN": mins,
    })


def test_peak_picks_the_best_scoring_season():
    rows = [
        # Rookie year: modest.
        _season("2014-15", 70, 700, 210, 140, 35, 20, 650, 180, 100, 1800),
        # Peak: much higher volume + efficiency.
        _season("2017-18", 75, 2100, 450, 500, 120, 60, 1400, 500, 200, 2700),
        # Decline.
        _season("2021-22", 60, 900, 240, 240, 50, 25, 800, 200, 120, 1900),
    ]
    peak = app._compute_peak_season(rows)
    assert peak is not None
    assert peak["season"] == "2017-18"
    # 2100 pts over 75 games -> 28.0 ppg, rounded to one decimal like the cache.
    assert peak["pointsPerGame"] == 28.0


def test_peak_ignores_a_tiny_cameo_season():
    rows = [
        # 4-game cameo with gaudy per-game rates -- must not count as a peak.
        _season("2001-02", 4, 160, 60, 40, 12, 8, 90, 40, 8, 160),
        # A real full season.
        _season("2003-04", 72, 1500, 500, 350, 90, 70, 1100, 400, 150, 2500),
    ]
    peak = app._compute_peak_season(rows)
    assert peak["season"] == "2003-04"


def test_pre_1974_season_without_steals_blocks_does_not_crash():
    rows = [
        _season("1969-70", 80, 2400, 1400, 300, np.nan, np.nan, 1800, 700, np.nan, 3200),
    ]
    peak = app._compute_peak_season(rows)
    assert peak["season"] == "1969-70"
    assert peak["stealsPerGame"] is None
    assert peak["blocksPerGame"] is None


def test_apply_peak_mode_swaps_per_game_keeps_career_bio():
    stats = {
        "firstSeason": "2010-11", "lastSeason": "2022-23", "seasonsPlayed": 13,
        "gamesPlayed": 900, "pointsPerGame": 18.0, "assistsPerGame": 4.0,
        "position": "SF", "draftYear": 2010, "team": "LAL",
        "peakSeason": {
            "season": "2016-17", "gamesPlayed": 78, "pointsPerGame": 29.5,
            "assistsPerGame": 6.1,
        },
    }
    merged = app._apply_peak_mode(stats)
    assert merged["pointsPerGame"] == 29.5
    assert merged["assistsPerGame"] == 6.1
    assert merged["gamesPlayed"] == 78
    assert merged["firstSeason"] == "2016-17"
    assert merged["lastSeason"] == "2016-17"
    assert merged["seasonsPlayed"] == 1
    # Career bio is untouched.
    assert merged["position"] == "SF"
    assert merged["team"] == "LAL"


def test_apply_peak_mode_without_peak_rejects_career_fallback():
    stats = {"pointsPerGame": 12.0, "peakSeason": None}
    assert app._apply_peak_mode(stats) is None


def test_peak_endpoint_rejects_missing_snapshot_and_keeps_career_cache():
    from unittest.mock import patch
    career = {"pointsPerGame": 12.0, "lastSeason": "2020-21", "peakSeason": None}
    with patch.object(app, "fetch_stats_for_player", return_value=career):
        client = app.app.test_client()
        for endpoint in ("stats", "full-stats"):
            response = client.get(f"/{endpoint}?id=2544&mode=peak")
            assert response.status_code == 404
            assert response.json["error"] == "PEAK_STATS_UNAVAILABLE"
    assert career["pointsPerGame"] == 12.0


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok  {name}")
    print("all peak-season checks passed")
