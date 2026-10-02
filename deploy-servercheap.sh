#!/usr/bin/env bash
# Run on a dedicated Ubuntu VPS: sudo bash deploy-servercheap.sh
set +x
set -Eeuo pipefail
umask 077
trap 'printf "[VIBE CODE] Deployment stopped at line %s. Existing volumes were preserved.\n" "$LINENO" >&2' ERR
log() { printf '\n[VIBE CODE] %s\n' "$*"; }
[[ $EUID -eq 0 ]] || { echo "Run with sudo bash deploy-servercheap.sh" >&2; exit 1; }
source /etc/os-release
[[ "$ID" == ubuntu ]] || { echo "This script supports Ubuntu only." >&2; exit 1; }
case "$VERSION_ID" in 22.04|24.04|26.04) ;; *) echo "Use Ubuntu 22.04, 24.04 or 26.04 LTS." >&2; exit 1 ;; esac

APP_DIR=/opt/hoop-bids
REPO_URL=https://github.com/Gaarbra/nba-auction-draft.git
log "Updating Ubuntu packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get upgrade -y
apt-get install -y ca-certificates curl git openssl python3

log "Installing Docker Engine from Docker's official repository..."
for package in docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc; do
  if dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q '^install ok installed$'; then
    echo "Conflicting package $package exists. Migrate that installation before running this script." >&2
    exit 1
  fi
done
install -m 0755 -d /etc/apt/keyrings
curl --fail --show-error --silent --retry 3 https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
cat >/etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

log "Fetching Hoop Bids..."
if [[ -d "$APP_DIR/.git" ]]; then
  [[ "$(git -C "$APP_DIR" remote get-url origin)" == "$REPO_URL" ]] || { echo "Unexpected origin in $APP_DIR" >&2; exit 1; }
  [[ "$(git -C "$APP_DIR" branch --show-current)" == main ]] || { echo "Existing checkout must be on main." >&2; exit 1; }
  [[ -z "$(git -C "$APP_DIR" status --porcelain)" ]] || { echo "Existing checkout has changes; leaving them untouched." >&2; exit 1; }
  git -C "$APP_DIR" pull --ff-only origin main
else
  git clone --branch main --single-branch "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"
[[ -f stats-service/proxy_config.py && -f stats-service/scripts/probe_nba.py ]] || {
  echo "Push the proxy/deployment changes to main before deploying." >&2; exit 1;
}

if [[ ! -f .env ]]; then
  log "Creating the private production environment (input is not echoed)..."
  DOMAIN=${DOMAIN:-girma.me}
  [[ "$DOMAIN" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ ]] || { echo "DOMAIN must be a hostname, without https:// or a path." >&2; exit 1; }
  if [[ -z ${PROXY_URL:-} ]]; then
    read -rp "Proxy hostname (no http://): " PROXY_HOST
    read -rp "Proxy port: " PROXY_PORT
    read -rsp "US-targeted proxy username: " PROXY_USER; printf '\n'
    read -rsp "Proxy password: " PROXY_PASS; printf '\n'
    export PROXY_HOST PROXY_PORT PROXY_USER PROXY_PASS
    PROXY_URL=$(python3 - <<'PY'
import os
from urllib.parse import quote
host = os.environ['PROXY_HOST'].strip()
if not host or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-' for c in host):
    raise SystemExit('Enter only the proxy hostname, without a scheme or path')
port = int(os.environ['PROXY_PORT'])
if not 1 <= port <= 65535:
    raise SystemExit('Invalid proxy port')
user = quote(os.environ['PROXY_USER'], safe='')
password = quote(os.environ['PROXY_PASS'], safe='')
if not user or not password:
    raise SystemExit('Proxy username and password are required')
print(f'http://{user}:{password}@{host}:{port}')
PY
    )
    unset PROXY_HOST PROXY_PORT PROXY_USER PROXY_PASS
  fi
  if [[ -z ${TURNSTILE_SITE_KEY:-} ]]; then read -rp "Turnstile site key: " TURNSTILE_SITE_KEY; fi
  if [[ -z ${TURNSTILE_SECRET_KEY:-} ]]; then read -rsp "Turnstile secret key: " TURNSTILE_SECRET_KEY; printf '\n'; fi
  export DOMAIN PROXY_URL TURNSTILE_SITE_KEY TURNSTILE_SECRET_KEY
  python3 - <<'PY'
import os, secrets, sys
sys.path.insert(0, 'stats-service')
from proxy_config import configure_proxy
if not configure_proxy():
    raise SystemExit('A proxy URL is required')
for key in ('TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY'):
    if not os.environ[key] or not all(c.isascii() and (c.isalnum() or c in '_-') for c in os.environ[key]):
        raise SystemExit(f'{key} is empty or invalid')
values = {key: os.environ[key] for key in ('DOMAIN', 'PROXY_URL', 'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY')}
values.update(STATS_SERVICE_URL='http://stats:5001', NO_PROXY=os.environ['NO_PROXY'], POSTGRES_PASSWORD=secrets.token_hex(32), ADMIN_TOKEN='')
for value in values.values():
    if any(c in value for c in "'\r\n\\"):
        raise SystemExit('Percent-encode special characters in proxy credentials before using them')
with open('.env', 'x', encoding='utf-8') as file:
    for key, value in values.items():
        file.write(f"{key}='{value}'\n")
PY
  # Compose must read the saved file, not different inherited shell values.
  unset DOMAIN PROXY_URL TURNSTILE_SITE_KEY TURNSTILE_SECRET_KEY
fi
chmod 600 .env
if grep -q 'REPLACE_' .env; then echo "Replace the placeholders in .env first." >&2; exit 1; fi
log "Validating configuration without printing secrets..."
docker compose config --quiet
log "Building and starting the isolated services..."
COMPOSE_PARALLEL_LIMIT=1 docker compose up --build -d --wait --wait-timeout 240
log "Testing residential egress with three NBA API requests (uses proxy bandwidth)..."
if ! docker compose exec -T stats python scripts/probe_nba.py; then
  log "NBA probe failed. The app is running with saved data. Do not enable bulk refreshes yet."
  exit 1
fi
log "Installing the weekly, resource-limited stats refresh timer..."
cat > /etc/systemd/system/hoop-bids-refresh.service <<'UNIT'
[Unit]
Description=Refresh Hoop Bids saved player data
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=/opt/hoop-bids
ExecStart=/usr/bin/docker compose --profile maintenance run --rm --no-deps --name hoop-bids-refresh-job refresh
ExecStopPost=-/usr/bin/docker stop -t 30 hoop-bids-refresh-job
TimeoutStartSec=50min
UNIT
cat > /etc/systemd/system/hoop-bids-refresh.timer <<'UNIT'
[Unit]
Description=Weekly Hoop Bids refresh

[Timer]
OnCalendar=Sun *-*-* 10:00:00 UTC
RandomizedDelaySec=15min
Persistent=true

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now hoop-bids-refresh.timer
docker compose ps
log "Services started. Point the domain A record at this VPS; allow inbound TCP 80/443 and keep SSH access."
log "Caddy will issue HTTPS once DNS resolves here. Check https://girma.me/hoopbids/ before retiring the old host."
log "This creates a new database. Import existing history and set up off-server backups before migration is complete."
if [[ -f /var/run/reboot-required ]]; then log "Ubuntu requests a reboot. Schedule it after checking the deployment."; fi
