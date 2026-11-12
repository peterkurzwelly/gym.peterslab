/**
 * Body and fuel in the data layer, against the REAL engine (no mock): repo writes, useBody / useBodyLogs,
 * and settings edits with the body fields.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { BodyLog as BodyLogSchema, Settings as SettingsSchema, type BodyLog } from "@gym/schema";
import { db } from "../../src/data/db";
import { setClock } from "../../src/data/clock";
import * as repo from "../../src/data/repo";
import * as data from "../../src/data";
import { useBody, useBodyLogs, useSettings } from "../../src/data/hooks";
import { outboxKeys, resetDb } from "./helpers";

const DAY = "2026-11-10";
/** 11:00 in Stockholm on DAY. */
const T0 = "2026-11-10T10:00:00.000Z";
const T1 = "2026-11-10T10:05:00.000Z";

beforeEach(async () => {
  await resetDb();
  setClock(() => T0);
});
afterEach(() => {
  cleanup();
  setClock(null);
});

const PROFILE = { sex: "male", birth_year: 1986, height_cm: 180, job_activity: "desk", goal: "cut", cut_rate_pct: 0.5 } as const;

/** Moves the shared clock and ticks it the way the app does when it becomes visible. */
function tick(iso: string) {
  setClock(() => iso);
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

describe("saveBodyLog", () => {
  it("creates one row per local date with a deterministic id, validates it and queues it", async () => {
    const row = await repo.saveBodyLog(DAY, { weight_kg: 84.6 });
    expect(row).toEqual({
      id: `bd_${DAY}`,
      date: DAY,
      weight_kg: 84.6,
      waist_cm: null,
      steps: null,
      protein_g: null,
      kcal: null,
      sleep_h: null,
      note: null,
      updated_at: T0,
      deleted_at: null,
    });
    expect(BodyLogSchema.parse(row)).toEqual(row);
    expect(await db.body_log.get(`bd_${DAY}`)).toEqual(row);
    expect(await outboxKeys()).toEqual([`body_log/bd_${DAY}`]);
  });

  it("merges into the day's row: left out fields stay, null clears, updated_at always moves forward", async () => {
    await repo.saveBodyLog(DAY, { weight_kg: 84.6, steps: 4000 });
    // The clock stands still: updated_at still increases, so last write wins stays correct.
    const second = await repo.saveBodyLog(DAY, { protein_g: 120, waist_cm: 91.5, sleep_h: 7.5, kcal: 1800, note: "  Good day.  " });
    expect(second).toMatchObject({ weight_kg: 84.6, steps: 4000, protein_g: 120, waist_cm: 91.5, sleep_h: 7.5, kcal: 1800, note: "Good day." });
    expect(second.updated_at > T0).toBe(true);
    const third = await repo.saveBodyLog(DAY, { weight_kg: null, steps: undefined, note: "   " });
    expect(third).toMatchObject({ weight_kg: null, steps: 4000, protein_g: 120, note: null });
    expect(third.updated_at > second.updated_at).toBe(true);
    expect(await db.body_log.count()).toBe(1);
    // Every write is queued; sync sends the row once.
    expect(await outboxKeys()).toEqual(Array(3).fill(`body_log/bd_${DAY}`));
  });

  it("keeps days apart", async () => {
    await repo.saveBodyLog("2026-11-09", { weight_kg: 85 });
    await repo.saveBodyLog(DAY, { weight_kg: 84.6 });
    expect((await db.body_log.orderBy("date").toArray()).map((r) => [r.id, r.weight_kg])).toEqual([
      ["bd_2026-11-09", 85],
      [`bd_${DAY}`, 84.6],
    ]);
  });

  it("refuses values outside the allowed ranges and writes nothing", async () => {
    const bad: [string, Parameters<typeof repo.saveBodyLog>[1]][] = [
      [DAY, { weight_kg: 20 }],
      [DAY, { weight_kg: 301 }],
      [DAY, { waist_cm: 10 }],
      [DAY, { steps: 12.5 }],
      [DAY, { steps: -1 }],
      [DAY, { protein_g: 600 }],
      [DAY, { kcal: 20000 }],
      [DAY, { sleep_h: 25 }],
      [DAY, { note: "x".repeat(501) }],
      ["10 Nov", { weight_kg: 85 }],
    ];
    for (const [date, patch] of bad) await expect(repo.saveBodyLog(date, patch), JSON.stringify(patch)).rejects.toThrow();
    expect(await db.body_log.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    // A refused edit leaves the stored row as it was.
    await repo.saveBodyLog(DAY, { weight_kg: 84.6 });
    await expect(repo.saveBodyLog(DAY, { weight_kg: 500, steps: 100 })).rejects.toThrow();
    expect(await db.body_log.get(`bd_${DAY}`)).toMatchObject({ weight_kg: 84.6, steps: null });
  });

  it("a soft deleted day starts over instead of bringing old values back", async () => {
    const first = await repo.saveBodyLog(DAY, { weight_kg: 84.6, protein_g: 150 });
    await db.body_log.put({ ...first, deleted_at: T1, updated_at: T1 });
    const again = await repo.saveBodyLog(DAY, { steps: 3000 });
    expect(again).toMatchObject({ weight_kg: null, protein_g: null, steps: 3000, deleted_at: null });
    expect(again.updated_at > T1).toBe(true);
  });

  it("keeps fields a newer version of the app added to the row", async () => {
    await db.body_log.put({ ...(await repo.saveBodyLog(DAY, { weight_kg: 84.6 })), body_fat_pct: 18 } as BodyLog);
    await repo.saveBodyLog(DAY, { steps: 100 });
    await repo.addToBodyLog(DAY, "steps", 50);
    expect(await db.body_log.get(`bd_${DAY}`)).toMatchObject({ weight_kg: 84.6, steps: 150, body_fat_pct: 18 });
  });
});

describe("addToBodyLog", () => {
  it("adds to the day's running total, starting from nothing", async () => {
    const first = await repo.addToBodyLog(DAY, "protein_g", 30);
    expect(first).toMatchObject({ id: `bd_${DAY}`, date: DAY, protein_g: 30, kcal: null, steps: null, weight_kg: null });
    expect((await repo.addToBodyLog(DAY, "protein_g", 42.5)).protein_g).toBe(72.5);
    expect((await repo.addToBodyLog(DAY, "kcal", 650)).kcal).toBe(650);
    expect((await repo.addToBodyLog(DAY, "steps", 2500)).steps).toBe(2500);
    const row = await db.body_log.get(`bd_${DAY}`);
    expect(row).toMatchObject({ protein_g: 72.5, kcal: 650, steps: 2500 });
    expect(await db.body_log.count()).toBe(1);
    expect(await outboxKeys()).toEqual(Array(4).fill(`body_log/bd_${DAY}`));
  });

  it("leaves the other fields alone", async () => {
    await repo.saveBodyLog(DAY, { weight_kg: 84.6, note: "Legs", steps: 1000 });
    expect(await repo.addToBodyLog(DAY, "steps", 500)).toMatchObject({ weight_kg: 84.6, note: "Legs", steps: 1500, protein_g: null });
  });

  it("takes away with a negative delta, never below 0", async () => {
    await repo.addToBodyLog(DAY, "protein_g", 40);
    expect((await repo.addToBodyLog(DAY, "protein_g", -15)).protein_g).toBe(25);
    expect((await repo.addToBodyLog(DAY, "protein_g", -100)).protein_g).toBe(0);
    expect((await repo.addToBodyLog(DAY, "kcal", -200)).kcal).toBe(0);
    expect((await repo.addToBodyLog("2026-11-11", "steps", -5)).steps).toBe(0);
  });

  it("never passes the schema maximum, keeps steps whole and sums without float noise", async () => {
    expect((await repo.addToBodyLog(DAY, "steps", 99_000)).steps).toBe(99_000);
    expect((await repo.addToBodyLog(DAY, "steps", 5000)).steps).toBe(100_000);
    expect((await repo.addToBodyLog(DAY, "protein_g", 900)).protein_g).toBe(500);
    expect((await repo.addToBodyLog(DAY, "kcal", 99_999)).kcal).toBe(10_000);
    expect((await repo.addToBodyLog("2026-11-11", "steps", 1200.4)).steps).toBe(1200);
    await repo.addToBodyLog("2026-11-11", "protein_g", 0.1);
    expect((await repo.addToBodyLog("2026-11-11", "protein_g", 0.2)).protein_g).toBe(0.3);
    await expect(repo.addToBodyLog(DAY, "protein_g", Number.NaN)).rejects.toThrow(/delta/);
  });

  it("taps in quick succession all count", async () => {
    await Promise.all(Array.from({ length: 6 }, () => repo.addToBodyLog(DAY, "protein_g", 25)));
    expect((await db.body_log.get(`bd_${DAY}`))?.protein_g).toBe(150);
    const stamps = (await db.body_log.toArray()).map((r) => r.updated_at);
    expect(stamps).toHaveLength(1);
  });
});

describe("settings with the body fields", () => {
  it("the seeded row carries the defaults and updateSettings takes the new fields", async () => {
    const seed = await repo.ensureSettings();
    expect(seed).toMatchObject({
      sex: null,
      birth_year: null,
      height_cm: null,
      job_activity: "desk",
      goal: "cut",
      cut_rate_pct: 0.5,
      goal_weight_kg: null,
      kcal_override: null,
      protein_override_g: null,
      steps_target: 8000,
    });
    const s = await repo.updateSettings({ ...PROFILE, goal_weight_kg: 80, steps_target: 10_000, kcal_override: 2100 });
    expect(s).toMatchObject({ ...PROFILE, goal_weight_kg: 80, steps_target: 10_000, kcal_override: 2100, protein_override_g: null });
    expect(SettingsSchema.parse(s)).toEqual(s);
    // Other settings are untouched by a body edit, and the other way round.
    const t = await repo.updateSettings({ sound: false });
    expect(t).toMatchObject({ ...PROFILE, sound: false, goal_weight_kg: 80 });
    expect((await repo.updateSettings({ kcal_override: null })).kcal_override).toBeNull();
    expect(await outboxKeys()).toEqual(Array(3).fill("settings/settings"));
  });

  it("refuses values outside the allowed ranges", async () => {
    await repo.updateSettings(PROFILE);
    await expect(repo.updateSettings({ cut_rate_pct: 2 })).rejects.toThrow();
    await expect(repo.updateSettings({ cut_rate_pct: 0.1 })).rejects.toThrow();
    await expect(repo.updateSettings({ steps_target: 1.5 })).rejects.toThrow();
    await expect(repo.updateSettings({ goal: "bulk" as never })).rejects.toThrow();
    expect(await db.settings.get("settings")).toMatchObject({ cut_rate_pct: 0.5, goal: "cut", steps_target: 8000 });
  });
});

describe("useBody", () => {
  it("is null while loading, then the engine's state; creates the settings row when missing", async () => {
    const { result } = renderHook(() => useBody());
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current).toMatchObject({
      today: DAY,
      profile_complete: false,
      missing: ["sex", "birth_year", "height_cm", "weight"],
      pace: "setup",
      log_today: null,
      series: [],
    });
    expect(result.current!.targets).toMatchObject({ kcal: null, steps: 8000, rule_id: "body.setup" });
    await waitFor(async () => expect(await db.settings.get("settings")).toBeDefined());
  });

  it("recomputes live when settings and logs change", async () => {
    const { result } = renderHook(() => useBody());
    await waitFor(() => expect(result.current).not.toBeNull());

    await act(async () => {
      await repo.updateSettings(PROFILE);
    });
    await waitFor(() => expect(result.current!.missing).toEqual(["weight"]));

    await act(async () => {
      await repo.saveBodyLog(DAY, { weight_kg: 85 });
    });
    await waitFor(() => expect(result.current!.weighed_today).toBe(true));
    // BMR 1780 × 1.4 = 2492, minus 467 for 0.5% a week, to the nearest 50.
    expect(result.current!.targets).toMatchObject({ kcal: 2050, protein_g: 170, maintenance_kcal: 2492, rule_id: "body.cut" });
    expect(result.current).toMatchObject({ profile_complete: true, pace: "collecting", latest_weight: 85, protein_today: 0, protein_hit: false });
    expect(result.current!.log_today).toMatchObject({ id: `bd_${DAY}`, weight_kg: 85 });

    await act(async () => {
      await repo.addToBodyLog(DAY, "protein_g", 100);
    });
    await waitFor(() => expect(result.current!.protein_today).toBe(100));
    expect(result.current!.protein_hit).toBe(false);
    await act(async () => {
      await repo.addToBodyLog(DAY, "protein_g", 60);
      await repo.addToBodyLog(DAY, "steps", 8200);
    });
    await waitFor(() => expect(result.current!.steps_hit).toBe(true));
    expect(result.current).toMatchObject({ protein_today: 160, protein_hit: true, steps_today: 8200 });

    await act(async () => {
      await repo.updateSettings({ kcal_override: 1900, steps_target: 10_000 });
    });
    await waitFor(() => expect(result.current!.targets.kcal).toBe(1900));
    expect(result.current!.targets.rule_id).toBe("body.kcal_override");
    expect(result.current!.steps_hit).toBe(false);
  });

  it("picks up rows that arrive through sync (no repo write)", async () => {
    await repo.updateSettings(PROFILE);
    const { result } = renderHook(() => useBody());
    await waitFor(() => expect(result.current).not.toBeNull());
    await act(async () => {
      await db.body_log.put({
        id: `bd_${DAY}`, date: DAY, weight_kg: 90, waist_cm: null, steps: null, protein_g: null, kcal: null, sleep_h: null, note: null,
        updated_at: T1, deleted_at: null,
      });
    });
    await waitFor(() => expect(result.current!.latest_weight).toBe(90));
    // A soft delete from another device takes it away again.
    await act(async () => {
      await db.body_log.update(`bd_${DAY}`, { deleted_at: "2026-11-10T10:06:00.000Z", updated_at: "2026-11-10T10:06:00.000Z" });
    });
    await waitFor(() => expect(result.current!.latest_weight).toBeNull());
  });

  it("rolls over with the local day, and keeps the same object while nothing changes", async () => {
    await repo.updateSettings(PROFILE);
    await repo.saveBodyLog(DAY, { weight_kg: 85, protein_g: 170 });
    const { result } = renderHook(() => useBody());
    await waitFor(() => expect(result.current?.weighed_today).toBe(true));
    const before = result.current;
    expect(before).toMatchObject({ today: DAY, protein_today: 170, protein_hit: true });

    // Later the same day: the clock ticks, the state object stays the same.
    tick("2026-11-10T20:00:00.000Z");
    expect(result.current).toBe(before);

    // 23:30 UTC is already the next day in Stockholm.
    tick("2026-11-10T23:30:00.000Z");
    await waitFor(() => expect(result.current!.today).toBe("2026-11-11"));
    expect(result.current).toMatchObject({ weighed_today: false, log_today: null, protein_today: 0, protein_hit: false, latest_weight: 85 });
    expect(result.current!.series.map((p) => p.date)).toEqual([DAY, "2026-11-11"]);
  });

  it("several components share one computed state", async () => {
    await repo.saveBodyLog(DAY, { weight_kg: 85 });
    const a = renderHook(() => useBody());
    const b = renderHook(() => useBody());
    await waitFor(() => expect(a.result.current?.latest_weight).toBe(85));
    await waitFor(() => expect(b.result.current?.latest_weight).toBe(85));
    expect(a.result.current).toBe(b.result.current);
  });
});

describe("useBodyLogs", () => {
  it("lists live rows oldest first, without soft deleted ones", async () => {
    const { result } = renderHook(() => useBodyLogs());
    expect(result.current).toEqual([]);
    await act(async () => {
      await repo.saveBodyLog(DAY, { weight_kg: 84.6 });
      await repo.saveBodyLog("2026-11-08", { weight_kg: 85.2 });
      await repo.saveBodyLog("2026-11-09", { steps: 7000 });
    });
    await waitFor(() => expect(result.current).toHaveLength(3));
    expect(result.current.map((r) => r.date)).toEqual(["2026-11-08", "2026-11-09", DAY]);
    await act(async () => {
      await db.body_log.update("bd_2026-11-09", { deleted_at: T1, updated_at: T1 });
    });
    await waitFor(() => expect(result.current.map((r) => r.date)).toEqual(["2026-11-08", DAY]));
  });
});

describe("barrel", () => {
  it("exports the body and fuel API", () => {
    expect(data.saveBodyLog).toBe(repo.saveBodyLog);
    expect(data.addToBodyLog).toBe(repo.addToBodyLog);
    expect(data.useBody).toBe(useBody);
    expect(data.useBodyLogs).toBe(useBodyLogs);
  });

  it("useSettings shows the body fields", async () => {
    await repo.updateSettings(PROFILE);
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current).toBeTruthy());
    expect(result.current).toMatchObject(PROFILE);
  });
});
