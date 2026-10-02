#!/usr/bin/env bash
# Run on the existing Servercheap installation after pulling this commit.
set -euo pipefail
cd /opt/hoop-bids
docker compose config --quiet
if systemctl is-active --quiet hoop-bids-refresh.service || systemctl is-active --quiet hoop-bids-refresh-today.service; then
  echo 'A refresh is running. Wait for it to finish, then rerun this script.'
  exit 1
fi
docker compose build stats server web
# Uses the existing proxy configuration and shared stats volume.
# A failed season download leaves the previous snapshot and app running.
docker compose --profile maintenance run --rm --no-deps refresh python scripts/refresh_active_now.py
if [ -f /usr/local/lib/hoop-bids/refresh_all.py ]; then
  cp -p /usr/local/lib/hoop-bids/refresh_all.py "/usr/local/lib/hoop-bids/refresh_all.py.before-season-$(date -u +%Y%m%dT%H%M%SZ)"
  install -m 644 stats-service/scripts/refresh_all.py /usr/local/lib/hoop-bids/refresh_all.py
fi
docker compose up -d --no-deps --wait stats
docker compose up -d --no-deps --wait server web
docker compose ps
echo 'Active Now installed. The existing Saturday timer now refreshes its season snapshot too.'
