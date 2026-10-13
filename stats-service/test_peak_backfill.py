import importlib.util
from pathlib import Path
import unittest
import tempfile
import json
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('peak_warm', Path(__file__).parent / 'scripts' / 'warm_peak_seasons.py')
job = importlib.util.module_from_spec(spec)
spec.loader.exec_module(job)

class PeakRetryTests(unittest.TestCase):
    def test_coverage_distinguishes_completed_skipped_and_unprocessed(self):
        players = [{'id': i} for i in range(1, 6)]
        cache = {
            '1': {'stats': {'peakSeason': {'season': '2015-16'}}},
            '2': {'stats': None},
            '3': {'stats': {'pointsPerGame': 10}},
            '4': {'stats': {'peakSeason': {'pointsPerGame': 20}}},
            '99': {'stats': {'peakSeason': {'season': '2020-21'}}},
        }
        self.assertEqual(job.peak_coverage(players, cache), {
            'ready': 1, 'no_stats': 1, 'missing_peak': 2, 'never_fetched': 1,
        })

    def test_retry_recovers_and_backs_off(self):
        fetch = Mock(side_effect=[TimeoutError(), TimeoutError(), {'peakSeason': {'season': '2015-16'}}])
        sleep = Mock()
        with patch.object(job.random, 'uniform', return_value=0):
            self.assertEqual(job.fetch_peak_with_retry(1, fetch, sleep), 'done')
        self.assertEqual([c.args[0] for c in sleep.call_args_list], [30, 90])
        self.assertEqual(fetch.call_count, 3)

    def test_exhaustion_and_no_stats(self):
        for response in [TimeoutError(), {'pointsPerGame': 10}]:
            fetch = Mock(side_effect=response) if isinstance(response, Exception) else Mock(return_value=response)
            self.assertEqual(job.fetch_peak_with_retry(1, fetch, lambda _: None), 'failed')
            self.assertEqual(fetch.call_count, 3)
        fetch = Mock(return_value=None)
        self.assertEqual(job.fetch_peak_with_retry(1, fetch, lambda _: None), 'no_stats')
        self.assertEqual(fetch.call_count, 1)

    def test_resume_skips_saved_peaks(self):
        cache = {1: {'stats': {'peakSeason': {'season': '2015-16'}}}, 2: {'stats': None}, 3: {'stats': {}}}
        self.assertFalse(job.needs_peak(1, cache))
        self.assertTrue(job.needs_peak(1, cache, include_team_history=True))
        cache[1]["stats"]["teamHistory"] = [{"abbreviation": "MIA", "seasons": ["2015-16"]}]
        self.assertFalse(job.needs_peak(1, cache, include_team_history=True))
        self.assertFalse(job.needs_peak(2, cache))
        self.assertTrue(job.needs_peak(3, cache))
        self.assertTrue(job.needs_peak(4, cache))

    def test_sustained_outage_stops_before_fourth_player(self):
        app = Mock(CACHE_ONLY=False, _cache={})
        with tempfile.TemporaryDirectory() as directory:
            pool = Path(directory) / 'players.json'
            pool.write_text(json.dumps({'players': [{'id': i} for i in range(4)]}))
            with patch.dict('sys.modules', {'app': app}), patch.object(job, 'PLAYERS_POOL_FILE', str(pool)), patch.object(job, 'fetch_peak_with_retry', return_value='failed') as fetch, patch.object(job.time, 'sleep') as sleep:
                with self.assertRaisesRegex(SystemExit, 'Stopping after 3'):
                    job.main()
                self.assertEqual(fetch.call_count, 3)
                self.assertEqual(sum(c.args[0] == 300 for c in sleep.call_args_list), 2)

if __name__ == '__main__':
    unittest.main()
