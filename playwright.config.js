const { defineConfig } = require("@playwright/test");

// Config for the draft-walkthrough recorder (see e2e/draft-walkthrough.spec.js).
// This is a recording tool, not a CI assertion suite.
module.exports = defineConfig({
  testDir: "./e2e",
  timeout: 10 * 60 * 1000,
  expect: { timeout: 20000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    viewport: { width: 1280, height: 720 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // Dev mode on purpose. With NODE_ENV=production and no Turnstile secret,
  // the server rejects every socket with HUMAN_VERIFICATION_NOT_CONFIGURED
  // (see server/src/middleware/socketSecurity.js). dotenv does not override
  // an env var already set in the environment, so setting NODE_ENV here flips
  // the server onto its no-verification dev path without editing any .env.
  webServer: {
    command: "cross-env NODE_ENV=development npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 180000,
  },
});
