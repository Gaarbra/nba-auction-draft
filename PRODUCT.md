# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Small groups of friends (2+) who want a quick, social fantasy-basketball-style game together — either live over the internet from separate devices, or pass-and-play on one shared device in the same room. Casual NBA fans, not fantasy-sports power users; no account system, just a display name and a room code.

## Product Purpose

Hoop Bids is a real-time NBA fantasy auction draft: a host creates a room, players join with a room code (or play "Local" pass-and-play on one device), and the group takes turns nominating real NBA players (any era) for the others to bid coins on, filling 5 roster slots (PG/SG/SF/PF/C) each. Once every roster is full, the app scores each team from real career stats and ranks the room. Success = a fun, fast, low-friction shared session — not a persistent meta-game.

## Positioning

Unlike typical season-long fantasy basketball (roster management over months, real stakes/leagues), Hoop Bids is a single-sitting party game: live bidding tension, any-era player pool, and a scored result in one session. No accounts, no season commitment.

## Operating Context

- Real-time multiplayer via Socket.IO (server: Node/Express) plus a from-scratch "Local" mode for pass-and-play on one device.
- Player stats/photos come from a separate Python/Flask `stats-service` backed by `nba_api` / stats.nba.com data, cached to survive that upstream being unreachable from the hosting provider.
- Deployed on Render.com free tier (client, server, stats-service as separate services) — cold starts and idle spin-down are real, user-facing constraints already mitigated (stale-while-revalidate caches, a wake-up ping on page load).
- In-room text chat exists alongside the draft (profanity/slur-filtered).
- Host picks player pool (era), difficulty, and bidding style (orderly turn order vs. open bidding) before starting a draft.

## Capabilities and Constraints

- No login/accounts — identity is a per-session display name plus room membership.
- No payments, no persistent user data beyond a session/room and optional draft-history lookups.
- Everyone starts with an equal coin budget; a full roster needs at least 1 coin per remaining open slot, which constrains max bids live.
- Historical/any-era NBA players may have partial or unavailable stats — the UI must handle "stats unavailable" gracefully, it is a normal case, not an error state.
- Must remain fully usable on mobile (pass-and-play in particular assumes players sharing one phone/tablet).

## Brand Commitments

Name is "Hoop Bids." Fan-made, unaffiliated with the NBA (stated in Terms of Use). Existing tone is punchy/energetic (all-caps headers like "LOCAL GAME," "CONNECTED" status), dark theme with an orange accent already established as the brand color.

## Evidence on Hand

- Real, live player photos and per-game career stats for a large cached "notable pool" of NBA players (see `stats-service/data/`).
- No testimonials, press, pricing, or case studies — none should be fabricated; this is a free hobby project.

## Product Principles

1. A full draft session should complete in one sitting with minimal setup friction (room code or Local mode, no account).
2. Bidding tension is the core loop — the UI must keep current bid, budget remaining, and time/turn pressure legible at a glance, especially mid-auction.
3. Real NBA data (stats, photos) is a first-class asset; the design should showcase it, not bury it, while degrading gracefully when a player's data is thin.
4. Free-tier hosting constraints (cold starts, spin-down, ephemeral storage) are product constraints, not edge cases to ignore.
5. Works equally well as "friends in different cities" (live multiplayer) and "friends on one couch" (Local pass-and-play) — neither mode is second-class.

## Accessibility & Inclusion

Established this session: WCAG AA text contrast (4.5:1) on the dark theme, visible `:focus-visible` keyboard focus rings on interactive controls, and real `<form>`/submit semantics (Enter-to-submit) on bidding controls — these are confirmed standards to preserve, not aspirational.
