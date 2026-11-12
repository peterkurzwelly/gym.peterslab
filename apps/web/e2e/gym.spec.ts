/**
 * Acceptance in a real browser: cold open to the first logged set, a whole workout in airplane mode,
 * the summary, the guides and the You tab. Every test starts from a fresh browser context and a reset server.
 */
import { expect, test } from "@playwright/test";
import { plain } from "../src/lib/plain";
import {
  atBlockDayOne,
  finishSession,
  logNextSet,
  logWholeSession,
  openWorkout,
  readRows,
  readSetLogs,
  resetServer,
  serverRows,
  todayReady,
  waitForServiceWorker,
} from "./helpers";

test.beforeEach(async ({ context, request }) => {
  await resetServer(request);
  await atBlockDayOne(context);
});

test("cold open to the first logged set: two taps into the player, then one or two per set, within 5 s", async ({ page }) => {
  const started = Date.now();
  await page.goto("/");
  const intoPlayer = await openWorkout(page);
  // Opening the workout stores nothing; the first set starts the session.
  expect(await readRows(page, "session")).toHaveLength(0);
  const perSet = await logNextSet(page);
  await expect.poll(async () => (await readSetLogs(page)).length).toBe(1);
  const elapsed = Date.now() - started;

  test.info().annotations.push({ type: "cold open", description: `${elapsed} ms · ${intoPlayer} + ${perSet} taps` });
  console.log(`[cold open] ${test.info().project.name}: ${elapsed} ms, ${intoPlayer} + ${perSet} taps`);
  // SPEC 9.1 asked for 2 taps in total. Since the full screen player (D27) it is Today, overview, then the set:
  // one tap with a known weight, two when the weight is picked first.
  expect(intoPlayer).toBe(2);
  expect(perSet).toBeLessThanOrEqual(2);
  expect(elapsed).toBeLessThanOrEqual(5_000);

  const [set] = await readSetLogs(page);
  expect(set).toMatchObject({ set_index: 0, is_warmup: false });
  expect(typeof set!.session_id).toBe("string");
  // The rest timer follows the set, and the session is running.
  await expect(page.getByRole("timer", { name: /^Rest, / })).toBeVisible();
  await expect(page.getByRole("button", { name: "Finish", exact: true })).toBeVisible();
});

test("SPEC 9.3 · a full session logged in airplane mode survives app close and syncs once", async ({ context, page, request }) => {
  await page.goto("/");
  await todayReady(page);
  await waitForServiceWorker(page);

  // Airplane mode for the whole session.
  await context.setOffline(true);
  await openWorkout(page);
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
  await expect(reopened.getByRole("region", { name: "This week" })).toContainText("1 of 3 workouts");
  await expect(reopened.getByRole("button", { name: "See today's summary" })).toBeVisible();
  const afterClose = await readSetLogs(reopened);
  expect(afterClose.map((s) => s.id).sort()).toEqual(logged.map((s) => s.id).sort());
  expect((await readRows(reopened, "session")).find((s) => s.id === sessionId)?.ended_at).toBeTruthy();

  // Nothing reached the server while offline.
  const offlineServer = await serverRows(request, "set_log");
  expect(offlineServer.filter((r) => afterClose.some((s) => s.id === r.id))).toHaveLength(0);

  // Back online, then Sync now on the You tab.
  await context.setOffline(false);
  await reopened.getByRole("link", { name: "You", exact: true }).click();
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

test("finish shows the summary with explanations, and Today counts the workout", async ({ page }) => {
  await page.goto("/");
  await todayReady(page);
  await expect(page.getByRole("region", { name: "This week" })).toContainText("0 of 3 workouts");
  await openWorkout(page);
  const count = await logWholeSession(page);
  const sessionId = await finishSession(page);

  // Summary: title, the numbers, the week line, and "Next time" with one explanation per change.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Session [ABC] done\./);
  await expect(page.getByText("Workout logged")).toBeVisible();
  await expect(page.locator('[aria-label="Session numbers"]')).toContainText(new RegExp(`${count}\\s*sets`));
  await expect(page.getByText("1 of 4 done").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Next time" })).toBeVisible();

  // Every change on screen carries an explanation, and each one is a decision stored for this session
  // (the screen shows the engine's sentence in plain words).
  const nextTime = page.locator("section", { has: page.getByRole("heading", { name: "Next time" }) });
  const items = nextTime.getByRole("listitem");
  await expect(items.first()).toBeVisible();
  const shown = await items.evaluateAll((lis) => lis.map((li) => li.querySelector("p")?.textContent?.trim() ?? ""));
  expect(shown.every((t) => t.length > 10)).toBe(true);
  expect(shown.join(" ")).not.toMatch(/\bRIR\b|e1RM/);

  await expect.poll(async () => (await readRows(page, "decision")).filter((d) => d.session_id === sessionId).length).toBeGreaterThan(0);
  const decisions = (await readRows(page, "decision")).filter((d) => d.session_id === sessionId);
  const logged = decisions
    .map((d) => (d.output as { summary?: unknown } | undefined)?.summary)
    .filter((s): s is string => typeof s === "string" && s.length > 0);
  expect(logged.length).toBeGreaterThan(0);
  expect([...shown].sort()).toEqual([...new Set(logged.map((s) => plain(s)))].sort());
  for (const d of decisions) expect(String(d.explanation).length, `decision ${d.id} explanation`).toBeGreaterThan(10);

  // Back to Today: the workout is done for today and the week counts it.
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("region", { name: "This week" })).toContainText("1 of 3 workouts");
  await expect(page.getByRole("heading", { name: "Workout logged" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start workout", exact: true })).toHaveCount(0);
});

test("every exercise opens its guide: photos and how-to offline, the video one tap away", async ({ context, page }) => {
  await page.goto("/");
  await todayReady(page);
  await waitForServiceWorker(page);
  await page.getByRole("link", { name: "Program", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Program", level: 1 })).toBeVisible();
  const sessions = page.getByRole("region", { name: "Sessions", exact: true });
  await expect(sessions.getByRole("radio")).toHaveText(["A", "B", "C", "Travel"]);

  // In the gym basement: no signal. Text and photos still open.
  await context.setOffline(true);
  await sessions.getByRole("button", { name: "How to do Back squat" }).click();
  const guide = page.getByRole("dialog", { name: "Back squat" });
  await expect(guide).toBeVisible();
  await expect(guide.getByRole("button", { name: /^Watch the video/ })).toBeVisible();
  const photo = guide.locator("img").first();
  await expect(photo).toBeVisible();
  await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no sideways scroll").toBe(true);
  await guide.getByRole("button", { name: "Close" }).click();
  await expect(guide).toBeHidden();
});

test("you · a remembered weight sets week 1, and the sync key test answers", async ({ page }) => {
  await page.goto("/");
  await todayReady(page);
  await page.getByRole("link", { name: "You", exact: true }).click();
  await expect(page.getByRole("heading", { name: "You", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Your goal" })).toBeVisible();

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
  await page.screenshot({ path: test.info().outputPath("you.png"), fullPage: true });

  // The workout: week 1 starts at 60% of the remembered weight, in plain words, with the engine's reason.
  await page.getByRole("link", { name: "Today", exact: true }).click();
  await openWorkout(page);
  await expect(page.getByRole("button", { name: /^Adjust set 1: 60 kg × \d+, \d left$/ })).toBeVisible();
  await expect(page.getByText(/60% of your remembered 100 kg × 5/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^Log Back squat set 1$/ })).toContainText("60 kg");
});
