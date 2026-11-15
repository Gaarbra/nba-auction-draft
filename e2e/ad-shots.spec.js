// Captures crisp, purpose-shot stills of the app for the Remotion ad
// (ad/src). Not an assertion suite: every shot is best-effort so one missing
// screen never loses the rest. Output goes to ad/public/shots/.
//
// Desktop pass (1920x1080): lobby, game-mode menu (Peak Season), player-limit
// menu (up to 8), a live nomination reveal, and the results screen.
// Mobile pass (390x844 @3x): a solo draft's lobby, reveal, and results.

const { test } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

const SHOTS = path.join(__dirname, "..", "ad", "public", "shots");
const HOST = "Gabriel";

async function dismissConsent(page) {
  try {
    await page.getByRole("button", { name: "No thanks" }).click({ timeout: 4000 });
  } catch {
    /* not shown */
  }
}

async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  console.log(`shot: ${name}`);
}

async function assignFirstOpen(page) {
  const addSlot = page.locator('[aria-label^="Add to "]').first();
  if (!(await addSlot.isVisible().catch(() => false))) return false;
  await addSlot.click().catch(() => {});
  await page
    .locator('[aria-label^="Tap again to confirm "]')
    .first()
    .click({ timeout: 4000 })
    .catch(() => {});
  const lockIn = page.getByRole("button", { name: /lock in .* anyway/i }).first();
  if (await lockIn.isVisible().catch(() => false)) await lockIn.click().catch(() => {});
  return true;
}

test("desktop ad shots", async ({ browser }) => {
  const hostCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const botCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const host = await hostCtx.newPage();
  const bot = await botCtx.newPage();

  await host.goto("/");
  await dismissConsent(host);
  await host.waitForTimeout(1200);
  await shot(host, "desktop-lobby");

  // Create a private room.
  await host.locator(".mode-toggle button", { hasText: "Private" }).click();
  await host.getByLabel("Your Name").fill(HOST);
  await host.getByRole("button", { name: "Create Room" }).click();
  await host.waitForTimeout(800);

  // Game-mode menu open (shows Peak Season).
  try {
    await host.locator(".era-picker-label", { hasText: "Game mode" }).locator(".dropdown-trigger").click();
    await host.waitForTimeout(500);
    await shot(host, "desktop-modes");
    await host.keyboard.press("Escape");
  } catch (e) {
    console.log("modes shot skipped:", e.message);
  }

  // Player-limit menu open (shows up to 8).
  try {
    await host.locator(".era-picker-label", { hasText: "Player limit" }).locator(".dropdown-trigger").click();
    await host.waitForTimeout(500);
    await shot(host, "desktop-players");
    await host.keyboard.press("Escape");
  } catch (e) {
    console.log("players shot skipped:", e.message);
  }

  // One other player joins, host starts.
  const code = (await host.locator(".room-code").first().textContent()).trim().replace(/[^A-Z0-9]/g, "").slice(0, 5);
  await bot.goto("/");
  await dismissConsent(bot);
  await bot.locator(".mode-toggle button", { hasText: "Private" }).click();
  await bot.locator(".private-submode-toggle button", { hasText: "Join with Code" }).click();
  await bot.getByLabel("Your Name").fill("Marcus");
  await bot.getByPlaceholder("AB12C").fill(code);
  await bot.getByRole("button", { name: "Join Room" }).click();
  await host.getByText("Marcus").first().waitFor({ timeout: 15000 });
  await host.getByRole("button", { name: "Start Draft" }).click();

  // First nomination reveal (big player card).
  try {
    await host.locator(".active-nomination").first().waitFor({ timeout: 30000 });
    await host.waitForTimeout(1400); // let the reveal animation settle
    await shot(host, "desktop-reveal");
  } catch (e) {
    console.log("reveal shot skipped:", e.message);
  }

  // Drive both to completion (everyone passes -> nominator wins), shoot results.
  const deadline = Date.now() + 4 * 60 * 1000;
  async function drive(page) {
    while (Date.now() < deadline) {
      if (await page.locator(".results-screen").count()) return;
      if (await assignFirstOpen(page)) {
        await page.waitForTimeout(400);
        continue;
      }
      const pass = page.locator('.bid-controls button:has-text("Pass")').first();
      if (await pass.isVisible().catch(() => false)) {
        await pass.click().catch(() => {});
        await page.waitForTimeout(250);
        continue;
      }
      await page.waitForTimeout(250);
    }
  }
  await Promise.all([drive(host), drive(bot)]);

  try {
    // Wait for the ranked cards, not just .results-screen (which also matches
    // the "Crunching the numbers" computing state while scores are fetched).
    await host.locator(".results-team-card").first().waitFor({ timeout: 60000 });
    await host.waitForTimeout(1800);
    await shot(host, "desktop-results");
  } catch (e) {
    console.log("results shot skipped:", e.message);
  }

  await hostCtx.close();
  await botCtx.close();
});

test("mobile ad shots", async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();

  await page.goto("/");
  await dismissConsent(page);

  // Solo mode lobby.
  await page.locator(".mode-toggle button", { hasText: "Solo" }).click();
  await page.getByLabel("Your Name").fill(HOST);
  await page.waitForTimeout(600);
  await shot(page, "mobile-lobby");

  // Start the solo draft. The lobby button creates the solo room and lands on
  // the waiting room (RoomView); its own "Start Solo Draft" actually begins it.
  await page.getByRole("button", { name: "Start Solo Draft" }).click();
  await page.locator(".room-card").first().waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "Start Solo Draft" }).click();

  // First reveal/assign on mobile.
  try {
    await page.locator('[aria-label^="Add to "]').first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(1200);
    await shot(page, "mobile-reveal");
  } catch (e) {
    console.log("mobile reveal shot skipped:", e.message);
  }

  // Fill all five slots, then shoot results.
  const deadline = Date.now() + 3 * 60 * 1000;
  while (Date.now() < deadline) {
    if (await page.locator(".results-screen").count()) break;
    if (await assignFirstOpen(page)) {
      await page.waitForTimeout(600);
      continue;
    }
    await page.waitForTimeout(300);
  }

  try {
    await page.locator(".results-team-card").first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(1500);
    await shot(page, "mobile-results");
  } catch (e) {
    console.log("mobile results shot skipped:", e.message);
  }

  await ctx.close();
});
