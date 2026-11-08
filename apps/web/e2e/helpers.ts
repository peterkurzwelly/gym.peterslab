/** Shared steps for the e2e specs. They drive the real UI by accessible names, like Peter's thumb. */
import { expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

/** Monday of block week 1, 08:00 in Stockholm: the morning Peter starts. Time keeps flowing from here. */
export const BLOCK_DAY_ONE = new Date("2026-11-09T08:00:00+01:00");

/** A pending set's check button on an exercise card: "Confirm set 2", "Pick weight for set 1", "Confirm top set". */
export const SET_CHECK = /^(Confirm|Pick weight for) (set \d+|top set)$/;

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

/** The Today screen is ready to log: the first pending set's check button. */
export async function firstSetCheck(page: Page) {
  const btn = page.getByRole("button", { name: SET_CHECK }).first();
  await btn.waitFor({ state: "visible" });
  return btn;
}

/**
 * Logs one set the way Peter does: tap the check. A calibration set (no weight yet) opens the inline
 * editor at a start weight, so the second tap is Done. Returns the taps used.
 */
export async function logNextSet(page: Page): Promise<number> {
  const pending = page.getByRole("button", { name: SET_CHECK });
  const before = await pending.count();
  const btn = pending.first();
  const label = (await btn.getAttribute("aria-label")) ?? "";
  await btn.click();
  let taps = 1;
  if (label.startsWith("Pick weight")) {
    await page.getByRole("button", { name: "Done", exact: true }).click();
    taps++;
  }
  await expect(pending).toHaveCount(before - 1);
  return taps;
}

/** Logs every set of the session shown on Today. Returns how many sets were logged. */
export async function logWholeSession(page: Page): Promise<number> {
  await firstSetCheck(page);
  let logged = 0;
  while ((await page.getByRole("button", { name: SET_CHECK }).count()) > 0) {
    await logNextSet(page);
    logged++;
    if (logged > 80) throw new Error("more sets than any session has");
  }
  return logged;
}

/** Finish from the dock; lands on the summary. */
export async function finishSession(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Finish", exact: true }).click();
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
