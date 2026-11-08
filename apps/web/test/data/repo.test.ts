import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TableSchemas, type SyncTable } from "@gym/schema";

vi.mock("@gym/engine", async () => (await import("./engineMock")).engineMock);

import { db } from "../../src/data/db";
import { setClock } from "../../src/data/clock";
import * as repo from "../../src/data/repo";
import { engineMock, makeDecision, resetEngineMock } from "./engineMock";
import { outboxKeys, resetDb } from "./helpers";

const T0 = "2026-11-08T10:00:00.000Z";

beforeEach(async () => {
  await resetDb();
  resetEngineMock();
  setClock(null);
});
afterEach(() => setClock(null));

/** Runs a write and returns the outbox entries it added. */
async function added(fn: () => Promise<unknown>): Promise<string[]> {
  const before = await db.outbox.count();
  await fn();
  return (await outboxKeys()).slice(before);
}

describe("repo writes", () => {
  it("updateSettings on a fresh database creates the row and applies the patch in one transaction", async () => {
    // Regression: with a plain arrow as the transaction scope this threw PrematureCommitError.
    const s = await repo.updateSettings({ sound: false });
    expect(s.sound).toBe(false);
    expect((await db.settings.get("settings"))?.sound).toBe(false);
    expect(await outboxKeys()).toEqual(["settings/settings", "settings/settings"]);
  });

  it("every write enqueues an outbox entry for each row it changes", async () => {
    expect(await added(() => repo.ensureSettings())).toEqual(["settings/settings"]);
    expect(await added(() => repo.ensureSettings())).toEqual([]); // already there: no write
    expect(await added(() => repo.updateSettings({ sound: false }))).toEqual(["settings/settings"]);

    const s = await repo.startSession({ code: "A", mode: "full" });
    expect(await outboxKeys()).toContain(`session/${s.id}`);

    const set1 = await repo.logSet({
      sessionId: s.id, prescriptionId: "A1", exerciseId: "back_squat", setIndex: 0,
      target: { weight: 60, reps: 8, rir: 3 }, weight: 60, reps: 8, rir: 3,
    });
    const set2 = await repo.logSet({
      sessionId: s.id, prescriptionId: "A1", exerciseId: "back_squat", setIndex: 1,
      target: { weight: 60, reps: 8, rir: 3 }, weight: 60, reps: 7, rir: 2,
    });
    expect(await added(() => repo.updateSet(set1.id, { reps: 9 }))).toEqual([`set_log/${set1.id}`]);
    expect(await added(() => repo.setPain(s.id, "back_squat", true))).toEqual([`set_log/${set1.id}`, `set_log/${set2.id}`]);
    expect(await added(() => repo.deleteSet(set2.id))).toEqual([`set_log/${set2.id}`]);
    expect(await added(() => repo.swapExercise(s.id, "A2", "goblet_squat"))).toEqual([`session/${s.id}`]);

    // finishSession: session + one decision per logged exercise (from the engine).
    expect(await added(() => repo.finishSession(s.id))).toEqual([`session/${s.id}`, `decision/d:${s.id}:back_squat@6-8`]);

    const c = await repo.startCardioSession();
    const cardio = await repo.logCardio({ sessionId: c.id, date: "2026-11-08", modality: "bike", minutes: 30, hardMinutes: 16, intensity: "hard", avgHr: 150, source: "timer" });
    expect(cardio.session_id).toBe(c.id);
    const walk = await repo.logWalk("2026-11-08", 40);
    expect(walk).toMatchObject({ session_id: null, modality: "walk", intensity: "easy", minutes: 40 });

    expect(await added(() => repo.saveCheckin({ date: "2026-11-08", sleep: 4, soreness: 3, stress: 4, energy: 5 }))).toEqual(["checkin/ck_2026-11-08"]);
    expect(await added(() => repo.repairWeek("wk_2026-11-02"))).toEqual(["training_week/wk_2026-11-02"]);
    const ex = await repo.saveCustomExercise({
      name: "Sled push", pattern: "carry", primary_muscles: ["quads"], secondary_muscles: [], equipment: "other",
      fatigue_rating: 2, increment_kg: 5, step_kg: 5, default_rest_s: 120, tags: [],
    });
    expect(ex.custom).toBe(true);
    expect(await outboxKeys()).toContain(`exercise/${ex.id}`);

    const other = await repo.startSession({ code: "B", mode: "short" });
    expect(await added(() => repo.persistAutoFinished([{ session_id: other.id, ended_at: T0 }]))).toEqual([`session/${other.id}`]);
    expect(await added(() => repo.persistAutoFinished([{ session_id: other.id, ended_at: T0 }]))).toEqual([]); // already ended

    expect(await added(() => repo.discardSession(c.id))).toEqual([`session/${c.id}`, `cardio_log/${cardio.id}`]);

    // Every queued row exists and is valid against its schema.
    for (const e of await db.outbox.toArray()) {
      const row = await db.table(e.table).get(e.row_id);
      expect(TableSchemas[e.table as SyncTable].safeParse(row).success, `${e.table}/${e.row_id}`).toBe(true);
    }
  });

  it("updated_at strictly increases per row, even with a frozen or backwards clock", async () => {
    setClock(() => T0);
    const s = await repo.startSession({ code: "A", mode: "full" });
    const set = await repo.logSet({
      sessionId: s.id, prescriptionId: "A1", exerciseId: "back_squat", setIndex: 0,
      target: { weight: 60, reps: 8, rir: 3 }, weight: 60, reps: 8, rir: 3,
    });
    expect(set.updated_at).toBe(T0);
    const a = await repo.updateSet(set.id, { reps: 7 });
    const b = await repo.updateSet(set.id, { reps: 6 });
    expect(a.updated_at).toBe("2026-11-08T10:00:00.001Z");
    expect(b.updated_at).toBe("2026-11-08T10:00:00.002Z");

    setClock(() => "2026-11-08T09:00:00.000Z"); // clock jumped back
    const c = await repo.updateSet(set.id, { reps: 5 });
    expect(c.updated_at).toBe("2026-11-08T10:00:00.003Z");

    setClock(() => "2026-11-08T11:00:00.000Z");
    const d = await repo.updateSet(set.id, { reps: 4 });
    expect(d.updated_at).toBe("2026-11-08T11:00:00.000Z");
  });

  it("logging the same slot twice updates the set instead of duplicating it", async () => {
    const s = await repo.startSession({ code: "A", mode: "full" });
    const input = {
      sessionId: s.id, prescriptionId: "A1", exerciseId: "back_squat", setIndex: 0,
      target: { weight: 60, reps: 8, rir: 3 }, weight: 60, reps: 8, rir: 3,
    };
    const first = await repo.logSet(input);
    const second = await repo.logSet({ ...input, reps: 9 });
    expect(second.id).toBe(first.id);
    expect(await db.set_log.count()).toBe(1);
    expect((await db.set_log.get(first.id))?.reps).toBe(9);
  });

  it("discardSession soft deletes the session, its sets, cardio logs and decisions", async () => {
    const s = await repo.startSession({ code: "A", mode: "full" });
    const set = await repo.logSet({
      sessionId: s.id, prescriptionId: "A1", exerciseId: "back_squat", setIndex: 0,
      target: { weight: 60, reps: 8, rir: 3 }, weight: 60, reps: 8, rir: 3,
    });
    await repo.persistDecisions([makeDecision(s.id, "back_squat")]);
    await repo.discardSession(s.id);
    expect((await db.session.get(s.id))?.deleted_at).not.toBeNull();
    expect((await db.set_log.get(set.id))?.deleted_at).not.toBeNull();
    expect((await db.decision.get(`d:${s.id}:back_squat@6-8`))?.deleted_at).not.toBeNull();
    // Rows are kept (soft delete) so the deletion syncs.
    expect(await db.session.count()).toBe(1);
  });

  it("persistDecisions writes new or changed decisions only", async () => {
    const d = makeDecision("S1", "bench_press");
    expect(await added(() => repo.persistDecisions([d]))).toEqual([`decision/${d.id}`]);
    expect(await added(() => repo.persistDecisions([{ ...d, inputs_snapshot: { other: 1 }, date: T0 }]))).toEqual([]);
    // Same output with different key order is unchanged.
    expect(await added(() => repo.persistDecisions([{ ...d, output: { reps: 6, weight: 82.5 } }]))).toEqual([]);
    expect(await added(() => repo.persistDecisions([{ ...d, explanation: "Same load." }]))).toEqual([`decision/${d.id}`]);
    expect(await added(() => repo.persistDecisions([{ ...d, explanation: "Same load.", output: { weight: 80, reps: 8 } }]))).toEqual([`decision/${d.id}`]);
  });

  it("finishSession keeps the session finished when the engine throws", async () => {
    engineMock.summarizeSession.mockImplementation(() => {
      throw new Error("engine broke");
    });
    const s = await repo.startSession({ code: "A", mode: "full" });
    const res = await repo.finishSession(s.id);
    expect(res.error?.message).toBe("engine broke");
    expect(res.decisions).toBe(0);
    expect((await db.session.get(s.id))?.ended_at).not.toBeNull();
  });

  it("saveCheckin upserts by date and keeps optional fields", async () => {
    await repo.saveCheckin({ date: "2026-11-08", sleep: 2, soreness: 3, stress: 3, energy: 3, hrv: 55, hrvType: "rmssd" });
    const c = await repo.saveCheckin({ date: "2026-11-08", sleep: 4, soreness: 3, stress: 3, energy: 3 });
    expect(c).toMatchObject({ id: "ck_2026-11-08", sleep: 4, hrv: 55, hrv_type: "rmssd" });
    expect(await db.checkin.count()).toBe(1);
  });

  it("rejects invalid rows without writing or queueing", async () => {
    await expect(repo.saveCheckin({ date: "2026-11-08", sleep: 9, soreness: 3, stress: 3, energy: 3 })).rejects.toThrow();
    expect(await db.checkin.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });
});
