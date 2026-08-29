# Hoop Bids — Handoff Notes (2026-08-27)

Continuation notes so a fresh conversation can pick up without re-deriving context.
Repo root: `C:\Users\gabri\Documents\Code\hoop-bids\nba-auction-draft`

## 0. Votekick — DONE & VERIFIED (added after the rest of this doc was first written)

Host can start a vote to remove another player, both in the lobby and mid-draft.
Starting one isn't a unilateral kick — it opens a vote that a **strict majority**
of everyone else still in the room (target excluded) must approve; only the
host can initiate. Disabled entirely for local pass-and-play rooms (kicking
your own local identity doesn't mean anything).

- Server: [server/src/rooms/roomStore.js](server/src/rooms/roomStore.js) —
  `startVoteKick`, `castVoteKick`, `cancelVoteKickByHost`, `recheckVoteKickAfterExit`,
  `clearVoteKickIfComplete`. Vote state is `room.voteKick = { targetId, initiatedBy,
  votes: Map<playerId, boolean>, startedAt, timer }`. Threshold is
  `Math.floor(eligible/2) + 1` (strict majority — resolves instantly when the
  host is the only other eligible voter, e.g. a 2-player room). Auto-cancels if
  enough people vote no that passing becomes mathematically impossible, or after
  `VOTE_KICK_TIMEOUT_MS` (30s) with no resolution. Reuses the existing
  `finalizePlayerExit` (same path as a normal leave/disconnect) so lobby-removal
  vs. mid-draft-forfeit-in-place behavior is identical to what already existed.
- Socket events: `room:vote-kick-start` ({targetId}), `room:vote-kick-cast`
  ({confirmed}), `room:vote-kick-cancel` (host only). The kicked player's own
  socket gets a dedicated `room:kicked` event (a plain `room:update` broadcast
  isn't enough — they'd just silently vanish from the list with no explanation).
- Client: [client/src/components/VoteKick.jsx](client/src/components/VoteKick.jsx)
  exports `KickButton` (small per-player-row trigger, host-only, wired into
  [RoomView.jsx](client/src/components/RoomView.jsx)'s player list and
  [RosterGrid.jsx](client/src/components/RosterGrid.jsx)'s roster-card header)
  and `VoteKickBanner` (the live tally + approve/reject/cancel UI, wired into
  both RoomView and [DraftBoard.jsx](client/src/components/DraftBoard.jsx)).
  [App.jsx](client/src/App.jsx) listens for `room:kicked` and bounces the kicked
  player back to the lobby with a message.

**A real bug was caught and fixed during verification**: the target's `socketId`
was originally looked up *after* `finalizePlayerExit` ran, which in the lobby
case already removes them from `room.players` — so the targeted "you were
kicked" notification silently found nobody and never fired. Fixed by capturing
`targetSocketId` in `tallyVoteKick` *before* calling `finalizePlayerExit`, and
threading it back through `startVoteKick`/`castVoteKick`'s return value instead
of re-deriving it downstream. Also caught and fixed a threshold math bug during
implementation: `Math.ceil(n/2)` gives exactly half for even `n` (so 1 of 2
voters could "pass" a vote only half the room backed) — corrected to
`Math.floor(n/2) + 1` for a true strict majority.

**Verified** via direct `socket.io-client` scripts against an isolated server
instance (not the browser UI, which proved too flaky for fast multi-tab testing
in this session): non-host start correctly rejected, target can't vote on their
own kick, majority-approve executes the kick and fires `room:kicked`, 2-player
rooms resolve instantly (host is the only voter), host-cancel works and
non-initiator-cancel is rejected, majority-reject auto-cancels the vote, and a
mid-draft kick correctly forfeits the player in place (kept in `room.players`
for end-of-draft scoring, removed from `draft.turnOrder`) exactly like an
existing leave/disconnect does. Also did a lightweight browser sanity pass
(local pass-and-play room) confirming zero console errors and that the Kick
UI is correctly absent for local rooms.

**Not yet done**: no dedicated automated test file for this (the project doesn't
have client-side tests at all yet; server has `scoring.test.js` for the scoring
engine only) — the verification above was manual/scripted, not committed as a
repeatable test suite.

## 1. Repeated-players bug — FIXED & VERIFIED

**Report:** "i keep on getting the same players for 2020 easy"

**Root cause:** The "notable" player pool (used for difficulty odds) is built from
*all-time* per-game statistical leaders (`stats-service/app.py`,
`fetch_notable_player_ids()`, top 500 per category). A narrow/recent era like the
2020s only intersects that all-time pool at **10 players** (out of 698 in the era),
since young players haven't had time to rack up career numbers good enough to
crack an all-time top 500. Easy difficulty draws from the notable pool 92% of the
time, so it was cycling through the same ~10 names.

**Fix applied** in [server/src/sockets/roomHandlers.js](server/src/sockets/roomHandlers.js)
(in the `draft:nominate` handler): scale the difficulty odds down toward 0 as the
notable pool for the current era shrinks below a 30-player "real variety" floor:

```js
const MIN_NOTABLE_POOL_FOR_FULL_ODDS = 30;
const poolSizeScale = Math.min(1, notablePool.length / MIN_NOTABLE_POOL_FOR_FULL_ODDS);
const staticOdds = (DIFFICULTY_STATIC_ODDS[room.difficulty] ?? DIFFICULTY_STATIC_ODDS.normal) * poolSizeScale;
const drawPool = notablePool.length > 0 && Math.random() < staticOdds ? notablePool : available;
```

**Verified live** with a 2000-trial simulation against the real cached player pool
+ live `/notable-players` response:

| era | notable pool size | effective odds | unique players in 2000 draws |
|---|---|---|---|
| 2020s | 10 | 30.7% (was 92%) | 597 |
| 2000s | 205 | 92.0% (unchanged) | 299 |
| all | 1161 | 92.0% (unchanged) | 1061 |

Narrow eras now get real variety; wide eras are unaffected (no regression).
`node --check` passed on the edited file before verifying.

## 2. Stats visibility — DONE

Added a bklit.com-style "big number" stat row so career per-game stats are
readable at a glance instead of only appearing as 9px text inside the SVG radar
chart (which was the only place PPG/RPG/etc. were visible before — the "Career
avg" line only showed season count/years, not the actual numbers).

- New component: [client/src/components/StatHighlightRow.jsx](client/src/components/StatHighlightRow.jsx)
  — PPG/RPG/APG/SPG/BPG as large tabular-nums numbers with small uppercase labels,
  count-up animated from 0 on mount (plain `requestAnimationFrame`, not Motion —
  it never unmounts mid-animation so there's no exit-timing risk). Respects
  `prefers-reduced-motion` (skips straight to the final value).
- Wired into [client/src/components/DraftBoard.jsx](client/src/components/DraftBoard.jsx),
  directly under the "Career avg, N seasons" line in the nominated-player card.
- New CSS in [client/src/index.css](client/src/index.css): `.stat-highlight-row`,
  `.stat-highlight`, `.stat-highlight-value` (26px display font), `.stat-highlight-label`.

**Verified**: confirmed via a live local-play draft that the values rendered match
the underlying `stats` object exactly (pointsPerGame 6.5, reboundsPerGame 1.2, etc.
— read directly off the React fiber props, bypassing the animation). The "0.0"
shown in the automation pane's accessibility snapshot is the browser-automation
harness's known non-compositing limitation (rAF never pumps when the pane isn't
displayed) — already documented from earlier in this session for Motion/CSS
transitions — not a real bug; a real foregrounded browser tab runs rAF normally.

**Not yet done** (ideas for later, not started):
- Per-stat bar/sparkline showing rank vs. league average or era.
- Surfacing stats during the bidding phase itself, not just on reveal (already
  visible throughout since the card stays mounted, but could be made more
  prominent during bidding specifically).
- Compact stat-comparison view across a team's whole roster (ties into RosterGrid.jsx).

## 3. Modern look pass — DONE (first round)

Grounded in real inspection of [kokonutui.com](https://kokonutui.com/) (previously
unexplored) via computed-style extraction: near-black backgrounds, very
low-opacity white fills (~2%) and borders (~6-8%) instead of heavy borders/shadows,
12-16px card radii, 8px button radii, no heavy box-shadows on cards.

Applied to [client/src/index.css](client/src/index.css):
- **Glass-panel treatment** on major containers (`.lobby-card`/`.room-card`,
  `.draft-board`, `.active-nomination`, `.local-switcher`, `.roster-card`,
  `.results-team-card`): subtle white gradient overlay + `backdrop-filter: blur()`
  + translucent `rgba(255,255,255,0.07-0.08)` borders, replacing flat solid
  `var(--bg-panel)` + `var(--line)` borders.
- **Larger, more consistent border-radius** across the board: 18px on the two
  main shells (lobby/room card, draft board), 14px on nested panels (nomination,
  roster cards, results cards, rematch panel, local switcher), 8-10px on buttons,
  inputs, badges, and roster slots (was a flat 4-6px everywhere).
- Kept the existing accent-orange top border on main shells, just thinned from
  3px to 2px to read as an accent line rather than a heavy bar.

**Verified**: computed styles confirmed live (`.draft-board` → `border-radius:
18px`, `backdrop-filter: blur(20px)`; `.active-nomination` → `border-radius: 14px`,
translucent border; buttons → `border-radius: 9px`).

**Not yet done** (ideas for later, not started):
- Typography/spacing refresh beyond what's here — hasn't been touched this round.
- Background treatments (gradient mesh, noise) beyond the existing radial glow.
- Dark/light mode — app is dark-only today (`color-scheme: dark` hardcoded);
  no light mode exists to check consistency against.
- Mobile responsiveness pass specifically for the new glass panels (blur can be
  expensive on low-end mobile GPUs — worth a perf check if this becomes an issue).

## 4. Architecture quick-reference (for a fresh session)

- **Stack:** React 18 + Vite (`client/`), Node/Express/Socket.IO (`server/`), Python/Flask + nba_api (`stats-service/`), PostgreSQL 17 (optional, via `DATABASE_URL`).
- **Difficulty system:** single random draw per nomination; odds of narrowing to the "notable" pool (all-time per-game leaders) vs. full era pool, now scaled by how big that era's notable intersection actually is (see section 1). `DIFFICULTY_STATIC_ODDS` in [server/src/rooms/roomStore.js](server/src/rooms/roomStore.js): `{ easy: 0.92, normal: 0.55, hard: 0 }`.
- **Caching:** `server/data/players.json` (full pool, 7-day TTL), `server/data/notablePlayers.json` (notable IDs), `stats-service/data/statsCache.json` (career stats, 24h TTL), `stats-service/data/usageCache.json` (USG%). Background warm-up job in `stats-service/app.py` (`warm_notable_pool()`), status at `/warmup-status`.
- **Postgres:** `db/schema.sql` (6 tables: players, player_stats, player_team_stints, drafts, draft_teams, draft_picks). Two independent writers: `stats-service/db.py` (reference data) and `server/src/services/db.js` (draft history). Both no-op if `DATABASE_URL` unset.
- **Motion (motion.dev):** used for entrance springs, staggered results, button hover/tap feedback. **Known gotcha:** never pair `AnimatePresence mode="wait"` with an `exit` animation on load-bearing UI — an exit animation that never resolves can permanently freeze the panel. The nomination panel in DraftBoard.jsx intentionally uses only a keyed `motion.div` remount, no `AnimatePresence`/`exit`.
- **Browser-automation harness limitation** (hit again this session, second confirmation): the in-app Browser pane can't composite/paint frames when not actively displayed — `requestAnimationFrame` callbacks never fire, so any rAF-driven animation (the new `StatHighlightRow` count-up included) reads as stuck at its initial value in this harness specifically. Not a real bug; verify data correctness via computed styles / React fiber props / network responses instead of trusting animated on-screen values in this environment.
- **Local dev / ngrok:** server on port 4000, client on 5173, stats-service on 5001. Free ngrok rotates subdomains on every restart — `server/.env` (`CLIENT_ORIGIN`) and `client/.env.local` (`VITE_SERVER_URL`) need resyncing to the new ngrok URLs each time tunnels are relaunched. The pair in those files as of this session is already stale/mismatched (confirmed via a CORS error during this session's verification) — expect to need a fresh `ngrok http` pair next time the site needs to go live externally.
- **Verifying UI changes locally without touching the ngrok-wired `.env` files:** run an isolated pair on spare ports instead of editing the real env files, e.g.:
  ```bash
  # terminal 1 (from server/)
  PORT=4001 CLIENT_ORIGIN=http://localhost:5174 STATS_SERVICE_URL=http://127.0.0.1:5001 DATABASE_URL= node src/index.js
  # terminal 2 (from client/)
  VITE_SERVER_URL=http://localhost:4001 npx vite --port 5174
  ```
  Note: this app's Vite/Node dev servers bind to `[::1]` (IPv6) by default on this machine, not `127.0.0.1` — use `http://localhost:<port>` when checking with curl or the browser, not `127.0.0.1`.

## 5. Suggested order for next session

1. Mine kokonutui.com further / do the typography+spacing pass (section 3's "not yet done" list).
2. Per-stat bars/rank comparisons for deeper stat visibility (section 2's "not yet done" list).
3. Revisit bklit.com specifically for the stats-during-bidding-phase idea.
4. Whenever the site needs to go live again: regenerate ngrok tunnels and resync `CLIENT_ORIGIN`/`VITE_SERVER_URL`.
