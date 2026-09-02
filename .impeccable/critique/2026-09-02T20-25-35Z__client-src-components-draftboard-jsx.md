---
target: draft board (DraftBoard.jsx + related components/CSS)
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 4
target_identity: "file:C:\\Users\\gabri\\Documents\\Code\\hoop-bids\\nba-auction-draft\\client\\src\\components\\DraftBoard.jsx"
target_fingerprint: "sha256:544727c4bc0dd32ba05b6642a2f54d5ebaad818ed7eb8e08d12a802c37b9b4f7"
target_path: "C:\\Users\\gabri\\Documents\\Code\\hoop-bids\\nba-auction-draft\\client\\src\\components\\DraftBoard.jsx"
timestamp: 2026-09-02T20-25-35Z
slug: client-src-components-draftboard-jsx
---
Method: dual-agent (A: general-purpose · B: general-purpose)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2/4 | "On the clock: X" stays pinned through the whole bidding phase even after someone else takes the high bid; bid changes render with no flash/pulse; "CONNECTING…" is the only disconnect signal — controls stay fully interactive-looking. |
| 2 | Match Between System / Real World | 3/4 | Domain vocabulary lands well; "TS%" in the value tooltip has no inline definition. |
| 3 | User Control and Freedom | 3/4 | Good Cancel on the risky position-assign dialog; "Leave Room" mid-auction has zero confirmation. |
| 4 | Consistency and Standards | 3/4 | `.primary-btn`/`.secondary-btn` reused consistently; undercut by "on the clock" semantic drift and a real mobile layout bug (below) that makes the collapsed chat rail render identically to desktop instead of the intended compact bar. |
| 5 | Error Prevention | 3/4 | `BidStepper` clamps bid range before submit; the assign-position dialog explains *why* before committing an irreversible pick. Leave Room stays unguarded. |
| 6 | Recognition Rather Than Recall | 3/4 | Budget/bid/roster state always visible; mute button is icon-only with no visible label (has aria-label, so screen-reader-fine, visually recall-dependent). |
| 7 | Flexibility and Efficiency of Use | 1/4 | No quick-bid amounts, no keyboard submission (Enter does nothing in the bid input) — every bid in every round needs a mouse hit on Raise. |
| 8 | Aesthetic and Minimalist Design | 3/4 | Coherent dark broadcast palette; the nomination card stacks meta/history/stats/radar/insights with whitespace only, no grouping; a body-copy text color computes to ~3.5:1 contrast (below AA) and is used in 32 places. |
| 9 | Help Recognize/Diagnose/Recover from Errors | 3/4 | `friendlyError()` maps every server error to a specific, actionable sentence — genuinely good; rendered with no icon, easy to miss. |
| 10 | Help and Documentation | 0/4 | "How to Play" only mounts on the pre-room screen; once a draft starts there is no help affordance anywhere in the render tree. |
| **Total** | | **24/40** | **Acceptable — significant improvements needed** |

## Design Specificity Verdict

**LLM assessment**: This is genuinely grounded in its domain, not a reskinned template. The synchronized roll animation (driven off a server event so every player sees the identical spin at the identical moment — not each client rolling independently), the ML-backed "Suggested value"/"Similar players" panel doing real inference against draft history, the radar chart keyed to actual box-score categories, and team-colored headshot borders are all specific to an NBA auction draft and wouldn't transplant to an unrelated product unchanged. Where it slips toward generic: the bid mechanic itself — a number stepper plus two buttons — is interchangeable with any bidding widget, and it's the single most-repeated interaction on the whole screen.

**Deterministic scan**: The bundled detector found exactly 1 finding across all 7 scanned files (`DraftBoard.jsx`, `RosterGrid.jsx`, `ChatPanel.jsx`, `PlayerInsights.jsx`, `StatRadarChart.jsx`, `StatHighlightRow.jsx`, `index.css`): a `layout-transition` warning on `.chat-panel`'s `transition: width`. Verified in context and dismissed — the panel is a flex sibling that must actually free real layout space for `.draft-board` to reflow into when it collapses; a `transform`-only version would squish content instead of freeing space. No other static anti-patterns detected — the earlier lobby cleanup didn't leave anything behind, and nothing new was introduced here.

**Browser evidence caught two real bugs the LLM review missed entirely**, both confirmed via live computed styles, not just static reading:
1. A CSS **source-order specificity collision**: the mobile override (`@media (max-width: 860px)`, sets `.chat-panel.collapsed { width: 100%; }`) and a later unscoped rule (`.chat-panel.collapsed { width: 44px; }`) have identical specificity, so the rule declared later in the file wins at *every* viewport including mobile — the collapsed chat rail renders as a full-height 44px vertical strip on a 375px screen instead of a compact horizontal bar, wasting most of the viewport.
2. The keyboard focus ring on `.primary-btn` — the app's shared CTA class, reused for Raise, nominate-submit, vote, and the budget-warning confirm — is the browser's default orange outline rendered directly against the button's own orange gradient background with zero offset. Confirmed via `document.activeElement`: focus genuinely lands there, but the ring is visually indistinguishable from the button in a screenshot before/after tabbing onto it.

## Overall Impression

The data layer and the one designed "moment" (the nomination reveal) are genuinely well-crafted; the interaction layer around the actual core loop — bidding — is under-invested by comparison, and there's a real, verified accessibility gap between what the code intends and what actually renders (the mobile chat bug, the invisible focus ring) that neither a source read nor a design opinion alone would have caught without both passes.

## What's Working

1. **The assign-confirmation dialog** doesn't just block a risky move, it explains why ("Their listed position is X" / "you'll need at least 1 coin per slot") and still lets the player proceed deliberately — informative error prevention, not paternalistic.
2. **`friendlyError()`'s error map** — all 17 server error codes get a distinct, human, actionable sentence instead of "Something went wrong."
3. **The synchronized roll animation** — server-driven so every player in the room sees the identical spin at the identical moment, which is the harder and more correct implementation choice.

## Priority Issues

**[P1] Keyboard focus is invisible on the app's primary CTA**
- Location: `.primary-btn` (`client/src/index.css`), reused across Raise, nominate-submit, vote, and budget-confirm
- Why it matters: a keyboard-only user cannot see which control is focused on the single most-used button class in the app — confirmed live, not theoretical
- Fix: add an explicit `outline-offset` + a contrasting ring color (e.g. a light/white ring, or a dark drop-shadow) that doesn't rely on the browser default matching a button that's the same color as the ring
- Suggested command: `/impeccable harden`

**[P1] Chat panel is broken on mobile — a CSS source-order bug, not a design choice**
- Location: `client/src/index.css` — the `@media (max-width: 860px)` mobile override at ~line 1010 is overridden by an unscoped rule at ~line 2450 declared later in the file, same specificity
- Why it matters: the collapsed chat rail renders as a full-height vertical strip on a 375px screen instead of the intended compact bar, eating most of the viewport
- Fix: scope the later rule under the same or a higher-specificity mobile query, or reorder so the mobile override loads after the base rule
- Suggested command: `/impeccable adapt`

**[P1] "How to Play" is unreachable once a draft starts**
- Location: `Footer.jsx` only mounts in `App.jsx`'s pre-room branch; `DraftBoard`'s branch has no help affordance at all
- Why it matters: a first-timer confused mid-draft (predicted-value math, "TS%", orderly vs open bidding) has no in-context recourse — only "Leave Room"
- Fix: a small "?" icon-button in the draft header opening the same How-to-Play modal content Footer already has
- Suggested command: `/impeccable onboard`

**[P1] No quick-bid or keyboard bid submission**
- Location: `BidStepper.jsx` / `.bid-controls`
- Why it matters: every bid, every round, for the whole draft, needs a mouse hit on Raise — the bid input isn't in a `<form>` and has no key handler, so Enter does nothing; there's no way to get faster with practice on the most-repeated action in the game
- Fix: wrap the controls in a `<form onSubmit>` so Enter submits, add a couple of quick-jump amounts alongside the ±1 stepper
- Suggested command: `/impeccable optimize`

**[P2] Systemic low-contrast label text — 32 occurrences**
- Location: `--text-faint` (#59697c on #0c1218/#080c11, ~3.5:1) — used for `.predicted-price-label`, `.similar-players-label`, `.nominated-by`, and 29 other rules across `index.css`
- Why it matters: WCAG AA requires 4.5:1 for normal-size text; this is a systemic token choice, not an isolated typo, so it affects every small uppercase eyebrow label across the app
- Fix: shift these labels to `--text-dim` (#93a4b8, ~7.7:1, already used elsewhere and already passes) or lighten `--text-faint` itself
- Suggested command: `/impeccable harden`

## Persona Red Flags

**Jordan (first-timer)**: Lands on "SUGGESTED VALUE ~1.0 coins" and a "TS%" stat tooltip with no definition anywhere on screen, wants to check the rules, and finds nothing — the only "How to Play" content in the app never mounts once inside a room. Their only move is "Leave Room," shown with the same visual weight as any other secondary button, no confirmation of what leaving costs them mid-draft.

**Sam (keyboard/screen-reader dependent)**: Can tab to the bid input and type an amount, but Enter does nothing — must locate the separate Raise button every time. Tabbing onto the app's own primary CTA gives no visible confirmation of focus. The chat panel's toggle button computes an empty accessible name in the accessibility tree (a nested `<span>Chat</span>` isn't rolled up into the button's own name) — a screen reader announces it as an unlabeled button, not "Chat, expand/collapse."

**Casey (distracted mobile user)**: On a 375px screen, reaching Raise/Pass means scrolling roughly two full screen-heights past the stat block and radar chart first. The one on-screen cue that matters most for a spotty mobile connection — the "CONNECTING…" badge — is a small top-right text chip with no other signal (no disabled buttons, no toast) that actions might silently fail; reproduced multiple times live in this session.

## Minor Observations

- Six "similar player" / roster links all expose the identical accessible name ("View on NBA.com/stats") via a `title` attribute that shadows the actual player-name link text — indistinguishable to a screen-reader user tabbing through the list.
- The "Suggested value" tooltip trigger is keyboard-focusable but has no `aria-describedby` linking it to the tooltip's stat breakdown, so the content may not be announced on focus.
- Player headshots can be briefly out of sync between the nomination card and the corresponding roster slot for the same player (real photo vs. placeholder silhouette) — a loading-timing artifact, not a hard bug.
- The position-picker shows up to 5 slot buttons at once during an irreversible assignment — one over the app's own apparent ≤4-choices pattern elsewhere.
- "On the clock: X" stays pinned through the entire bid war even once bidding is genuinely open to anyone — reads as "still their turn."
- Winning a bid renders as a plain sentence with no visual/audio moment, in contrast to the well-produced nomination reveal — an emotional-weight mismatch for a game whose core loop is winning bids.
- No countdown/urgency timer anywhere in bidding (by design, presumably, but worth confirming it's intentional).

## Questions to Consider

1. If the reveal gets a full sound-and-motion treatment but winning the bid doesn't, which moment does the team actually believe is the emotional core of the game — and does the current design match that belief?
2. The bid mechanic is the single most-repeated action in an entire draft — is a stepper-plus-two-buttons the right amount of investment for something used that often?
3. Given help is fully unreachable mid-draft, is "How to Play" meant to be read once before ever creating a room — realistic for a friend who just got handed a room code with no other context?
