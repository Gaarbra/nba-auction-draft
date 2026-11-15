# Draft-walkthrough recorder

Records a full 4-player auction draft as a video (the host's point of view),
for demos / portfolio use.

## Run

```bash
npm run record:walkthrough
```

Output lands in `e2e/recordings/` (gitignored):

- `draft-walkthrough.webm` — Playwright's native recording
- `draft-walkthrough.mp4` — H.264 copy (converted with the bundled `ffmpeg-static`, no system ffmpeg needed)

First run only: install the browser once with `npx playwright install chromium`.

## How it works

One Chromium browser, four contexts: a host that creates a private room plus
three bots that join by code. Only the host context records video; the bots
just drive the game. All four run the same reactive loop (`drivePage` in
`draft-walkthrough.spec.js`): assign when you win, raise during the first few
nominations to show a real bidding war, then pass so the rest moves quickly.
It ends on the results screen, lingers, then saves the video. Runtime is a few
minutes (one real NBA stats lookup per reveal, served from the local cache).

## Notes

- The config's `webServer` boots the whole stack with `NODE_ENV=development`
  on purpose. In production mode with no Turnstile secret the server rejects
  every socket (`HUMAN_VERIFICATION_NOT_CONFIGURED`); dev mode skips that
  human-check so the automated run can connect. No `.env` is touched.
- Stop any already-running `npm run dev` before recording, so the recorder
  starts its own dev-mode server instead of reusing a production-mode one.
- Tune the cast, the number of scripted bid-war rounds (`SHOWCASE_ROUNDS`),
  and the viewport at the top of `draft-walkthrough.spec.js` and in
  `playwright.config.js`.
