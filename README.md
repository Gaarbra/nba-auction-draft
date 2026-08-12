# nba-auction-draft

Multiplayer NBA auction draft web app. Up to 4 players join a room, take turns nominating and bidding on NBA players with a fixed coin budget, and fill out a 5-slot roster (PG/SG/SF/PF/C).

## Stack
- **Frontend**: React (Vite) — `client/`
- **Backend**: Node/Express + Socket.IO — `server/`
- **Stats service**: Python/Flask + `nba_api` — `stats-service/`

## Status
Room creation/joining with live presence (1-4 players, including solo), the host-triggered draft start, and the full nomination/bidding/roster-assignment loop are all working. The entire player pool and every stat come from official NBA data via `nba_api` — no third-party player database involved. Nominated players show real headshots and career per-game stats. Assigning a player to a position that doesn't match their listed position prompts a confirmation; the host can allow free position swaps mid-draft, with a tile-based roster board (headshots, hover tooltips) supporting it. The whole UI is styled as a dark, high-contrast scoreboard, with each player's budget shown as a row of 20 coin icons. Once every roster is full, a results screen ranks all teams by a computed score, with a documented estimate standing in for the handful of stats (USG%, pre-1974 defense) that don't exist anywhere in an official, freely-accessible source.

## Getting started

Requires Python 3.10+ on PATH as `python`, in addition to Node. No API keys needed — everything comes from `nba_api`'s free, unofficial stats.nba.com wrapper.

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

The full draft-eligible player pool (~5,200 players, active and historical) is fetched from `stats-service`'s `/players` route, which wraps `nba_api`'s `commonallplayers` — a single bulk API call, not a per-player scrape. Node caches that to `server/data/players.json` (7-day TTL; it's cheap to refetch, but there's no reason to hit it on every server start). To (re)build the cache:

```bash
npm run sync-players --prefix server
```

This takes a few seconds (one bulk call), not minutes. Each pool entry carries the real NBA.com person id directly (used for headshots and every downstream stats lookup — no name-matching involved anywhere in the pipeline), plus `isActive` and career span (`fromYear`/`toYear`). Players are filterable via:

- `GET /api/players?era=1990s` — filtered by career-start decade (`era=all` returns everyone, `era=active` returns only current NBA rosters — a real "currently active" filter, not a heuristic)
- `GET /api/players/eras` — era buckets with counts
- `GET /api/players/cache-info` — cache freshness/status

### Stats service

`stats-service/` is a small Flask app wrapping `nba_api`, which itself wraps the free, unofficial stats.nba.com JSON endpoints (no API key needed). Setup:

```bash
python -m pip install -r stats-service/requirements.txt
```

`GET /stats?id=<nba person id>` fetches a player's full season-by-season career stats and returns **career per-game averages** (points/rebounds/assists/steals/blocks/FGA/FTA/TOV/minutes across every season played), plus their position, current/last team, and draft year. Seasons where a player was traded mid-year are deduplicated using the "TOT" (total) row nba_api returns, rather than summing the per-team split rows too (which would double-count games). Steals and blocks weren't officially tracked before the 1973-74 season, so career-long players from that era (Wilt Chamberlain, etc.) correctly show `N/A` for those two stats rather than a misleading `0.0`. Team is deliberately sourced from career-stats' own last-season row, not from `commonplayerinfo`'s team field — spot-checking showed the latter can reflect a stale mid-career team for retired players (Wilt comes back as "Warriors" from that field, despite finishing his career with the Lakers). Results are cached in-memory per player for 1 hour. Players with genuinely no recorded NBA games (e.g. two-way players who never debuted) return a "no stats available" response — the draft UI shows "Stats unavailable" for these. (`?name=<full name>` also still works as a fallback lookup, but nothing in the app uses it anymore now that the pool always has the real id.)

This is an unofficial API with no uptime guarantee — if stats.nba.com changes or blocks something, this is the piece that breaks.

### Draft flow

Before starting, the host picks a player pool for the room (a career-start decade, "Active Now", or "All Eras"). Turn order is randomized once at draft start (so the host doesn't automatically go first), then proceeds in that order round-robin. On their turn, a player just clicks "Reveal Random Player" — the server draws a random undrafted player from the room's pool and checks `stats-service` for that player before committing; if that player has no findable stats, it draws again (up to 6 attempts) so the draft is heavily biased toward always landing on someone with real career stats to show. That resolution happens before the pick is broadcast, so the frontend plays a "rolling" animation (cycling real names sampled from the room's pool, minimum ~1.4s) while it's in flight, landing on the confirmed player only once stats are resolved. Starting bid is fixed at 1 coin — no searching or picking which player comes up. Other players can raise the bid (any amount above the current bid, up to their budget) or pass; once everyone but the high bidder has passed, that player picks an open roster slot for their new player. Picking a slot that would leave too little budget for the remaining open slots shows a confirmation warning, but doesn't block the pick — it's on the player to decide. Solo rooms skip bidding entirely: reveal and immediately assign. The draft is marked complete once every player's roster is full (5/5).

### Scoring & results

Once all rosters are full, the server fetches each of the 20 drafted players' full stats (`server/src/scoring/computeResults.js`) and scores every team with the formulas below (`server/src/scoring/scoring.js` — pure, unit-tested functions, run `npm test --prefix server`). This is a one-time computation per draft, not part of the live loop, so it's fine that it can take a little while.

**Offense Score (Op)** per player:
```
TS%  = PTS / (2 * (FGA + 0.44 * FTA))          — 0 if FGA and FTA are both 0
Op   = (PTS * TS%) + (AST * 1.5) - (TOV * 2.0)
```

**Defensive Impact Rating (DIR)** per player:
```
DIR = (STL * 2.5) + (BLK * 2.0)                if STL/BLK were tracked that era
DIR = (Season DWS / Games Played) * 100         if not (pre-1973-74; see below)
```

**Team Synergy Multiplier (Ms)**, from the 5 starters' summed usage rate:
```
Ms = 1.10   if sum(USG%) <= 105
Ms = 1.00   if 105 < sum(USG%) <= 125
Ms = 0.85   if sum(USG%) > 125
```

**Final Team Score** = `sum(Op + DIR across the 5 starters) * Ms`. No bench term — rosters here are exactly 5 players.

Where the stats come from, and the two documented fallback estimates (`server/src/scoring/statsAdapter.js`):

| Stat | Source | Gap |
|---|---|---|
| PTS, REB, AST, FGA, FTA, MIN | `nba_api` career stats | none — covers every era |
| STL, BLK | `nba_api` career stats | not tracked before 1973-74 (`null`, not `0`) |
| TOV | `nba_api` career stats | not tracked before 1977-78 (`null`, not `0`); no estimate exists for this one, so an untracked TOV is scored as 0 — a known, minor bias in favor of very old players' Op |
| USG% | `nba_api` Advanced stats (one extra API call) | stats.nba.com only computes this from 1996-97 on |
| DWS (Defensive Win Shares) | **not available anywhere** — it's a Basketball-Reference metric with no official-NBA equivalent | always missing; getting the real number would mean scraping BR, which we deliberately didn't build (against their ToS, and a fragile target) |

For the two real gaps:
- **USG% before 1996-97** is estimated from shot volume relative to minutes played (`FGA + 0.44*FTA + TOV`, scaled to a per-36-minute rate), calibrated so a ~15-shot-equivalent-per-36 workload reads as a league-average ~20% usage.
- **DWS** (only ever consulted for the pre-1974 DIR branch) is estimated from rebounds per game, calibrated so a strong 15 REB/g season produces a DIR of 5 — comparable in scale to a modern plus-defender's real STL/BLK score.

Both are flagged (`usagePctEstimated`) so the results screen can mark them — look for the `*` next to a DIR value.

The results screen also ranks all teams by Final Team Score and shows a simple win-probability estimate for every pairwise matchup, via a logistic curve on the score delta (tuned so a ~50-point gap reads as roughly a 73/27 split — a documented heuristic, not fitted to real outcome data).

## Project structure

```
server/               Express + Socket.IO backend, in-memory room store, draft state machine, player pool cache
server/src/scoring/   Op/DIR/Ms scoring module (pure, unit-tested) + the stats adapter and end-of-draft orchestrator
client/                React (Vite) frontend
stats-service/         Flask + nba_api microservice — player pool, per-game stats, headshots, everything NBA-data-related
```
