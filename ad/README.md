# Hoop Bids ad (Remotion)

A startup advertisement for Hoop Bids, built in [Remotion](https://remotion.dev)
(video as React). Two formats:

- **AdLandscape** — 1920×1080, 25s (web / landing / YouTube)
- **AdVertical** — 1080×1920, 20s (Reels / TikTok / Shorts)

## Render

```bash
cd ad
npm install                 # first time
npm run render              # both formats -> ad/out/*.mp4
# or individually:
npm run render:landscape
npm run render:vertical
```

Preview and tweak live:

```bash
npm run studio
```

## Where the footage comes from

The scenes composite real app screenshots from `public/shots/`. Regenerate them
(at full resolution, including the Peak Season menu and mobile screens) with the
Playwright capture in the repo root:

```bash
cd ..
npx playwright test ad-shots
```

That boots the app in dev mode and saves crisp PNGs into `ad/public/shots/`.

## Editing

- Copy, scene order, and durations live in `src/Ad.tsx` (`buildScenes`).
- Brand colors and font in `src/brand.ts` (pulled from the app's CSS).
- Composition sizes/durations in `src/Root.tsx`.

## Music

No audio is included (nothing to fabricate rights for). To add a track, drop an
`mp3` in `public/` and add `<Audio src={staticFile("music.mp3")} />` near the top
of the `Ad` component in `src/Ad.tsx`. Use a track you have the rights to.

## Note on headshots

Player headshots come from NBA's CDN at runtime and don't load in the headless
browser used for capture, so they show as silhouettes in the stills. Team colors,
names, and real stats still render. To get real headshots, re-capture with a
headed browser that can reach `cdn.nba.com`.
