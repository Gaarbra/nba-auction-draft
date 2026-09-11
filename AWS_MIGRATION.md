# AWS migration + player value estimator

A working log for moving pieces of Hoop Bids onto AWS and adding a
scikit-learn "expected value" model, in five phases. Each phase gets
confirmed working before the next one starts. Code changes are committed
as we go; nothing gets **pushed** to `main` (which auto-deploys on Render)
until you've said so.

---

## Phase 1: Database migration to AWS RDS

### What actually changed in the repo (done)

Both `server/src/services/db.js` and `stats-service/db.py` already read
`DATABASE_URL` from an environment variable with nothing hardcoded, so that
was already migration-safe. The one real gap was TLS: Render's Postgres is
reached over an *internal* connection today (same cloud, same region), so
neither service ever needed to encrypt that connection. RDS will be
reached from Render over the **public internet**, so it should be.

- Added an opt-in `DATABASE_SSL=require` env var, read identically by both
  services. Off by default, so your current Render DB connection is
  completely unaffected; you turn it on only once `DATABASE_URL` points
  at RDS.
- `server/.env.example` and `stats-service/.env.example` now document the
  RDS connection-string shape and the new flag.
- `render.yaml`: both services' `DATABASE_URL` changed from
  `fromDatabase: hoop-bids-db` (Render's own Postgres) to `sync: false`
  (a manually-set value you'll fill in from the Render dashboard, same
  pattern already used for `STATS_SERVICE_URL`/`CLIENT_ORIGIN`), plus a
  new `DATABASE_SSL: sync: false`. The `hoop-bids-db` database itself is
  still declared in `render.yaml`, deliberately left alone. Removing it
  is what would tell Render's blueprint sync to actually tear the
  instance down, and that's a real, hard-to-reverse action that should
  happen only once you've confirmed RDS is working, as its own explicit
  step (delete it from the Render dashboard yourself when you're ready;
  I won't do that as a side effect of an unrelated change).

None of this is pushed yet. It's committed locally so you can review the
diff (`git show`) before it goes anywhere.

### Why RDS reached over the public internet, not a private network

The "correct" enterprise setup would put RDS inside a VPC and reach it
from Render via VPC peering or PrivateLink. Render and AWS are different
clouds, so that's real networking work (a whole topic on its own, and
overkill for a side project). The realistic setup here: RDS with **public
accessibility on**, locked down by password + TLS + as tight a security
group as practical. Worth being able to say in an interview: *"the
security boundary here is credentials and TLS, not network isolation,
because Render doesn't offer static outbound IPs on the free tier to
allowlist, that's the tradeoff I made and why."*

### Steps you do in AWS (I can't provision this for you)

**Console path** (recommended the first time, you see every option):

1. Sign in to the [AWS Console](https://console.aws.amazon.com/rds/) →
   RDS → **Create database**.
2. **Engine type**: PostgreSQL. **Version**: match what you're running
   locally/on Render now if you know it (`psql --version` or check
   Render's Postgres info page); if unsure, pick the latest available
   16.x; nothing in this app uses version-specific Postgres features.
3. **Templates**: **Free tier**. This caps you to `db.t3.micro` (or
   `db.t4g.micro` depending on region), 20GB `gp2` storage, single-AZ,
   all fine for this project. Free tier is 12 months from your AWS
   account's creation, 750 instance-hours/month; after that (or if you
   exceed it) it's billed hourly, so it's worth a calendar reminder.
4. **DB instance identifier**: `hoop-bids-db` (or whatever, this is just
   the AWS-side name, unrelated to the database name inside it).
5. **Master username**: pick something (not `admin`, that's blocked on
   RDS Postgres; `hoop_bids_admin` is fine). **Master password**:
   self-managed, generate a strong one now and save it somewhere real
   (a password manager); you'll paste it into `DATABASE_URL` and
   nowhere else. Do not let it end up in a commit.
6. **Connectivity**:
   - **Public access: Yes** (see the "why" above).
   - **VPC security group**: create a new one, e.g. `hoop-bids-rds-sg`.
     You'll edit its inbound rule after creation (next step); for now
     just let it create.
   - Leave **Availability Zone** and **VPC** as the defaults.
7. **Additional configuration** (expand this section):
   - **Initial database name**: `hoop_bids` (matches what's already in
     `render.yaml` and your local `.env`, keeps the connection string
     drop-in compatible).
   - Leave automated backups on (it's free-tier eligible and you want
     them).
   - Turn **off** Performance Insights and Enhanced Monitoring. Both can
     incur charges outside the free tier and add nothing you need yet.
   - Leave **Deletion protection** ON. It costs nothing and stops a
     misclick from deleting your database; you can turn it off later if
     you actually want to delete the instance.
8. Create it. It'll sit in "Creating" status for a few minutes.
9. Once it's "Available," open it → **Connectivity & security** tab →
   copy the **Endpoint** and **Port** (should be 5432).
10. **Security group inbound rule**: go to that VPC security group (linked
    from the same tab) → Inbound rules → Edit → Add rule → Type
    `PostgreSQL`, Source `0.0.0.0/0` (or Render's IP range if you've
    looked it up; see the "why" section above for why this is the
    realistic option on Render's free tier), Description "Render app
    access, no static IP available on free tier."

Your connection string is now:
```
postgresql://<master-username>:<master-password>@<endpoint>:5432/hoop_bids
```

**CLI equivalent**, for the record (this is what a real team would
actually script/Terraform, and worth knowing exists even if you click
through the console this time):
```bash
aws rds create-db-instance \
  --db-instance-identifier hoop-bids-db \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --engine-version 16.4 \
  --master-username hoop_bids_admin \
  --master-user-password "<generate one, don't hardcode it in shell history>" \
  --allocated-storage 20 \
  --db-name hoop_bids \
  --publicly-accessible \
  --backup-retention-period 7
```
You don't have the AWS CLI installed in this environment (I checked).
On Windows: `winget install Amazon.AWSCLI`, then `aws configure` with
an IAM user's access key (create one under IAM → Users, with
`AmazonRDSFullAccess` for this exercise; a real team would scope that
down a lot further).

### Migrating your existing data

If you have real completed-draft history on Render's Postgres worth
keeping, dump it and restore it into RDS. You'll need `pg_dump`/`psql`
locally. On Windows, `winget install PostgreSQL.PostgreSQL` installs the
client tools (you don't need the server), or use
[pgAdmin](https://www.pgadmin.org/) if you'd rather do this with a GUI.

```bash
# From Render's dashboard → hoop-bids-db → Info tab → "External Database URL"
pg_dump --no-owner --no-privileges --format=custom \
  "postgresql://<render-user>:<render-pass>@<render-host>/hoop_bids" \
  -f hoop_bids_dump.pgcustom

pg_restore --no-owner --no-privileges \
  -d "postgresql://<rds-user>:<rds-pass>@<rds-endpoint>:5432/hoop_bids" \
  hoop_bids_dump.pgcustom
```
`--no-owner --no-privileges` matters: the dump otherwise tries to `GRANT`
things to Render's DB user, which doesn't exist on RDS, and every one of
those statements fails loudly (harmlessly, but noisily) during restore.

If your Render DB is basically empty (a handful of test drafts), skip
this. `initSchema()`/`init_schema()` in both services already run
`db/schema.sql` (`CREATE TABLE IF NOT EXISTS`) automatically on startup
against whatever `DATABASE_URL` points at, so RDS gets the same schema
for free the first time either service boots against it.

### Rolling this out

1. Create the RDS instance (above), confirm you can reach it locally:
   ```bash
   psql "postgresql://<user>:<pass>@<endpoint>:5432/hoop_bids" -c "select 1;"
   ```
2. Update your **local** `server/.env` and `stats-service/.env` with the
   new `DATABASE_URL` and `DATABASE_SSL=require`, restart both, and watch
   for `[db] schema ready` in each service's console output. That's your
   local confirmation this works end to end before touching production.
3. When you're ready for Render to use it: Render dashboard → each
   service (`hoop-bids-server`, `hoop-bids-stats-service`) → Environment
   tab → set `DATABASE_URL` and `DATABASE_SSL` there directly (this works
   whether or not you've pushed the `render.yaml` change yet; dashboard
   values are what actually run; `render.yaml`'s `sync: false` just means
   "don't overwrite whatever's in the dashboard" on the next blueprint
   sync, which is exactly why that change needed to happen first).
4. Redeploy both services (or trigger via a push once you're ready, your
   call), then hit `hoop-bids-server`'s `/health` and check its logs for
   `[db] schema ready` in production, same as local.
5. Only once that's confirmed: delete the old `hoop-bids-db` on Render
   (dashboard, not `render.yaml`) if you're done with it, and remove its
   now-unused block from `render.yaml` yourself when you're ready.

### Rollback

Nothing above deletes or mutates the existing Render Postgres. RDS is
strictly additive until step 5. If anything about the RDS connection
misbehaves in production, reverting is just: set `DATABASE_URL` back to
Render's connection string in each service's Environment tab (or restore
the `fromDatabase` blocks in `render.yaml` and redeploy). Both services
already treat DB writes as best-effort and non-fatal, so worst case
during the cutover window is a skipped persistence write, not downtime.
Draft/nomination/bidding all work with zero database at all, remember.

**Tell me once you've created the RDS instance and confirmed the local
`psql`/schema-ready check above.** That's the natural checkpoint before
we touch the live Render env vars or move to Phase 2.

---

## Phase 2: Raw NBA Stats API responses to S3

### What actually changed in the repo (done)

New `stats-service/s3_archive.py`: one function, `archive_raw_response(category, key, raw)`, that uploads a live nba_api response to S3 as-is, before any of it gets parsed down. Wired into the four live per-player/per-season lookups that actually go out to stats.nba.com:

- `fetch_player_bio` → `raw/bio/<player_id>.json`
- `_fetch_and_cache_stats` → `raw/stats/<player_id>.json` (archived even on the "no career record" path -- a confirmed miss is still worth keeping, so a future run doesn't need to re-ask stats.nba.com to learn the same thing)
- `_fetch_and_cache_awards` → `raw/awards/<player_id>.json`
- `fetch_usage_pct` → `raw/usage/<season>.json` (keyed by season, not player: that one call already returns the whole league's table for the season, so archiving it once per season is the complete, non-redundant copy)

Deliberately **not** wired into the pool-building endpoints (`fetch_notable_player_ids`, `fetch_top_team_player_ids`, `fetch_players_pool`) -- those return derived leaderboards/rosters, not per-player source data, and re-archiving a whole-pool response on every cache refresh wouldn't give Phase 3's model anything a snapshot from an hour earlier didn't already have.

This is a **latest-snapshot archive, not a version history**: each key gets overwritten on every live fetch, same as the existing disk caches. If a real history of "how did this player's line change over time" ever becomes worth keeping, that's a one-line change to a timestamped key (`raw/{category}/{key}/{archivedAt}.json`) -- not changed now because it multiplies storage for no current use.

Same best-effort shape as every other secondary system in this app: unconfigured or failing, `archive_raw_response` logs once and returns, never raises, never blocks or slows down the actual response the product needs. You can deploy this whole phase with **no AWS changes yet** and nothing behaves differently.

Also added: `boto3` to `stats-service/requirements.txt`, and four new optional env vars (`S3_RAW_ARCHIVE_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) to `stats-service/.env.example` and `render.yaml` (`sync: false`, same pattern as `DATABASE_URL`).

None of this is pushed yet, same rule as Phase 1: committed locally so you can review the diff before it goes anywhere.

### Steps you do in AWS (I can't provision this for you)

**1. Create the bucket** -- [S3 Console](https://console.aws.amazon.com/s3/) → **Create bucket**:
- **Bucket name**: something globally unique across *all* AWS accounts, not just yours -- `hoop-bids-raw-nba-data` almost certainly isn't free. A suffix from your account id makes collisions basically impossible: `hoop-bids-raw-nba-data-<last 6 digits of your account id>` (find your account id top-right in the console, click your username).
- **Region**: `us-east-1` (N. Virginia) -- matches the RDS instance from Phase 1; keeps everything in one region, not required but tidier and avoids any cross-region transfer cost.
- **Object Ownership**: leave "ACLs disabled" (the default).
- **Block Public Access**: leave **all four boxes checked** (fully blocked). This data has no reason to ever be public.
- **Bucket Versioning**: your call -- off is fine (this is an overwrite-in-place archive, see above); on costs a little more storage but gives you undo if something ever writes garbage over a key.
- **Default encryption**: leave the default (SSE-S3). No extra setup needed.
- Create it.

**2. Create a scoped IAM user for this bucket** -- don't reuse root account keys or a broad `AmazonS3FullAccess` policy. [IAM Console](https://console.aws.amazon.com/iam/) → **Users** → **Create user**:
- Name: `hoop-bids-s3-archiver`.
- **Do not** grant console access -- this is an API-only credential the app uses, not a person who logs in.
- Skip the "Add to group" / "Attach policies" step for now; you'll attach an inline policy scoped to just this bucket next, not a broad managed policy.
- After creating the user, open it → **Permissions** tab → **Add permissions** → **Create inline policy** → JSON tab, paste:
  ```json
  {
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": ["s3:PutObject"],
        "Resource": "arn:aws:s3:::<your-bucket-name>/raw/*"
      }
    ]
  }
  ```
  Replace `<your-bucket-name>` with the exact bucket name from step 1. This grants write access to objects under `raw/` in that one bucket only -- nothing else in your AWS account, and not even read/list/delete on this bucket (the app never needs to read its own archive back).
- Name the policy `hoop-bids-s3-archive-write`, create it.
- Open the user → **Security credentials** tab → **Access keys** → **Create access key** → choose **"Application running outside AWS"** → create it. **Copy the Secret access key now** -- AWS shows it exactly once and there's no way to retrieve it again later (you'd have to create a new key pair).

**3. You now have everything for the env vars**:
```
S3_RAW_ARCHIVE_BUCKET=<your-bucket-name>
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=<from step 2>
AWS_SECRET_ACCESS_KEY=<from step 2, the one shown only once>
```

### Rolling this out

1. Create the bucket and IAM user (above).
2. Add the four values to your **local** `stats-service/.env`, restart the stats service, and watch its console: the "S3_RAW_ARCHIVE_BUCKET not set" line should be gone, and no `[s3 archive] failed to init...` line should appear. Trigger any real player lookup (open a draft, view a player) and check the bucket in the S3 console for a new `raw/stats/<some-id>.json` object -- that's your local confirmation before touching production.
3. When ready: Render dashboard → `hoop-bids-stats-service` → Environment tab → set the same four values there. Redeploy, then repeat the same "look for a new object in the bucket" check against production.
4. That's it -- there's no schema, no migration, nothing else that needs to happen. Archiving is additive and asynchronous to nothing else in the app; every existing feature works identically whether these env vars are set or not.

### Rollback

Unset (or never set) the four env vars, or delete the IAM access key -- either one makes `archive_raw_response` a no-op again (logged, not an error) with zero code changes. Nothing in the rest of the app reads from this bucket, so there's no dependency to unwind. The bucket itself and anything already archived in it are untouched by any of this; delete the bucket yourself in the S3 console whenever you actually want that data gone (a real, hard-to-reverse action -- not something to do as a side effect of turning archiving off).

**Tell me once the bucket and IAM user exist and you've confirmed the local "new object appears in the bucket" check above.** That's the natural checkpoint before touching the live Render env vars or starting Phase 3.

---

## Phase 3: scikit-learn value model
*(not started)*

## Phase 4: `/players/<id>/value-estimate` endpoint
*(not started)*

## Phase 5: Frontend display during live bidding
*(not started)*
