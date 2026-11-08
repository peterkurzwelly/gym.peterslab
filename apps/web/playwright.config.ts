import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against the real stack: built PWA + Hono API + local D1, served by `wrangler dev` on :8787
 * (apps/web/scripts/e2e-server.mjs). Run: `npm run e2e` from the repo root.
 *
 * Tests share one server and reset it at the start, so they run one at a time (workers: 1).
 * WebKit on an iPhone 15 profile is the primary project; Chromium mobile second.
 */
const PORT = Number(process.env.E2E_PORT ?? 8787);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "e2e/.report" }]] : [["list"]],
  use: {
    baseURL,
    locale: "en-GB",
    timezoneId: "Europe/Stockholm",
    serviceWorkers: "allow",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "webkit-iphone", use: { ...devices["iPhone 15"] } },
    { name: "chromium-mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: `${baseURL}/api/health`,
    timeout: 180_000,
    // Never reuse: the tests wipe the server, and a running dev server holds your own local data.
    reuseExistingServer: false,
    // SIGTERM to the server's process group (node → npx → wrangler → workerd), SIGKILL after 5 s.
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    stdout: "pipe",
    stderr: "pipe",
    env: { E2E_PORT: String(PORT) },
  },
});
