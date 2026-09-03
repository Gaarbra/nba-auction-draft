---
version: 1
slug: "app"
primary_target: "app"
related_targets: []
---

## Scope & Visitor Mode

Whole app, Operate mode (a live task the visitor completes: nominate, bid, manage a roster), with the lobby/homepage as its Persuade-flavored front door (get a friend group into a room fast). Redesign, not a new build: preserves all product truth, copy, and behavior confirmed in PRODUCT.md.

## Audience, Job, Action, Proof, Constraints

Small friend groups drafting NBA players live or pass-and-play. Job: read the current bid, budget, and roster state at a glance under time pressure, then act (raise/pass/nominate) in one motion. Proof: real player photos and career stats already on hand. Constraint: must stay legible on one shared phone screen (Local mode) and survive "stats unavailable" as a normal state, not an error.

## Chosen Direction — Sports Broadcast Card System

Direction is pinned by the user via two reference images (a broadcast "Game Summary" stat screen; a live-scores/player-card dashboard), not rolled.

### Direction contract

THESIS: every stat and every player is a broadcast card — oversized bold numerals doing the talking, not a form row with a label. Refuses the settings-panel look (small type, plain lists, thin borders) the draft board currently leans on for anything that isn't the hero player.

OWN-WORLD: near-black theatre ground (`--bg-void`/`--bg-panel`) warmed with a low radial amber gradient behind hero cards; the existing Oswald display face pushed harder (larger scale, tighter tracking) for scores, bids, and budgets; thin uppercase tracked micro-labels under every big number; a single warm-orange accent (`--accent`) carrying stripes, active states, and progress fills; rounded-square photo frames with a colored accent edge (already present, extended to roster cards); pill-shaped buttons and mode toggles; segmented multi-block progress bars in place of plain gradient bars.

STORY: a visitor lands on the lobby and immediately reads "this is a live draft," bold numerals and player photography carrying the weight; inside a draft, the current bid and remaining budget are the loudest things on screen.

FIRST VIEWPORT: lobby hero — a large bold headline, a stat-card style trio (Create / Join / Local) styled like broadcast tiles rather than plain form cards, existing price-ticker player photos kept as the ambient motion layer.

FORM: sports-broadcast dashboard, adapted (no literal sidebar/video — those reference elements don't map to this product's actual surfaces).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Unresolved Decisions

None — user approved "whole app" scope and a screenshot-preview-before-commit review step via AskUserQuestion.
