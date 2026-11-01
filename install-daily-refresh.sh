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
cat > /etc/systemd/system/hoop-bids-current.service <<'UNIT'
[Unit]
Description=Refresh Hoop Bids current rosters and season stats
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=/opt/hoop-bids
ExecStart=/usr/bin/docker compose --profile maintenance run --rm --no-deps --name hoop-bids-current-job refresh python -u scripts/refresh_active_now.py
ExecStopPost=-/usr/bin/docker stop -t 30 hoop-bids-current-job
TimeoutStartSec=30min
UNIT
cat > /etc/systemd/system/hoop-bids-current.timer <<'UNIT'
[Unit]
Description=Daily Hoop Bids current-season refresh (Saturday uses weekly job)

[Timer]
OnCalendar=Sun,Mon,Tue,Wed,Thu,Fri *-*-* 10:00:00 UTC
RandomizedDelaySec=5min
Persistent=true

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now hoop-bids-current.timer
systemctl start --no-block hoop-bids-current.service
echo 'Daily updates enabled; an update was requested now. Existing Saturday timer is unchanged.'
echo 'Check: journalctl -u hoop-bids-current.service -n 30 --no-pager'
