/**
 * Phase 1 acceptance in a real browser (SPEC 9): cold open to first set, airplane mode, finish summary.
 * Every test starts from a fresh browser context and a reset server.
 */
import { expect, test } from "@playwright/test";
import {
  atBlockDayOne,
  finishSession,
  firstSetCheck,
  logNextSet,
  logWholeSession,
  readRows,
  readSetLogs,
  resetServer,
  serverRows,
  waitForServiceWorker,
} from "./helpers";

test.beforeEach(async ({ context, request }) => {
  await resetServer(request);
  await atBlockDayOne(context);
});

test("SPEC 9.1 · cold open to the first logged set in ≤ 2 taps and ≤ 5 s", async ({ page }) => {
  const started = Date.now();
  await page.goto("/");
  await firstSetCheck(page);
  const taps = await logNextSet(page);
  await expect.poll(async () => (await readSetLogs(page)).length).toBe(1);
  const elapsed = Date.now() - started;

  test.info().annotations.push({ type: "cold open", description: `${elapsed} ms · ${taps} taps` });
  console.log(`[cold open] ${test.info().project.name}: ${elapsed} ms, ${taps} taps`);
  expect(taps).toBeLessThanOrEqual(2);
  expect(elapsed).toBeLessThanOrEqual(5_000);

  const [set] = await readSetLogs(page);
  expect(set).toMatchObject({ set_index: 0, is_warmup: false });
  expect(typeof set!.session_id).toBe("string");
});

test("SPEC 9.3 · a full session logged in airplane mode survives app close and syncs once", async ({ context, page, request }) => {
  await page.goto("/");
  await firstSetCheck(page);
  await waitForServiceWorker(page);

  // Airplane mode for the whole session.
  await context.setOffline(true);
  const count = await logWholeSession(page);
  expect(count).toBeGreaterThanOrEqual(6);
  const sessionId = await finishSession(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("done.");

  const logged = await readSetLogs(page);
  expect(logged).toHaveLength(count);
  expect(new Set(logged.map((s) => s.session_id))).toEqual(new Set([sessionId]));

  // App close: the page goes away, a new one opens offline from the service worker.
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto("/");
  await expect(reopened.getByText(/1 of 4 done/).first()).toBeVisible();
  const afterClose = await readSetLogs(reopened);
  expect(afterClose.map((s) => s.id).sort()).toEqual(logged.map((s) => s.id).sort());
  expect((await readRows(reopened, "session")).find((s) => s.id === sessionId)?.ended_at).toBeTruthy();

  // Nothing reached the server while offline.
  const offlineServer = await serverRows(request, "set_log");
  expect(offlineServer.filter((r) => afterClose.some((s) => s.id === r.id))).toHaveLength(0);

  // Back online, then Sync now in Settings.
  await context.setOffline(false);
  await reopened.getByRole("link", { name: "Settings" }).click();
  await reopened.getByRole("button", { name: "Sync now" }).click();
  await expect(reopened.getByText("Nothing waiting")).toBeVisible({ timeout: 20_000 });

  const ids = afterClose.map((s) => s.id);
  await expect
    .poll(async () => {
      const rows = await serverRows(request, "set_log");
      return ids.filter((id) => rows.some((r) => r.id === id && !r.deleted_at)).length;
    })
    .toBe(ids.length);

  // Exactly once each, with the values logged on the phone.
  const server = await serverRows(request, "set_log");
  for (const local of afterClose) {
    const copies = server.filter((r) => r.id === local.id);
    expect(copies, `set ${local.id}`).toHaveLength(1);
    expect(copies[0]).toMatchObject({ session_id: sessionId, weight: local.weight, reps: local.reps, rir: local.rir, deleted_at: null });
  }
  const sessions = await serverRows(request, "session");
  expect(sessions.filter((s) => s.id === sessionId)).toHaveLength(1);
});

test("finish shows the summary with explanations, and the week card counts the session", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("0 of 4 done").first()).toBeVisible();
  const count = await logWholeSession(page);
  const sessionId = await finishSession(page);

  // Summary: title, the week line, and "Next time" with one explanation per change.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Session [ABC] done\./);
  await expect(page.getByText(`${count} sets`, { exact: false }).first()).toBeVisible();
  await expect(page.getByText("1 of 4 done").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Next time" })).toBeVisible();

  // Every change on screen carries an explanation, and each one is a decision stored for this session.
  const nextTime = page.locator("section", { has: page.getByRole("heading", { name: "Next time" }) });
  const items = nextTime.getByRole("listitem");
  await expect(items.first()).toBeVisible();
  const shown = await items.evaluateAll((lis) => lis.map((li) => li.querySelector("p")?.textContent?.trim() ?? ""));
  expect(shown.every((t) => t.length > 10)).toBe(true);

  await expect.poll(async () => (await readRows(page, "decision")).filter((d) => d.session_id === sessionId).length).toBeGreaterThan(0);
  const decisions = (await readRows(page, "decision")).filter((d) => d.session_id === sessionId);
  const logged = decisions
    .map((d) => (d.output as { summary?: unknown } | undefined)?.summary)
    .filter((s): s is string => typeof s === "string" && s.length > 0);
  expect(logged.length).toBeGreaterThan(0);
  expect([...shown].sort()).toEqual([...new Set(logged)].sort());
  for (const d of decisions) expect(String(d.explanation).length, `decision ${d.id} explanation`).toBeGreaterThan(10);

  // Back to Today: the week card shows the session.
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  const week = page.getByLabel(/^Week 1 of 12\./);
  await expect(week).toContainText("1 of 4 done");
});

test("settings · a remembered weight sets week 1, and the sync key test answers", async ({ page }) => {
  await page.goto("/");
  await firstSetCheck(page);
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();

  // Back squat 100 × 5 remembered. The number is typed: the keyboard only opens on a tap.
  await page.getByRole("button", { name: "Back squat: not set. Edit" }).click();
  await page.getByRole("button", { name: /^Weight 60 kg\. Tap to type$/ }).click();
  const weight = page.getByRole("textbox", { name: "Weight" });
  await expect(weight).toHaveAttribute("inputmode", "decimal");
  await weight.fill("100");
  await weight.press("Enter");
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Decrease reps" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Back squat: 100 kg × 5. Edit" })).toBeVisible();

  // The dev server accepts every request; the test says so in plain words.
  await page.getByLabel("Sync key").fill("local-e2e-key");
  await page.getByRole("button", { name: "Test", exact: true }).click();
  await expect(page.getByText(/Local dev server/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no sideways scroll").toBe(true);
  await page.screenshot({ path: test.info().outputPath("settings.png"), fullPage: true });

  // Today: week 1 starts at 60% of the remembered weight, with the engine's reason.
  await page.getByRole("link", { name: "Today" }).click();
  await expect(page.getByRole("button", { name: /^Adjust set 1: 60 kg × \d+ at RIR \d$/ }).first()).toBeVisible();
  await expect(page.getByText(/60% of your remembered 100 kg × 5/).first()).toBeVisible();
});
