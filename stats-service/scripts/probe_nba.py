"""Small live connectivity check. Runs three paid-proxy requests, not a refresh."""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from proxy_config import configure_proxy

if not configure_proxy():
    raise SystemExit("PROXY_URL is required for this proxy connectivity test")

from nba_api.stats.endpoints import commonallplayers, playercareerstats, playerawards

checks = (
    ("player catalogue", lambda: commonallplayers.CommonAllPlayers(timeout=30)),
    ("career stats", lambda: playercareerstats.PlayerCareerStats(player_id=2544, timeout=30)),
    ("awards", lambda: playerawards.PlayerAwards(player_id=2544, timeout=30)),
)
for label, fetch in checks:
    try:
        result = fetch().get_dict()
        if not any(group.get("rowSet") for group in result.get("resultSets", [])):
            raise ValueError("No records returned")
        print(f"[NBA CHECK] {label}: records received", flush=True)
    except Exception as error:
        # Exception messages can embed proxy credentials; report only the type.
        print(f"[NBA CHECK] {label}: FAILED ({type(error).__name__}). Check gateway credentials, quota and connectivity.", file=sys.stderr)
        raise SystemExit(1) from None
    time.sleep(2)
print("[NBA CHECK] All checks passed. This confirms current access, not future availability.")
