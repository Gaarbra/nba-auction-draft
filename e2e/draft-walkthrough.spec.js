// Records a full 4-player auction draft as a video (host's point of view).
//
// One browser, four contexts: a host that creates a private room and three
// bots that join by code. The host context records video; the bots just drive
// the game. All four run the same reactive loop (drivePage): assign when you
// win, raise during the first few nominations to show a real bidding war, then
// pass to keep the rest moving. Output lands in e2e/recordings/ as .webm and,
// when ffmpeg is available, .mp4.
//
// The draft terminates deterministically: outside the showcase rounds everyone
// passes, so the nominator (the opening bid holder at 1 coin) wins their own
// nomination and fills their own roster, 20 picks total.

const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const RECORDINGS_DIR = path.join(__dirname, "recordings");
const SIZE = { width: 1280, height: 720 };
const HOST_NAME = "Gabriel";
const BOT_NAMES = ["Marcus", "Priya", "Diego"];
const SHOWCASE_ROUNDS = 3; // first N nominations get a scripted bid war
const RAISE_CAP = 6; // stop raising once a showcase bid climbs this high

async function dismissConsent(page) {
  try {
    await page.getByRole("button", { name: "No thanks" }).click({ timeout: 4000 });
  } catch {
    // Consent modal not shown (already answered, or storage carried over).
  }
}

async function joinPrivate(page, name, code) {
  await page.locator(".mode-toggle button", { hasText: "Private" }).click();
  await page.locator(".private-submode-toggle button", { hasText: "Join with Code" }).click();
  await page.getByLabel("Your Name").fill(name);
  await page.getByPlaceholder("AB12C").fill(code);
  await page.getByRole("button", { name: "Join Room" }).click();
}

async function readRound(page) {
  const txt = await page.locator(".meta-chip-round").first().textContent().catch(() => null);
  const m = txt && txt.match(/Round\s+(\d+)/);
  return m ? Number(m[1]) : null;
}

async function readCurrentBid(page) {
  const txt = await page.locator(".current-bid strong").first().textContent().catch(() => null);
  const m = txt && txt.match(/(\d+)/);
  return m ? Number(m[1]) : 1;
}

// One player's reactive loop. Polls visible state and acts when it's this
// player's turn to do something. Returns once the results screen is up.
async function drivePage(page, deadline) {
  const raisedThisRound = new Set();
  while (Date.now() < deadline) {
    if (await page.locator(".results-screen").count()) return;

    // I won the bid -> place the player (two-tap a slot, then clear any
    // position-mismatch / tight-budget guard dialog).
    const addSlot = page.locator('[aria-label^="Add to "]').first();
    if (await addSlot.isVisible().catch(() => false)) {
      await addSlot.click().catch(() => {});
      await page
        .locator('[aria-label^="Tap again to confirm "]')
        .first()
        .click({ timeout: 4000 })
        .catch(() => {});
      const lockIn = page.getByRole("button", { name: /lock in .* anyway/i }).first();
      if (await lockIn.isVisible().catch(() => false)) await lockIn.click().catch(() => {});
      await page.waitForTimeout(500);
      continue;
    }

    // I'm eligible to bid -> raise during the showcase rounds (once each),
    // otherwise pass so the nominator wins and the draft keeps moving.
    const raiseBtn = page.locator('.bid-controls button:has-text("Raise")').first();
    if (await raiseBtn.isVisible().catch(() => false)) {
      const round = await readRound(page);
      const bid = await readCurrentBid(page);
      const wantRaise =
        round !== null && round <= SHOWCASE_ROUNDS && !raisedThisRound.has(round) && bid < RAISE_CAP;
      if (wantRaise) {
        raisedThisRound.add(round);
        await raiseBtn.click().catch(() => {});
      } else {
        await page.locator('.bid-controls button:has-text("Pass")').first().click().catch(() => {});
      }
      await page.waitForTimeout(350);
      continue;
    }

    await page.waitForTimeout(250);
  }
}

function findFfmpeg() {
  // Prefer the bundled static ffmpeg (full build with H.264) so no system
  // install is needed; fall back to one on PATH.
  try {
    const bundled = require("ffmpeg-static");
    if (bundled && fs.existsSync(bundled)) return bundled;
  } catch {
    // ffmpeg-static not installed; try the system one below.
  }
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["ffmpeg"]);
  return probe.status === 0 ? "ffmpeg" : null;
}

test("record a 4-player draft walkthrough", async ({ browser }) => {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

  const hostContext = await browser.newContext({
    viewport: SIZE,
    recordVideo: { dir: RECORDINGS_DIR, size: SIZE },
  });
  const botContexts = await Promise.all(BOT_NAMES.map(() => browser.newContext({ viewport: SIZE })));

  const host = await hostContext.newPage();
  const bots = await Promise.all(botContexts.map((c) => c.newPage()));

  // Load every page and clear the analytics consent modal.
  await host.goto("/");
  await dismissConsent(host);
  await Promise.all(
    bots.map(async (b) => {
      await b.goto("/");
      await dismissConsent(b);
    })
  );

  // Host creates a private room.
  await host.locator(".mode-toggle button", { hasText: "Private" }).click();
  await host.getByLabel("Your Name").fill(HOST_NAME);
  await host.getByRole("button", { name: "Create Room" }).click();

  const code = (await host.locator(".room-code").first().textContent())
    .trim()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 5);
  expect(code, "room code should be 5 characters").toHaveLength(5);

  // Three others join by code.
  for (let i = 0; i < bots.length; i += 1) await joinPrivate(bots[i], BOT_NAMES[i], code);

  // Host waits for everyone to show up, then starts the draft.
  for (const name of BOT_NAMES) {
    await expect(host.getByText(name, { exact: false }).first()).toBeVisible({ timeout: 20000 });
  }
  await host.waitForTimeout(800);
  await host.getByRole("button", { name: "Start Draft" }).click();

  // Drive all four players until the results screen appears.
  const deadline = Date.now() + 8 * 60 * 1000;
  await Promise.all([host, ...bots].map((p) => drivePage(p, deadline)));

  // Linger on the host's results so the recording ends on the payoff.
  await expect(host.locator(".results-screen")).toBeVisible({ timeout: 10000 });
  await host.waitForTimeout(1500);
  await host.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }));
  await host.waitForTimeout(2500);
  await host.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await host.waitForTimeout(1500);

  // Finalize the host video (saved on context close), then clean up the bots.
  const video = host.video();
  await hostContext.close();
  await Promise.all(botContexts.map((c) => c.close()));

  const raw = await video.path();
  const webm = path.join(RECORDINGS_DIR, "draft-walkthrough.webm");
  fs.copyFileSync(raw, webm);
  console.log(`\nSaved WebM: ${webm}`);

  const mp4 = path.join(RECORDINGS_DIR, "draft-walkthrough.mp4");
  const ffmpeg = findFfmpeg();
  if (ffmpeg) {
    const res = spawnSync(
      ffmpeg,
      ["-y", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4],
      { stdio: "inherit" }
    );
    if (res.status === 0) console.log(`Saved MP4:  ${mp4}`);
    else console.log("MP4 conversion failed; the WebM above is still usable.");
  } else {
    console.log("No ffmpeg found; kept WebM only. `npm i -D ffmpeg-static` to get MP4.");
  }
});
