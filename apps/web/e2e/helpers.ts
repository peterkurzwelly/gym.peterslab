/** Shared steps for the e2e specs. They drive the real UI by accessible names, like Peter's thumb. */
import { expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

/** Monday of block week 1, 08:00 in Stockholm: the morning Peter starts. Time keeps flowing from here. */
export const BLOCK_DAY_ONE = new Date("2026-11-09T08:00:00+01:00");

/** The player's one big dock button: "Log Back squat set 2", "Pick weight for Plank set 1", "Log Bench press top set". */
export const LOG_SET = /^(Log|Pick weight for) .+ (set \d+|top set)$/;

/** Fresh server state for this test: every live row soft deleted (POST /api/import?mode=replace with nothing). */
export async function resetServer(request: APIRequestContext): Promise<void> {
  const res = await request.post("/api/import?mode=replace", {
    data: { format: "workout-os-export", version: 1, exported_at: new Date().toISOString(), tables: {} },
  });
  expect(res.ok(), `reset server: ${res.status()} ${await res.text()}`).toBe(true);
}

/** Pin the page clock to block day one (all pages of the context, now and later). */
export async function atBlockDayOne(context: BrowserContext): Promise<void> {
  await context.clock.install({ time: BLOCK_DAY_ONE });
}

interface RowLike {
  id: string;
  deleted_at: string | null;
  [k: string]: unknown;
}

/** Live (not soft deleted) rows of one Dexie table, read straight from IndexedDB. */
export async function readRows(page: Page, table: string): Promise<RowLike[]> {
  return page.evaluate(async (store) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("workout-os");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      if (!db.objectStoreNames.contains(store)) return [];
      const rows = await new Promise<unknown[]>((resolve, reject) => {
        const q = db.transaction(store, "readonly").objectStore(store).getAll();
        q.onsuccess = () => resolve(q.result);
        q.onerror = () => reject(q.error);
      });
      return (rows as { deleted_at: string | null }[]).filter((r) => !r.deleted_at) as never;
    } finally {
      db.close();
    }
  }, table);
}

export const readSetLogs = (page: Page) => readRows(page, "set_log");

/** Server rows of one table from GET /api/export (soft deleted rows included). */
export async function serverRows(request: APIRequestContext, table: string): Promise<RowLike[]> {
  const res = await request.get("/api/export");
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { tables: Record<string, RowLike[] | undefined> };
  return body.tables[table] ?? [];
}

/** Today is ready: the hero offers the next workout. */
export async function todayReady(page: Page) {
  const start = page.getByRole("button", { name: "Start workout", exact: true });
  await start.waitFor({ state: "visible" });
  return start;
}

/**
 * From Today into the player: Start workout on the hero, then Start workout under the overview.
 * Returns the taps used (2). Nothing is stored until the first set is logged.
 */
export async function openWorkout(page: Page): Promise<number> {
  await (await todayReady(page)).click();
  await page.waitForURL(/\/workout$/);
  await page.getByRole("heading", { level: 1 }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Start workout", exact: true }).click();
  await page.getByRole("button", { name: LOG_SET }).waitFor({ state: "visible" });
  return 2;
}

/**
 * Logs one set the way Peter does: tap the big button. A calibration set (no weight yet) opens the inline
 * steppers at a start weight, so the second tap is Done. Returns the taps used.
 */
export async function logNextSet(page: Page): Promise<number> {
  const before = (await readSetLogs(page)).length;
  const btn = page.getByRole("button", { name: LOG_SET });
  const label = (await btn.getAttribute("aria-label")) ?? "";
  await btn.click();
  let taps = 1;
  if (label.startsWith("Pick weight")) {
    await page.getByRole("button", { name: "Done", exact: true }).click();
    taps++;
  }
  await expect.poll(async () => (await readSetLogs(page)).length).toBe(before + 1);
  return taps;
}

/** Logs every set of the session in the player, until the dock offers the finish. Returns how many sets were logged. */
export async function logWholeSession(page: Page): Promise<number> {
  const finish = page.getByRole("button", { name: "Finish workout", exact: true });
  const log = page.getByRole("button", { name: LOG_SET });
  let logged = 0;
  for (;;) {
    await expect(finish.or(log)).toBeVisible();
    if (await finish.isVisible()) return logged;
    await logNextSet(page);
    logged++;
    if (logged > 80) throw new Error("more sets than any session has");
  }
}

/** Finish from the dock once every set is logged (or early, through the sheet); lands on the summary. */
export async function finishSession(page: Page): Promise<string> {
  const all = page.getByRole("button", { name: "Finish workout", exact: true });
  if (await all.isVisible()) await all.click();
  else {
    await page.getByRole("button", { name: "Finish", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Finish", exact: true }).click();
  }
  await page.waitForURL(/\/summary\/[^/]+$/);
  return page.url().split("/summary/")[1]!;
}

/** Waits until the service worker controls the page, so the app shell opens offline. */
export async function waitForServiceWorker(page: Page): Promise<void> {
  await page.waitForFunction(
    async () => {
      if (!("serviceWorker" in navigator)) return false;
      await navigator.serviceWorker.ready;
      return !!navigator.serviceWorker.controller;
    },
    undefined,
    { timeout: 20_000 },
  );
}
