#!/usr/bin/env node
/**
 * Web server for the Playwright e2e run (apps/web/playwright.config.ts → webServer):
 *   1. builds the PWA (vite build; typechecking is `npm run typecheck`, not the e2e's job)
 *   2. applies the D1 migrations to a fresh local database in apps/web/e2e/.state
 *   3. runs `wrangler dev --port 8787` from the repo root: static assets + /api, like production
 *
 * The root .dev.vars sets DEV_ALLOW_ALL=true, so /api accepts the tests without a sync key.
 * The local database is wiped on every run and never touches .wrangler/state (your own dev data).
 * SIGINT / SIGTERM stop wrangler and its workerd children.
 *
 * Env: E2E_SKIP_BUILD=1 reuses apps/web/dist. E2E_PORT overrides 8787.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, "..");
const root = resolve(web, "..", "..");
const state = join(web, "e2e", ".state");
const port = process.env.E2E_PORT ?? "8787";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function step(label, cmd, args, cwd) {
  console.log(`[e2e-server] ${label}`);
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" } });
  if (r.status !== 0) {
    console.error(`[e2e-server] ${label} exited with ${r.status ?? r.signal}`);
    process.exit(r.status ?? 1);
  }
}

if (!existsSync(join(root, ".dev.vars"))) {
  console.error("[e2e-server] .dev.vars with DEV_ALLOW_ALL=true is missing in the repo root. The API would refuse the tests.");
  process.exit(1);
}

if (process.env.E2E_SKIP_BUILD !== "1") step("vite build", npx, ["vite", "build", "--logLevel", "warn"], web);

rmSync(state, { recursive: true, force: true });
step("d1 migrations (fresh local db)", npx, ["wrangler", "d1", "migrations", "apply", "DB", "--local", "--persist-to", state], root);

console.log(`[e2e-server] wrangler dev on :${port}`);
// Same process group as this script (not detached): Playwright stops the webServer by signalling the
// whole group, which reaches npx, wrangler and workerd too. Nothing is left on the port afterwards.
const child = spawn(npx, ["wrangler", "dev", "--port", port, "--ip", "127.0.0.1", "--persist-to", state, "--show-interactive-dev-session=false", "--log-level", "warn"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" },
});

let stopping = false;
const stop = (signal) => {
  if (stopping) return;
  stopping = true;
  child.kill(signal);
  setTimeout(() => {
    child.kill("SIGKILL");
    process.exit(0);
  }, 4000).unref();
};
for (const s of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(s, () => stop("SIGTERM"));
child.on("exit", (code, signal) => {
  if (!stopping) console.error(`[e2e-server] wrangler dev stopped (${code ?? signal})`);
  process.exit(code ?? 0);
});
