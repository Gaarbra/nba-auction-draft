#!/usr/bin/env bash
# Run on the VPS after deploying the updated stats image. Keeps Saturday's job.
set -euo pipefail
cd /opt/hoop-bids
docker compose config --quiet
# Older installations bind-mount this script into Saturday's container.
if [ -f /usr/local/lib/hoop-bids/refresh_all.py ]; then
  cp -p /usr/local/lib/hoop-bids/refresh_all.py "/usr/local/lib/hoop-bids/refresh_all.py.before-current-$(date -u +%Y%m%dT%H%M%SZ)"
  install -m 644 stats-service/scripts/refresh_all.py /usr/local/lib/hoop-bids/refresh_all.py
fi
# Disable only the daily timer. Let any already-running refresh finish safely.
if systemctl cat hoop-bids-current.timer >/dev/null 2>&1; then
  systemctl disable --now hoop-bids-current.timer
fi
systemctl enable --now hoop-bids-refresh.timer
echo 'Weekly Saturday updates enabled. Daily scheduling is disabled.'
systemctl list-timers 'hoop-bids-*'
