# ServerCheap deployment

The three app services are `web` (Vite build served by Caddy), `server` (Node/Socket.IO), and `stats` (Flask/Gunicorn). PostgreSQL is a fourth persistence container, already required by this deployment's history and stats features. Only Caddy publishes host ports. Named volumes preserve database, caches and certificates across rebuilds.

## Before running

Commit and push the deployment changes first: the installer clones `main` from `https://github.com/Gaarbra/nba-auction-draft.git`. Use a dedicated Ubuntu 22.04, 24.04 or 26.04 VPS. Keep SSH access and allow TCP 80/443 in the provider firewall. Docker-published ports can bypass UFW; do not publish Node, Flask or Postgres ports.

Have your DataImpulse gateway hostname, port, working US-targeted username/password, and Cloudflare Turnstile keys ready. Register `girma.me` as a Turnstile hostname. The installer prompts for the four proxy fields separately and percent-encodes the credentials automatically. For unattended setup, the `PROXY_URL` format is `http://LOGIN:PASSWORD@gw.dataimpulse.com:823`, with credentials percent-encoded. Use the gateway supplied by your dashboard. Do not paste real credentials into chat or Git.

After these files are pushed, copy this block into the VPS terminal:

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl
curl --fail --show-error --silent --location \
  https://raw.githubusercontent.com/Gaarbra/nba-auction-draft/main/deploy-servercheap.sh \
  -o deploy-servercheap.sh
sudo bash deploy-servercheap.sh
```

The script installs native Docker Engine and Compose using Docker's official apt repository, clones or fast-forwards `/opt/hoop-bids`, creates a mode-600 `.env`, generates a database password, builds sequentially, and starts services with health checks. On first run it prompts for credentials; subsequent runs preserve `.env`. For unattended provisioning, securely supply `DOMAIN`, `PROXY_URL`, `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` to the root process through your provisioning system. Never put secrets in a command saved in shell history.

`.env.example` is the full production manifest. Do not overwrite an existing database password: changing the variable does not change a password inside an existing PostgreSQL volume. Turnstile's site key is public and built into Vite; its secret and proxy credentials are never build arguments.

## Verify before switching DNS

The installer performs three live NBA requests (catalogue, career stats and awards), consuming a small amount of paid proxy traffic. Failures return a nonzero exit status, while the app stays running with saved data. A successful probe confirms only current access. Proxies do not guarantee NBA availability. Global Python proxy settings also route other external Requests traffic, such as photo lookups; keep that in mind for bandwidth charges. Localhost and Docker service names bypass the proxy. PostgreSQL connections do not use HTTP proxies.

```bash
cd /opt/hoop-bids
sudo docker compose ps
sudo docker compose exec -T server node -e \
  "fetch('http://stats:5001/health').then(r=>{if(!r.ok)process.exit(1);console.log('Internal stats route OK')}).catch(()=>process.exit(1))"
sudo docker compose exec -T stats python scripts/probe_nba.py
```

Once ready, point `girma.me`'s A record to the VPS and remove conflicting records. Caddy provisions HTTPS when DNS resolves to this host. Verify the portfolio at `/`, Hoop Bids at `/hoopbids/`, human verification, room creation, and a two-browser Socket.IO draft. Keep the old host until those checks pass.

This deployment creates a **new database**. Import the old database separately to retain auction history and arrange off-server backups. Do not run `docker compose down -v`: it deletes persistent volumes. Live rooms are in Node memory, so deployments interrupt ongoing drafts.

## Low-load weekly refresh

The installer enables `hoop-bids-refresh.timer` only after the NBA proxy probe passes. It runs Saturdays at 10:00 UTC (2 a.m. Pacific standard time / 3 a.m. daylight time), with up to 15 minutes of jitter. A missed run is caught up after the VPS boots. The timer runs on the VPS, so your laptop can be off.

Gameplay reads saved stats, awards, usage, and catalogues without live NBA requests. The stats container mounts its cache volume read-only and checks for new snapshots at most once every 30 seconds. Node picks up new catalogues within one hour on the next request. Existing saved data remains available if the proxy fails. An uncached player returns unavailable rather than invented statistics. ML training is not part of this job; the serving similarity index still loads at startup.

The separate refresh container uses the same stats image, a writable shared volume, at most **0.5 CPU and 1 GB RAM**, and one sequential fetch loop. These are initial limits, not measured memory requirements. It refreshes active careers and active awards older than seven days, including missing active-player records. Retired players are never fetched by this job, even if their records are missing. Saved retired careers and awards are retained. Usage data is fetched league-wide for the latest active season only; historical seasons are retained. Biography fields are reused when available. There is a two-second pause between player fetches; a missing biography can require a second API request.

Successful progress is atomically saved every 25 players and at normal shutdown. Runs resume from cache timestamps; no full restart of the dataset is needed. Failed players are retried on the next run, with a 10/20-second backoff between failures and an abort after three consecutive failures. Stats and awards have 20/10-minute budgets, plus up to five minutes for usage data; an in-flight request can extend a budget by its timeout. A file lock prevents concurrent runs. An abrupt kill or out-of-memory exit can lose the current batch, but leaves the previous checkpoint intact.

After deployment, run the first refresh and inspect its result:

```bash
sudo systemctl start hoop-bids-refresh.service
sudo journalctl -u hoop-bids-refresh.service -n 60 --no-pager
sudo systemctl list-timers hoop-bids-refresh.timer
cd /opt/hoop-bids
sudo docker compose exec -T stats cat data/refreshStatus.json
sudo docker stats --no-stream
```

`complete` means all selected work finished; `partial` includes remaining stats/awards counts; `failed` preserves the prior snapshots and records the error type. A partial backlog can be continued with another manual service start. Check DataImpulse bandwidth usage after the first run. This weekly job does not backfill retired players. To pause weekly refreshes: `sudo systemctl disable --now hoop-bids-refresh.timer` (this does not interrupt an already-running job).

Tune `REFRESH_CPUS`, `REFRESH_MEMORY_LIMIT`, and the two runtime budgets in `/opt/hoop-bids/.env` if measurements justify it. Timer runs read them on each execution. Docker enforces the [CPU and memory limits](https://docs.docker.com/reference/compose-file/services/); the [systemd timer](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html) handles scheduling. No Redis or additional paid scheduler is needed.

## Local checks

```bash
cd stats-service
python -m unittest test_proxy_config.py test_refresh.py
cd ..
bash -n deploy-servercheap.sh
docker compose config --quiet
```

The unit tests verify actual Requests proxy selection and internal-host bypass without contacting the internet. `docker compose config --quiet` needs a populated `.env`; avoid plain `docker compose config`, which prints resolved secrets.

To force an additional active-player refresh today without changing the weekly schedule,
first verify the service is idle, then run:

```bash
cd /opt/hoop-bids
sudo docker compose --profile maintenance run --rm --no-deps -e REFRESH_ACTIVE_DAYS=0 refresh
```

The file lock prevents overlap with the scheduled job. Inspect `refreshStatus.json`
afterward; a bounded run can finish partially and requires another run to drain a backlog.
