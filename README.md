# Hoop Bids

A multiplayer NBA auction draft web app. Up to 4 players join a room, take turns nominating and bidding on real NBA players with a fixed coin budget, and build out a 5-slot roster (PG/SG/SF/PF/C).

## Stack
- **Frontend**: React (Vite), lives in `client/`
- **Backend**: Node/Express + Socket.IO, lives in `server/`
- **Stats service**: Python/Flask + `nba_api`, lives in `stats-service/`

## Status
Room creation and joining works, with live presence for 1 to 4 players (solo included), a host-triggered draft start, and the full nominate/bid/assign-to-roster loop. Every player and every stat comes from official NBA data through `nba_api`, so there's no third-party player database anywhere in the pipeline. Nominated players show real headshots and real career per-game stats. If you try to assign a player to a position that doesn't match how they're actually listed, the app asks you to confirm first. The host can also turn on free position swaps mid-draft, which is backed by a tile-based roster board with headshots, team-colored tiles, and hover tooltips. The whole thing is styled like a dark, high-contrast scoreboard, and each player's remaining budget shows up as a row of 20 coin icons. If someone's connection drops, they get a 60-second grace window to reconnect before the draft moves on without them (more on that under "Reconnecting" below). Once every roster is full, a results screen ranks all the teams using a real scoring formula, with a documented estimate filling in for the handful of stats (USG%, pre-1974 defensive numbers) that just don't exist in any official, freely available source.

## Getting started

You'll need Python 3.10+ on your PATH as `python`, plus Node. No API keys required. Everything here comes from `nba_api`, which is a free, unofficial wrapper around stats.nba.com.

Install dependencies for all three apps:

```bash
npm run install:all
```

Copy the env examples:

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

Run all three services together:

```bash
npm run dev
```

- Backend: http://localhost:4000
- Frontend: http://localhost:5173
- Stats service: http://localhost:5001

### Player data

The full draft-eligible player pool (around 5,200 players, active and historical) comes from `stats-service`'s `/players` route, which wraps `nba_api`'s `commonallplayers` call. That's one bulk API call, not a scrape of 5,200 individual player pages. Node caches the result to `server/data/players.json` for 7 days. It's cheap to refetch, there's just no reason to hit it on every server restart. To rebuild the cache yourself:

```bash
npm run sync-players --prefix server
```

This takes a few seconds, since it's one bulk call, not thousands of little ones. Each entry in the pool carries the real NBA.com person ID directly, which is what powers headshots and every stats lookup downstream. There's no name-matching happening anywhere in this pipeline, which matters because name-matching is exactly the kind of thing that quietly breaks on players who share a name or have punctuation in theirs. Each entry also carries `isActive` and career span (`fromYear`/`toYear`). You can filter the pool a few ways:

- `GET /api/players?era=1990s`, filtered by career-start decade. `era=all` returns everyone, and `era=active` returns only current NBA rosters (a real "currently active" check, not a guess based on recent stats)
- `GET /api/players/eras`, era buckets with counts
- `GET /api/players/cache-info`, cache freshness and status

### Stats service

`stats-service/` is a small Flask app that wraps `nba_api`, which itself wraps the free, unofficial stats.nba.com JSON endpoints. No API key needed. To set it up:

```bash
python -m pip install -r stats-service/requirements.txt
```

`GET /stats?id=<nba person id>` fetches a player's full season-by-season career and returns **career per-game averages** (points, rebounds, assists, steals, blocks, FGA, FTA, TOV, and minutes, averaged across every season played), along with their position, current or last team, and draft year. When a player got traded mid-season, `nba_api` gives you both the per-team split rows and a "TOT" (total) row for that season. This app uses the TOT row and skips the splits, because summing the splits too would double-count games played. Steals and blocks weren't officially tracked before the 1973-74 season, so a career-long player from back then (Wilt Chamberlain, for example) correctly shows `N/A` for those two stats instead of a misleading `0.0` that would make it look like they genuinely recorded zero. Team is deliberately pulled from the last row of a player's career stats, not from the `commonplayerinfo` endpoint's team field. Spot-checking showed that field can point at a stale mid-career team for retired players. Wilt Chamberlain comes back as a Warrior from that field, even though he finished his career with the Lakers. Results are cached in memory per player for 1 hour. A player with genuinely no recorded NBA games (a two-way player who never actually debuted, say) gets a "no stats available" response, and the draft UI shows "Stats unavailable" for them. (`?name=<full name>` still works too as a fallback lookup, but nothing in the app actually uses it anymore now that the player pool always carries the real ID.)

This is an unofficial API with no uptime guarantee. If stats.nba.com ever changes or blocks something, this is the piece of the app that breaks first.

### Reconnecting

Each player gets a stable identity (a server-issued ID, saved to the browser's `localStorage`) that's separate from the underlying socket connection. So if your connection drops, whether that's a wifi blip, your phone locking, or an accidental tab close, reopening the app rejoins your seat, your budget, and your roster exactly as you left them. If a player is gone for more than 60 seconds mid-draft, the room stops waiting on them. Whatever slots they'd already filled get locked in for end-of-draft scoring, they get skipped for future turns, and the draft keeps going for everyone else. The results screen flags a player who left this way, so their score doesn't get mistaken for a full 5-player roster they never actually finished.

### Security

This was built for casual play with friends over a shared room code, not for public discovery, so there's no account system. The baseline hardening for running it on the open internet includes per-connection and per-IP rate limiting on room creation and every draft action, server-side name and input validation that doesn't just trust the client, generic error responses in production that don't leak internals, standard security response headers, and an optional admin-token gate on the one endpoint that can force a full player-data resync.

### Draft flow

Before starting, the host picks a player pool for the room: a career-start decade, "Active Now," or "All Eras." Turn order gets randomized once at draft start, so the host doesn't automatically go first, and then play proceeds round-robin from there. On your turn, you just click "Reveal Random Player." The server draws a random undrafted player from the room's pool and checks with `stats-service` for that player before actually committing to them. If that player has no findable stats, it draws again, up to 6 times, which biases the draft pretty heavily toward always landing on someone with real career stats to show. That whole check happens before the pick gets broadcast to the room, so the frontend plays a short "rolling" animation (cycling through real names sampled from the room's pool, for at least about 1.4 seconds) while it's in flight, and only lands on the confirmed player once their stats are resolved. The starting bid is fixed at 1 coin. There's no searching for or hand-picking which player comes up. Other players can raise the bid (any amount above the current bid, up to their own budget) or pass, and once everyone but the high bidder has passed, that player picks an open roster slot for their new player. If picking a slot would leave too little budget for the remaining open slots, the app shows a warning, but it doesn't block the pick. That decision is left up to the player. Solo rooms skip bidding entirely: reveal, then assign right away, at a flat 1-coin price every time, since there's no one else to bid it up. Since that removes any real decision from a solo pick, a solo draft gets one reroll for the whole draft (not per pick) to spend on whichever nomination you'd rather not keep. Solo picks are also excluded from the data the price-prediction model behind the Market tab's "Suggested value" trains on (`stats-service/scripts/train_price_model.py`), since a price nobody actually had to compete for isn't a real market signal. A draft is marked complete once every player's roster is full, 5 out of 5.

### Scoring & results

Once every roster is full, the server fetches full stats for all 20 drafted players (`server/src/scoring/computeResults.js`) and scores every team using the formulas below (`server/src/scoring/scoring.js`, pure and unit-tested functions you can run yourself with `npm test --prefix server`). This only happens once per draft, not as part of the live game loop, so it's fine if it takes a moment.

**Offense Score (Op)** per player:
```
TS%  = PTS / (2 * (FGA + 0.44 * FTA))          (0 if FGA and FTA are both 0)
Op   = (PTS * TS%) + (AST * 1.5) - (TOV * 2.0)
```

**Defensive Impact Rating (DIR)** per player:
```
DIR = (STL * 2.5) + (BLK * 2.0)                if STL/BLK were tracked that era
DIR = (Season DWS / Games Played) * 100         if not (pre-1973-74, see below)
```

**Team Synergy Multiplier (Ms)**, based on the 5 starters' combined usage rate:
```
Ms = 1.10   if sum(USG%) <= 105
Ms = 1.00   if 105 < sum(USG%) <= 125
Ms = 0.85   if sum(USG%) > 125
```

**Final Team Score** = `sum(Op + DIR across the 5 starters) * Ms`. There's no bench term here, since rosters are always exactly 5 players.

Here's where the stats actually come from, and the two documented fallback estimates that fill in for what's genuinely missing (`server/src/scoring/statsAdapter.js`):

| Stat | Source | Gap |
|---|---|---|
| PTS, REB, AST, FGA, FTA, MIN | `nba_api` career stats | none, covers every era |
| STL, BLK | `nba_api` career stats | not tracked before 1973-74 (`null`, not `0`) |
| TOV | `nba_api` career stats | not tracked before 1977-78 (`null`, not `0`). There's no good estimate for this one, so an untracked TOV just scores as 0, which is a small, known bias in favor of very old players' Op scores |
| USG% | `nba_api` Advanced stats (one extra API call) | stats.nba.com only started computing this in 1996-97 |
| DWS (Defensive Win Shares) | **not available anywhere official** | it's a Basketball-Reference metric with no NBA.com equivalent. Getting the real number would mean scraping Basketball-Reference, which we deliberately didn't do (it's against their terms of service, and a fragile thing to depend on anyway) |

For the two real gaps:
- **USG% before 1996-97** gets estimated from shot volume relative to minutes played (`FGA + 0.44*FTA + TOV`, scaled to a per-36-minute rate). It's calibrated so that a workload of about 15 shot-equivalents per 36 minutes comes out to a league-average usage rate of around 20%.
- **DWS** (only ever needed for the pre-1974 DIR branch) gets estimated from rebounds per game, calibrated so a strong 15-rebound-per-game season produces a DIR of about 5, which is in the same ballpark as a modern plus-defender's real STL/BLK-based score.

Both estimates get flagged (`usagePctEstimated`), so the results screen can mark them. Look for the `*` next to a DIR value.

The results screen also ranks all the teams by Final Team Score and shows a simple win-probability estimate for every matchup between two teams. That's a logistic curve applied to the score gap between them, tuned so that a gap of about 50 points reads as roughly a 73/27 split. It's a documented heuristic we picked by hand, not something fitted to real outcome data.

## Deploying (Render)

`render.yaml` at the repo root is a Render Blueprint that deploys all three pieces, the static frontend, the Node backend, and the Python stats service, as separate free-tier services from this one repo.

1. Push this repo to GitHub, if it isn't already there.
2. In the Render dashboard: **New > Blueprint**, then connect the repo. Render reads `render.yaml` and proposes the three services (`hoop-bids-client`, `hoop-bids-server`, `hoop-bids-stats-service`).
3. Apply the blueprint. The first deploy will fail to fully connect the services to each other. That's expected, see the next step.
4. Once all three have deployed at least once, each one has a real URL under its own **Settings** tab (something like `https://hoop-bids-client.onrender.com`). Go to each service's **Environment** tab and fill in the placeholder vars that `render.yaml` left blank:
   - `hoop-bids-server`: `STATS_SERVICE_URL` set to the stats service's URL, `CLIENT_ORIGIN` set to the client's URL
   - `hoop-bids-client`: `VITE_SERVER_URL` set to the server's URL (this one gets baked in at build time, so saving it triggers a full rebuild, not just a restart)
5. Give friends the client's URL. That's the one people actually open.

Free-tier services spin down after 15 minutes idle and take roughly 30-50 seconds to wake back up on the next request, so expect a slow first load if nobody's used the room in a while. There's no persistent disk needed either way, since the player-pool cache and every room live in memory and rebuild themselves, so the free tier's lack of storage isn't actually a problem here.

## Project structure

```
server/               Express + Socket.IO backend, in-memory room store, draft state machine, player pool cache
server/src/scoring/   Op/DIR/Ms scoring module (pure, unit-tested) plus the stats adapter and end-of-draft orchestrator
client/                React (Vite) frontend
stats-service/         Flask + nba_api microservice. Player pool, per-game stats, headshots, everything NBA-data-related
```
