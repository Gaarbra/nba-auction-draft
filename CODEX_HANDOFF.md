# Hoop Bids: Codex handoff (2026-09-20)

This document is a full handoff from a long Claude Code session. It covers what the app is, how the user likes to work, everything that changed, what was verified and what was not, known bugs, and what to do next. Read it top to bottom before editing anything.

Repo root: `C:\Users\gabri\Documents\Code\hoop-bids\nba-auction-draft`
Remote: `https://github.com/Gaarbra/nba-auction-draft.git`, branch `main`
Latest pushed commit from this session: `98917b9` ("Apple-inspired modernization pass: Lenis/GSAP, win streaks, Market search")

Related docs already in the repo (read these too, do not duplicate them):

- `PRODUCT.md`: users, purpose, constraints, brand, product principles, accessibility commitments.
- `README.md`: setup, scoring methodology, deploy steps for Render.
- `HANDOFF.md` (dated 2026-08-27): older notes covering votekick, the repeated-players bug fix, StatHighlightRow, the first glass-panel pass, and the local ngrok workflow.
- `AWS_MIGRATION.md`: RDS and S3 archive phases.

## 1. The app in one paragraph

Hoop Bids is a real-time NBA fantasy auction draft. A host creates a room (public, private by code, local pass-and-play on one device, or solo). Players take turns nominating a random real NBA player from any era, everyone else bids coins (start 1 coin, 20 coin budget each), and the winner assigns the player to one of five slots (PG/SG/SF/PF/C). When all rosters are full, real career stats feed a scoring formula and the app shows ranked results with a rematch vote. There are no accounts. Identity is a display name plus a room code.

Stack: React 18 + Vite (`client/`), Node/Express/Socket.IO (`server/`), Python/Flask + `nba_api` (`stats-service/`), PostgreSQL (AWS RDS in production, optional locally via `DATABASE_URL`). Deployed to Render free tier as three services (`render.yaml`).

Screens, in the order a session moves through them:

1. Lobby (Landing.jsx + RoomLobby.jsx): hero plus the room console.
2. How to Play (HowToPlay.jsx): a scroll-driven explainer page, not a modal.
3. Market (MarketTab.jsx): browse and search the player catalogue with stats and a suggested value.
4. Waiting room (RoomView.jsx): pre-draft player list and host controls.
5. Draft board (DraftBoard.jsx plus AssignBoard, RosterGrid, LocalBiddingRows, BidStepper).
6. Results (ResultsScreen.jsx): ranked teams, matchups, rematch panel.

## 2. How the user wants you to work

These are standing preferences the user stated during the Claude session. Treat them as rules.

- No em dashes, ever, in anything you write (chat, code comments, UI copy, commit messages, docs). Use a period, comma, colon, or parentheses. Also avoid common AI writing tells: "delve", "crucial", "robust", "showcase", "underscores", "serves as", "boasts", puffery, rule-of-three padding, and "not just X but Y" constructions. Plain and specific beats smooth and generic.
- Be lazy in the engineering sense (the user runs a "ponytail" skill in full intensity): smallest diff that works, reuse what exists before building, no speculative abstractions, no new dependency for something a few lines can do. Read and understand the flow before choosing the small fix. Fix root causes where all callers route through, not one caller.
- Prefer existing installed tools and skills to installing new ones or re-deriving research. The user asked for this explicitly to cut token usage. Installing a skill with `npx skills add` silently overwrites a folder with the same name (this already happened once, see section 5.2).
- Security-first for new features: secrets only through env vars, parameterized queries only, schema validation on new endpoints or socket events (Zod on Node, Pydantic on Python), errors logged server-side, separate files for data access, business logic, and handlers. For nontrivial work, give a short plan first. This app has no user accounts by design, so a literal "row level security per user" requirement does not map onto it. Do not invent a fake auth model. If a future feature needs per-person persisted data, ask the user.
- Do not commit or push unless asked. When you do stage, add files by name. Do not sweep in the untracked skill files, `.claude/settings.local.json`, or the runtime cache JSON files (see section 8).
- Verify with real measurements, not screenshots alone. Earlier in the session a screenshot looked broken and a `getBoundingClientRect()` check showed the real state. Prefer computed styles, DOM values, and network responses.
- The user tends to give multi-part requests in one message. Parse each part, and if a part is genuinely ambiguous and expensive to guess, ask one focused question. They usually answer briefly.

## 3. Environment notes

- OS is Windows 11. Shell is PowerShell or Git Bash. Use forward slashes in Bash.
- Run everything from the repo root with `npm run dev`. It starts the Node server on port 4000, the Vite client on 5173, and the Flask stats service on 5001 (`concurrently`). To run only the client, `npm run dev --prefix client`.
- `.claude/launch.json` has two configs, `client` (Vite only) and `dev` (all three). If the client alone is running, the app loads but every socket and image call fails with `ERR_CONNECTION_REFUSED` and the connection dot in the nav is red. That is expected, not a bug.
- The Vite dev server binds to IPv6 on this machine. Use `http://localhost:<port>`, not `127.0.0.1`, for curl and the browser.
- Build check: `npm run build` inside `client/`. It has passed after every change in this session. It prints a chunk-size warning (about 900 kB), which is pre-existing.
- `.codex/hooks.json` already exists in the repo. It runs `.agents/skills/impeccable/scripts/hook.mjs` after edits and on stop, if that file exists.
- There is no `AGENTS.md` or `CLAUDE.md` in the repo. Consider creating an `AGENTS.md` that points to this file and `PRODUCT.md`.
- The stats service loads its caches from `stats-service/data/`. On startup it logged `[usage cache] failed to load from disk, starting empty: Extra data: line 1 column 858137`. That means `usageCache.json` has trailing garbage and is being ignored. It is pre-existing and worth a separate fix.
- Free-tier Render cold starts and stats.nba.com being unreachable from Render's IP are product constraints (see `PRODUCT.md`). Any live `nba_api` call is gated behind an `ON_RENDER` guard, so "test it in production" will never exercise those paths.

Browser automation quirks seen in this session (Claude's in-app browser, may not apply to Codex tools, but the lessons are general):

- Screenshots sometimes lag one render behind the DOM. If a screenshot contradicts the DOM, read the DOM (`input.value`, computed style) and take another screenshot after a short wait.
- Programmatic `window.scrollTo` does not always fire scroll listeners in time. Real wheel scrolling does.
- Blank stretches while scrolling How to Play are normal spacing between pinned sequences, not a rendering failure.
- When the browser pane is hidden, `requestAnimationFrame` does not pump, so rAF-driven animations (the StatHighlightRow count-up) read as stuck at 0. Check data instead.

## 4. Fast paths to reach each screen while testing

- Results, fastest: Lobby, choose Solo, type a name, Start Solo Draft, then Start Solo Draft again in the waiting room. Solo skips bidding. A player is auto-nominated and won at a flat 1 coin, and you click a slot to place them. Five placements finish the draft. If the player's position does not match any open slot, clicking a slot opens a "Lock in X anyway" confirmation (position mismatch adds a scoring penalty, shown as `Pen` in results). Requires the full `npm run dev` stack, because scoring calls the stats service.
- Live bidding UI: Lobby, choose Local, enter two names, Start Local Game, Start Draft. The first player is nominated and the bid console (stepper, Raise, Pass) shows immediately.
- Mobile checks: set the viewport to 375x812. After finishing, reset it to desktop.
- Rematch reuses the same room. "Return to lobby" and a resolved rematch both call the shared reset in `server/src/rooms/roomStore.js` (around line 561), which sets `room.status = "waiting"` and clears results and votes. The room code does not change. This matters for the win-streak bug in section 7.

## 5. What was done, in order

### 5.1 Deploy check (unresolved)

The user asked to "check the deploy is live". No production client URL is recorded in memory or the repo (only generic placeholders like `https://hoop-bids-client.onrender.com` in the README). The user mentioned earlier buying a custom domain. This was never answered. To close it, ask for the URL, or find it in the Render dashboard, then request it and confirm the client, the server `/health` (if present), and the stats service respond.

### 5.2 Apple design skills

- The user asked to install `https://github.com/dickwu/apple-design-skill`, a Human Interface Guidelines design reviewer (122 reference pages under `references/hig/`).
- Collision: the repo already had a skill named `apple-design`, which was actually the WWDC 2018 "Designing Fluid Interfaces" motion and springs skill. The installer overwrote it.
- Recovery: the old content was restored with `git show fdf361e:.agents/skills/apple-design/SKILL.md`, saved as `.agents/skills/apple-fluid-interfaces/SKILL.md` with the frontmatter `name:` changed to `apple-fluid-interfaces`, and symlinked at `.claude/skills/apple-fluid-interfaces` (the repo convention is `.claude/skills/<name>` pointing at `.agents/skills/<name>`).
- Result: two skills now. `apple-design` is the HIG reviewer. `apple-fluid-interfaces` is the motion and fluid-UI skill.
- These skill files were deliberately not committed. They are untracked (or modified) in git. See section 8.

### 5.3 HIG design review of Landing, How to Play, Lobby, Results

The `apple-design` skill was run against the web app. Because this is a web app, only the cross-platform foundations applied (accessibility, color, typography, layout, motion, feedback, writing), not native conventions like tab bars or sheets. Numeric thresholds used: text 17pt default and 11pt minimum on iOS; contrast 4.5:1 for text up to 17pt and 3:1 for 18pt or bold; controls 44x44pt default and 28x28pt minimum. Contrast was computed with a real luminance script from hex values in `index.css`, not estimated.

The user then asked to fix two categories of findings only: reduced motion, and color and typeface.

Reduced motion:

- The review initially claimed no reduced-motion handling existed in Landing, RoomLobby, or ResultsScreen. On re-check this was overstated. Landing has no Motion animation. RoomLobby's 3D tilt is already gated (`handleCardMouseMove` returns early when `prefers-reduced-motion: reduce` matches). Only `ResultsScreen.jsx`'s `TeamCard` had a real gap.
- Fix: a module-level `prefersReducedMotion` constant (same pattern as `HowToPlay.jsx`) and `TeamCard`'s entrance now uses no slide and a 0.2s fade when reduced motion is on, and the staggered spring otherwise.

Color and typeface:

- Root cause: the app scopes design tokens by screen using the same custom property names redefined per scope. Base `:root` has `--accent: #ff8a00` and Inter. `.landing-lobby` uses `--ll-*` names. `.how-to-play` uses `--htp-*` names. `.room-drafting` (applied to `.app-shell` only while `inDraft` is true) redefines the base names with `--accent: #ffb020` and Space Grotesk. `ResultsScreen` renders after `status === "complete"`, where `inDraft` is false, so it fell back to the base `:root` tokens and looked different from the rest of the app. An existing comment in the CSS said Results had been excluded from the earlier `.room-drafting` pass.
- Fix: a `.results-screen` block in `client/src/index.css` that overrides `--bg-panel`, `--bg-panel-raised`, `--bg-inset`, `--line`, `--text`, `--text-dim`, `--text-faint`, `--accent: #ffb020`, `--accent-bright`, `--win`, and `--font-display` (Space Grotesk stack), plus width, max-width 1120px, and centering.

### 5.4 Lenis and GSAP

User request: install Lenis, GSAP, VantaJS, and react-bits, then narrowed it: use GSAP and Lenis only, remove anything the site does not use. Vanta and react-bits were never installed and nothing references them. `client/package.json` dependencies are `gsap ^3.15.0`, `lenis ^1.3.26`, `motion ^13.1.1`, `posthog-js`, `react`, `react-dom`, `socket.io-client`. Nothing unused was found to remove.

`client/src/hooks/useSmoothScroll.js` (mounted once, first line of `App()` in `client/src/App.jsx`):

- Creates `new Lenis({ autoRaf: false })`. Lenis defaults to smoothing the real window scroll (not a transformed wrapper), so `position: sticky` stays valid.
- Registers `gsap.registerPlugin(ScrollTrigger)`, forwards `lenis.on("scroll", ScrollTrigger.update)`, drives `lenis.raf` from `gsap.ticker`, and sets `gsap.ticker.lagSmoothing(0)`.
- Skips entirely under `prefers-reduced-motion: reduce`.

The sticky conflict, and the fix:

- After Lenis was added, How to Play's pinned frames (`.how-to-play-pin-frame`, computed `position: sticky; top: 0`) measured `getBoundingClientRect().top = -518` instead of sitting at the top. This was a real measurement, not a screenshot artifact.
- First attempt was a `pausedOn` parameter that called `lenis.stop()` on the How to Play tab. Reading Lenis's source showed `stop()` sets `isStopped` and its event handler then calls `preventDefault()` on every wheel and touch event, which freezes scrolling instead of restoring native scroll. That approach was reverted before it was ever wired up.
- Correct fix: Lenis skips any subtree with a `data-lenis-prevent` attribute. `client/src/components/HowToPlay.jsx` root is now `<div className="how-to-play" data-lenis-prevent ...>`. Lenis smooths every other page. How to Play keeps native scroll.
- Verified after the fix: step 1 rect top became a sane positive value. All four pinned steps, the math section, the team-assembly sequence (`.how-to-play-team-track` / `.how-to-play-team-frame`, sticky at top 0), and the sum reveal all render correctly. Lenis is active elsewhere (the `lenis` class is present on `<html>` on the Lobby).
- Do not "fix" Lenis smoothing on How to Play by removing `data-lenis-prevent`. The pinned sequences depend on native scroll and Motion's `useScroll`.

Not verified: how the Lenis smoothing actually feels on Lobby, Market, Results, and the draft board. Only its presence was checked.

### 5.5 PlayerAccolades on mobile

`client/src/components/PlayerAccolades.jsx` fetches real career awards from `${SERVER_URL}/api/players/${nbaPlayerId}/awards` and renders tier-colored `.accolade-chip` spans. It is only used in `DraftBoard.jsx`. It had been hidden on phones by a CSS rule.

Change in `client/src/index.css`, inside the `@media (max-width: 640px)` block near the nomination-card rules:

- Removed `.player-accolades` from the hide list. `.player-team-history`, `.stats-season`, `.nominated-by` stay hidden on phones.
- Added a compact treatment: `.room-drafting .active-nomination-cinematic .player-accolades` becomes `flex-wrap: nowrap; overflow-x: auto;` with the scrollbar hidden, and `.accolade-chip` gets `padding: 2px 7px; font-size: 10px`.
- Result: chips scroll horizontally on a phone instead of wrapping and pushing the bid controls down. Confirmed visually: on a 375px viewport the chips run off the right edge and scroll.

### 5.6 Winning streak in the Lobby

The user wanted a streak feature. Because there are no accounts, they chose "browser-local only" (localStorage, no backend or schema change).

- `client/src/winStreak.js`: key `hoopbids_win_streak`, value `{ current, lastRoomCode }`. `getStreak()` returns `current`. `recordDraftResult(roomCode, won)` returns early if `lastRoomCode === roomCode`, otherwise sets `current` to `current + 1` on a win or `0` on a loss and stores the room code. Storage errors are swallowed.
- `client/src/components/ResultsScreen.jsx`: the existing effect that fires `trackEvent("draft_results_viewed")` when `resultsStatus === "ready"` now also finds the current player's team in `results.teams` and calls `recordDraftResult(room.code, myTeam.rank === 1)`.
- `client/src/components/Landing.jsx`: reads the streak once per mount with `useState(getStreak)` and renders `.landing-lobby-streak` ("N-draft win streak on this device") when the streak is 2 or more. Styling is an amber pill next to the existing eyebrow (`.landing-lobby-streak` in `index.css`).
- Verified with a manually set localStorage value (4 showed "4-draft win streak on this device"). Not verified end-to-end from a real completed draft.
- Known bug, see section 7.1.

### 5.7 The redesign attempt (Paper, then Stitch)

The user asked to redesign the whole app "with Paper", keeping the format but making it modern, Apple-styled, mobile-optimized, with cleaner scroll storytelling, and to explain the app to the design tool.

Paper:

- Paper is a local HTTP MCP server at `http://127.0.0.1:29979/mcp`. It never connected in the session. The `/mcp` panel showed "SDK auth failed: Dynamic Client Registration rejected (HTTP 404) ... Try restarting your agent and Paper."
- MCP servers connect when a session starts and do not refresh mid-session, so reconnecting in another terminal never helped. `reconnect_session_connector` only works for claude.ai connectors, not user-configured local servers.
- The user then said to use Google Stitch instead.

Stitch (this was already connected):

- The app already had a Stitch project from earlier design work: "Hoop Bids Fantasy Draft", project id `738373405333367981`, with a design system "Courtside Precision" (asset `assets/1777e081d5104caab28c4a950820f69e`). It defines near-black surfaces, one amber accent, Inter, tabular numerals, hairline borders, a 3-tier radius set (12px controls, 20px cards, pill), and a desktop 3-column and mobile single-column layout. This is the origin of the app's current look.
- I appended an "Apple-inspired modernization and mobile-optimization" section and a "What this app is" section (the five screens and what each does) to that design system's `designMd` via `update_design_system`, keeping the palette and tokens unchanged.
- `generate_screen_from_text` for a mobile How to Play screen timed out and the screen never appeared in `list_screens`. It was not retried.
- `apply_design_system` re-rendered six existing screens under the updated system. New screen ids: mobile landing `918780ae4fe648a7ad3437e1fa078e01`, desktop landing `54bcabcdc1ff45c98e2e4850b3981e99`, desktop results `62e3a622b6204d78b5256fa3d935162a`, mobile results `d9a988b679a84646ba6f9240318cafaf`, desktop draft room `65f08357b09d4bab913c383fc65cb7be`, mobile assign player `3e4628531e1a45afbdf595d78fd0ec1a`.
- The user's verdict after seeing them: the Landing (minimal centered console) and mobile Results (collapsed lower ranks, one bottom-pinned "Confirm rematch") are the direction to follow. The Draft Room came back as a dense three-column trading terminal, and the user said "like the results page but not the draft room." So the Draft Room stays as-is structurally with polish only.
- Note the font gap: Stitch's system says Inter only, while the shipped app uses Space Grotesk and Space Mono for display text on Landing, Results, and How to Play. Do not "correct" the app to Inter to match Stitch.
- Stitch MCP tools may not exist in Codex unless the user configures them. The mockups are only references.

### 5.8 Code changes that came out of the redesign pass

All in `client/src/index.css` unless noted.

- Results mobile CTA: inside a new `@media (max-width: 640px)` block after `.rematch-leave`, `.rematch-confirm` is `position: fixed` (16px from the left, right, and bottom edges, plus `env(safe-area-inset-bottom)`), `z-index: 30`, with a shadow, and `.results-screen` gets `padding-bottom: 84px`. This does not collide with the bottom nav because `App.jsx` renders `BottomNav` only when there is no room, and renders `RoomFooter` only while `inDraft`, so neither shows on Results.
- Touch targets: the shared `.primary-btn, .secondary-btn, .leave-btn` rule changed padding from `11px 16px` to `15px 16px`. Measured button height went from about 39px to 47px, which clears the 44pt HIG default. This changes every button in the app. The compact `.bid-stepper-btn` (34 wide, about 39 tall) was left alone because it meets the 28pt minimum and changing it risked the tight stepper layout.
- How to Play progress and ambient glow (`HowToPlay.jsx` and `index.css`):
  - `pageRef` and `progressFillRef` refs, plus one `ScrollTrigger.create({ trigger: page, start: "top top", end: "bottom bottom", onUpdate })` inside a `useEffect` with `trigger.kill()` cleanup.
  - `onUpdate` sets `gsap.set(fill, { scaleX: self.progress })` and `page.style.setProperty("--htp-scroll-progress", self.progress)`.
  - `.how-to-play-progress` is a 3px fixed bar at the top (`z-index: 41`, above `.topnav` at 40) with `.how-to-play-progress-fill` (scaleX from left, `--htp-accent`).
  - `.how-to-play::before` is a fixed, `z-index: -1` radial gradient whose vertical center is `calc(var(--htp-scroll-progress, 0) * 100%)`, amber at 7% opacity. It is hidden under `prefers-reduced-motion: reduce`. The progress bar itself is not gated, since it is direct scroll-linked state, not independent motion.
  - Verified on desktop: the custom property and gradient position update live with scroll (8.6% progress gave a gradient at 8.6%), and the bar fills toward the right edge by the end of the team-assembly sequence.

### 5.9 Market tab: search bar and filter toggle

User request 1: add a search bar so users can search a player without the filters. User request 2: let users show or hide the era and team filters, but always keep the search bar.

What was found: a search input already existed inside `.market-filterbar`, styled as a pill to blend in with the filters. It also was not independent. `searchResults` in `MarketTab.jsx` searched within the selected team if one was set (`team ? teamPlayers : eraFiltered`), so a leftover team or era pick silently zeroed out an unrelated name search (typing "curry" with 2000s and CLE selected showed nothing).

Changes in `client/src/components/MarketTab.jsx` and `index.css`:

- Standalone search bar `.market-searchbar` (new row above the filters) with an inline magnifier SVG, `.market-searchbar-input` (48px tall, `--radius-lg`), and placeholder "Search any player by name...".
- Search now ignores era, team, and position tag. When the query is non-empty, `searchResults` filters the whole `index` by name. When the query is empty, it falls back to the old era/team/position behavior. `index` was added to the memo's dependency array.
- The results label no longer says "on {team}" while a search is active: `team && !search.trim() ? " on " + team : " match"`.
- `showFilters` state (default `true`) and a `.market-filters-toggle` "Filters" button with a rotating chevron (`aria-expanded`) sit inside `.market-searchbar`. When hidden, `.market-filterbar` (era pills and franchise dropdown) is not rendered. The quick position tags (Guards/Forwards/Centers) stay visible either way, since the user's description named only era and team as the toggled filters. Hiding does not reset the selections.
- The filter bar is now a `motion.div` with an entrance-only animation and no `AnimatePresence` or `exit`, matching `Dropdown.jsx`. See the Motion gotcha in section 6.
- `.market-searchbar-input` uses `flex: 1 1 auto; min-width: 0` so the toggle button fits beside it.
- Verified in the browser: search returns 7 Curry matches across teams and eras with CLE and 2000s still selected, and the label reads "7 PLAYERS MATCH". The toggle hides and restores the filters, and the accent color and chevron state flip correctly.
- Dead CSS left behind: the four `.market-search-input` rules (around `index.css` lines 5325 to 5346) are no longer referenced anywhere. Safe to delete. The old `.market-search-input-wide` was already removed.

### 5.10 Git

- Committed and pushed `98917b9` to `origin/main` with 10 files: `client/package.json`, `client/package-lock.json`, `client/src/App.jsx`, `HowToPlay.jsx`, `Landing.jsx`, `MarketTab.jsx`, `ResultsScreen.jsx`, `index.css`, plus new `client/src/hooks/useSmoothScroll.js` and `client/src/winStreak.js`. 483 insertions, 43 deletions.
- A first attempt to stage everything pulled in about 250 skill reference files, so those were unstaged on purpose. See section 8.

## 6. Architecture facts you need before editing

- Token scoping: each redesigned screen owns a token scope. `.landing-lobby` (`--ll-*`), `.how-to-play` (`--htp-*`), `.room-drafting` (base names, amber `#ffb020`, Space Grotesk), `.results-screen` (base names, same values). A component rendered outside those scopes gets the base `:root` tokens (`#ff8a00`, Inter). When something looks off-brand on one screen, check which scope it sits in first.
- Motion gotcha (from `HANDOFF.md`, still true): never pair `AnimatePresence mode="wait"` with an `exit` animation on load-bearing UI, because an exit that never resolves can freeze the panel. `DraftBoard`'s nomination panel uses a keyed `motion.div` remount with no `AnimatePresence`. `Dropdown.jsx` and the new Market filter bar use entrance-only animation for the same reason. Follow that pattern for any show/hide.
- Sticky and scroll: How to Play's pinned steps and the team-assembly sequence use real `position: sticky` frames plus Motion `useScroll` reading native scroll. Anything that transforms an ancestor, or intercepts scroll, breaks them. Keep How to Play under `data-lenis-prevent`.
- Reduced motion: `useSmoothScroll` skips Lenis entirely. `HowToPlay.jsx` and `ResultsScreen.jsx` read a module-level `prefersReducedMotion`. New motion should gate on it or on a CSS `@media (prefers-reduced-motion: reduce)` rule.
- Numbers use `font-variant-numeric: tabular-nums` in roughly 40 places already. Keep doing that for any price, timer, score, or stat.
- Inputs use a 16px font floor so iOS Safari does not zoom on focus. Keep it.
- Existing Apple-inspired constraints already codified: 44pt default tap targets, 4.5:1 text contrast, visible `:focus-visible` rings, real `<form>` submit semantics on bid controls.
- Shared reset for rematch and return-to-lobby is in `server/src/rooms/roomStore.js` (search for the comment "Shared reset for both"). It keeps the room code.
- Server tests exist for scoring, room store, draft store, stats adapter, and concurrency (`*.test.js` in `server/src`). There are no client tests. If you touch server logic, run the relevant test file.

## 7. Known issues and open work, in priority order

### 7.1 Win streak double-count guard breaks on rematch (real bug, not fixed)

`recordDraftResult(roomCode, won)` skips when `lastRoomCode === roomCode`. A rematch and "Return to lobby" reuse the same room and the same code (confirmed: after returning to the lobby the room code stayed `FLFCX`). So only the first draft in a room ever updates the streak. Every later draft in that room is ignored, and the whole point of a streak is repeated drafts.

Suggested fix: key the guard on something unique per finished draft instead of the room code. Options: a per-draft id added server-side when a draft starts and sent in `room:update`, or the `results` object identity plus a timestamp, or a `drafts played` counter on the room. The smallest change is a draft id or counter from the server. Then update `recordDraftResult(draftKey, won)` and its call in `ResultsScreen.jsx`. Add one small check that fails if the guard logic regresses.

Also decide semantics for Local mode: several people share one device and one localStorage key, and `currentPlayerId` at the results screen is whichever local identity was last active. Options are to skip streak recording in local rooms, or to leave it and document it. Solo and online games are fine.

### 7.2 Things that were changed but not fully verified

- How to Play progress bar and ambient glow were only checked at desktop width, not at 375px.
- Market search and filters toggle were only checked at desktop width. The row of search bar plus Filters button on a phone needs a look (the toggle is 48px tall with 16px side padding beside a flex input).
- Lenis feel on Lobby, Market, Results, and Draft Board was not exercised, only its presence.
- Win streak badge was verified only with a hand-set localStorage value.
- The button padding change (39px to 47px) was checked on the Lobby's create-room button and the Results rematch button, not across every screen. Skim the waiting room, assign board, and chat for any layout that assumed the shorter height.
- During the Local-mode check, the mode toggle briefly showed "Public" highlighted while the Local fields were visible. It may have been a screenshot lag (several similar lag cases happened) but it was not confirmed either way.

### 7.3 Redesign follow-ups the user agreed to but that are still shallow

- Landing: only the shared button height changed. The Stitch mockup was much more minimal (small nav, one centered console, no large marketing hero and stats row). The user did not ask for the hero to be removed, and asked to keep the format, so treat any hero simplification as a proposal to confirm first.
- Draft Board: polish only. Glass is already limited to the sticky top bar. Tabular numerals are already broad. A bottom-pinned bid bar on mobile was considered and deliberately not built because it would change the layout, which the user rejected for this screen.
- How to Play: the Stitch mobile screen was never generated. The storytelling improvements shipped so far are the progress bar and the ambient glow. Further ideas that fit the "one continuous scene" brief: a smoother handoff between the four pinned steps and the math section, and a mobile pass on pin distances.
- Design tokens for typography and spacing were not consolidated. Each scope still defines its own set.

### 7.4 Housekeeping

- Delete the dead `.market-search-input` rules in `index.css`.
- `stats-service/data/usageCache.json` is malformed (see section 3) and gets ignored on load.
- CRLF warnings appear on `git add` for several files. Line endings are mixed on this Windows checkout. Do not reformat files wholesale.
- Deploy liveness check (section 5.1) is still open.

## 8. Uncommitted working tree state (do not commit blindly)

As of the end of this session, `git status` shows:

- Modified tracked files that came from running the app locally: `server/data/starPlayers.json`, `superstarPlayers.json`, `topTeamPlayers.json`, and `stats-service/data/awardsCache.json`, `photoCache.json`, `statsCache.json`, `usageCache.json`. These are runtime caches that grew during test drafts. They are unrelated to any feature. Leave them out unless the user wants refreshed caches committed.
- The apple-design skill install: modified `.agents/skills/apple-design/SKILL.md` and `.claude/skills/apple-design/SKILL.md`, modified `skills-lock.json`, and untracked `.agents/skills/apple-design/{.cursorrules,.gitignore,AGENTS.md,README.md,references/,scripts/}`, the same set under `.claude/skills/apple-design/`, plus `.agents/skills/apple-fluid-interfaces/` and the `.claude/skills/apple-fluid-interfaces` symlink. That is roughly 250 files. Ask before committing them. If committing, do it as its own commit, separate from app code.
- Untracked `.claude/settings.local.json`: local machine config. Do not commit.

## 9. First steps for Codex

1. Read `PRODUCT.md`, then skim `README.md` and `HANDOFF.md`.
2. Run `npm run dev` from the repo root. Confirm all three services log ready (`Server listening on http://localhost:4000`, Flask on 5001, Vite on 5173).
3. Reproduce the Results screen with the solo fast path in section 4, and the Market search with a team and era selected.
4. Fix the win streak guard (section 7.1) first. It is a small change with a real user-visible effect.
5. Verify the unverified items in section 7.2 at 375px and at desktop width.
6. Ask the user before touching Landing's structure, the Draft Board's layout, or committing the skill files.
7. Keep diffs small, follow the no-em-dash rule in anything you write, and only commit or push when asked.
