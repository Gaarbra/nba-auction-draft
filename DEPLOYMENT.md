# Affordable deployment and AWS migration

Recommendation: one small Linux VM with Docker Compose, Caddy HTTPS, Node,
Python and Postgres. Start with 2 CPU / 4 GB RAM and measure memory during stats
warmups; this is a starting estimate, not a load-tested capacity promise. There
is no Kubernetes, paid load balancer, RDS or S3 requirement. Only Caddy exposes
ports; the database and stats API stay on Docker's private network.

## Cost choices (checked September 30, 2026)

| Choice | Recurring cost | Tradeoff |
|---|---|---|
| Oracle Always Free eligible VM | $0 within its quotas, plus domain | Capacity may be unavailable; idle VMs can be reclaimed. Keep off-host backups. |
| Hetzner CX23, Germany/Finland | Listed $6.49/month before IPv4, tax and backups | Practical low-cost paid option if that region's latency works for your players. Allow roughly $8-12/month total before the domain; confirm checkout. |
| Existing Render free services | $0 within the free allowance, plus domain | 750 instance-hours shared per workspace; two services compete for them. Services sleep after 15 idle minutes, and restarts lose in-memory rooms. Good for demos, not dependable live drafts. |

Sources: [Oracle Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm),
[Hetzner current price adjustment](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/),
[Render free limits](https://render.com/docs/free).
Prices and free tiers can change; nobody can promise a free plan forever.
Student credits can help temporarily, but should not be the long-term budget.

Buy the domain based on **renewal price**, not the introductory discount.
[Cloudflare Registrar](https://www.cloudflare.com/domains/) charges registry/ICANN
cost without markup for supported extensions. Compare the actual domain before
paying. DNS, TLS through Caddy and [Turnstile's free plan](https://developers.cloudflare.com/turnstile/plans/)
need no separate subscription. Domain registration remains a yearly expense.

## Deploy

Commands below run on the Linux VM from this repository's root. Install Docker
Engine and its Compose plugin from [Docker's official instructions](https://docs.docker.com/engine/install/ubuntu/).

1. Create a Turnstile widget for the exact domain. Copy `.env.example` to `.env`.
   Fill in `DOMAIN` (hostname only, no scheme), the site key and secret key, and a
   random hex `POSTGRES_PASSWORD` generated with `openssl rand -hex 32`.
   Keep `.env` private (`chmod 600 .env`). Leave `ADMIN_TOKEN` blank unless you
   need manual player sync; blank means that endpoint is disabled.
2. Point the domain's A record at the VM's IPv4 address (and AAAA only if IPv6
   works). For the simplest setup use DNS-only initially. Allow 80/443 publicly
   and SSH only from your administration address in the provider firewall.
   Do not expose 4000, 5001 or 5432. Caddy obtains and renews HTTPS certificates.
3. Run:

   ```sh
   docker compose config --quiet
   docker compose build
   docker compose up -d
   docker compose ps
   docker compose logs --tail=50 server stats web
   ```

4. Visit the domain, finish verification yourself, create/join a room from two
   browsers, place bids, reload to test reconnect, and finish a public draft.
   Check market bidder counts, a private room, and 320/390/768/1280px layouts.
   Test invalid verification and API rate limits in staging, not against players.

Use **one Node replica**. Rooms, reconnect tokens and rate limits live in memory;
deploys/restarts end active rooms. Schedule maintenance between drafts. Named
volumes retain completed-draft history and player caches. Do not run
`docker compose down -v`: it deletes those volumes.

The images seed new cache volumes from the repository's existing JSON caches.
Existing volumes deliberately survive image rebuilds. The shipped model is
retained; avoid training or full stats refreshes during busy game sessions.

## Move existing AWS data without losing it

The repo describes RDS/S3 integration but does not prove which paid resources
are active. Inventory the AWS billing dashboard, RDS version/database size and
S3 objects before any shutdown. Confirm compatibility with the target Postgres
17; use a matching or newer target if the source is newer.

1. Back up RDS using `pg_dump --format=custom --no-owner --no-acl` with a secure
   connection/service file. Avoid putting passwords in shell history. Keep a
   second copy off the new VM. Export any S3 archives you want to retain.
2. Build the images, then start only `docker compose up -d db`. Restore into the
   **empty** target before starting the apps:

   ```sh
   docker compose exec -T db pg_restore -U hoop -d hoop_bids --no-owner --no-acl --exit-on-error < backup.dump
   ```

3. Compare row counts in `drafts`, `draft_teams`, `draft_picks`, `players` and
   `player_stats`, and inspect recent completed drafts. Run the application
   smoke checks above against a temporary hostname allowed in Turnstile.
4. At cutover, wait for active rooms to finish and stop new writes on the old
   service. Take a final dump and restore it into a fresh target database, then
   change DNS and start the new apps. In-memory live rooms cannot migrate.
5. Keep the old environment and final dump available briefly for rollback. If
   rolling back after new drafts were saved, preserve/export those new records
   first. Do not blindly point DNS back and discard them.
6. Only after acceptance, remove unused AWS resources yourself or explicitly
   authorize removal. RDS snapshots, volumes, IPs and S3 can continue billing
   even after a compute instance stops. Remove unused AWS credentials from the
   new host; this Compose stack does not need them.

## Backups and upkeep

Daily database backup (Linux shell; choose a private directory outside Git):

```sh
umask 077
mkdir -p backups
docker compose exec -T db pg_dump -U hoop -d hoop_bids -Fc > "backups/hoop-$(date +%F).dump"
```

Copy backups to another device/provider, retain several dated copies, and test
restoring into a disposable database monthly. Back up the stats/server cache
volumes too if you need to preserve fresh NBA fetches. Check disk usage and
patch the VM/images regularly. Before updating, take a backup and record the
current Git commit/image IDs so rollback is concrete.

## Bot protection and honest statistics

- Production sockets require server-validated Turnstile tokens for the correct
  hostname/action. Missing secrets deny play, rather than silently bypassing
  checks. Set the client site key **before building**. In local development only,
  leaving keys unset permits ordinary testing.
- HTTP requests, socket connections, socket events and room creation are
  rate-limited. Limits are shared by source IP, so campus networks can share a
  bucket. Adjust only after observing real traffic; IP limits are not identity.
- `TRUST_PROXY=1` assumes exactly one trusted proxy and no direct public Node
  port. Caddy strips untrusted incoming forwarding claims by default. Adding a
  CDN requires configuring trusted CDN IP ranges at Caddy and reviewing IP
  extraction; do not blindly trust arbitrary `X-Forwarded-For` headers.
- Reconnection requires a private token; public player IDs alone cannot reclaim
  another player's seat. Existing sessions from before this patch must rejoin.
- The market feed reports distinct **player seats per auction**, including the
  automatic opening bid. It is not a count of unique real people. It shows only
  the latest 60 public online sales received while that market tab was open.
  Private invite codes, solo drafts and pass-and-play prices are excluded.
- The line graph remains suggested model values collected this session when
  difficulty/context changes. It is not historical market demand. Bid totals
  appear separately for completed auctions.
- New model training excludes local and solo drafts. The existing model is
  not automatically retrained; retrain only after reviewing the source data.
- Turnstile is abuse resistance, not proof of unique humanity. Humans can run
  multiple sessions or coordinate to manipulate prices. Without accounts or
  identity verification, this app cannot promise one human per player. Review
  suspicious drafts before using their data to retrain the model.

For stronger edge DDoS protection, Cloudflare's proxy is an option, but first
configure trusted proxy ranges correctly and restrict origin access. Do not
buy a paid bot product before observing a need.

## Validation status

Node tests and the client production build are runnable locally. Docker is not
installed in the development environment used for this patch, so image builds,
Compose startup, HTTPS issuance and an actual RDS restore still need the target
host check above. Live Turnstile verification also needs your domain and keys.
No cloud resources, DNS records or paid subscriptions were changed.
