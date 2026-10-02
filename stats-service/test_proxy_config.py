import os
import unittest
from unittest.mock import patch
import requests
from proxy_config import configure_proxy


class ProxyConfigTest(unittest.TestCase):
    def test_external_requests_use_proxy_but_internal_requests_do_not(self):
        proxy = "http://test:secret@gw.dataimpulse.com:823"
        with patch.dict(os.environ, {"PROXY_URL": proxy, "https_proxy": "http://old:123", "NO_PROXY": "custom.internal"}, clear=True):
            self.assertTrue(configure_proxy())
            with requests.Session() as session:
                external = session.merge_environment_settings("https://stats.nba.com/stats/playercareerstats", {}, False, True, None)
                self.assertEqual(external["proxies"]["https"], proxy)
                for host in ("localhost", "127.0.0.1", "stats", "server", "db", "custom.internal"):
                    internal = session.merge_environment_settings(f"http://{host}:5001/health", {}, False, True, None)
                    self.assertEqual(internal["proxies"], {})

    def test_missing_or_invalid_configuration(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(configure_proxy())
        for url in ("dataimpulse.com", "http://dataimpulse.com", "http://user:SECRET@proxy:bad"):
            with patch.dict(os.environ, {"PROXY_URL": url}, clear=True):
                with self.assertRaises(ValueError) as error:
                    configure_proxy()
                self.assertNotIn("SECRET", str(error.exception))


if __name__ == "__main__":
    unittest.main()
