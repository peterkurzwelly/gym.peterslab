/**
 * body_log through sync, export / import and the Dexie upgrade from version 1 (before the store existed).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Dexie } from "dexie";
import { ExportFile, SYNC_TABLES, type BodyLog } from "@gym/schema";
import { db, getMeta, WorkoutDb } from "../../src/data/db";
import { setClock } from "../../src/data/clock";
import * as repo from "../../src/data/repo";
import { SyncClient } from "../../src/data/sync";
import { exportLocal, importLocal } from "../../src/data/backup";
import { FakeServer } from "./fakeServer";
import { allRows, outboxKeys, resetDb } from "./helpers";

const DAY = "2026-11-10";
const T0 = "2026-11-10T10:00:00.000Z";
const T1 = "2026-11-10T11:00:00.000Z";
const T2 = "2026-11-10T12:00:00.000Z";

let server: FakeServer;
let client: SyncClient;
const extra: Dexie[] = [];

beforeEach(async () => {
  await resetDb();
  setClock(() => T0);
  server = new FakeServer();
  client = new SyncClient({ fetch: server.fetch });
});
afterEach(async () => {
  client.stop();
  setClock(null);
  for (const d of extra.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});

const bodyRow = (date: string, updated_at: string, o: Partial<BodyLog> = {}): BodyLog => ({
  id: `bd_${date}`,
  date,
  weight_kg: 85,
  waist_cm: null,
  steps: null,
  protein_g: null,
  kcal: null,
  sleep_h: null,
  note: null,
  updated_at,
  deleted_at: null,
  ...o,
});

describe("sync", () => {
  it("pushes a day once with its latest values and clears the outbox", async () => {
    await repo.saveBodyLog(DAY, { weight_kg: 84.6 });
    await repo.addToBodyLog(DAY, "protein_g", 40);
    await repo.addToBodyLog(DAY, "protein_g", 35);
    await repo.saveBodyLog("2026-11-09", { steps: 9000, note: "Walked home." });
    expect(await db.outbox.count()).toBe(4);

    const status = await client.sync();
    expect(status).toMatchObject({ state: "idle", pending: 0, lastError: null });
    expect(server.requests).toHaveLength(1);
    expect(server.pushCount("body_log", `bd_${DAY}`)).toBe(1);
    expect(server.get("body_log", `bd_${DAY}`)).toEqual(await db.body_log.get(`bd_${DAY}`));
    expect(server.get("body_log", `bd_${DAY}`)).toMatchObject({ weight_kg: 84.6, protein_g: 75 });
    expect(server.get("body_log", "bd_2026-11-09")).toMatchObject({ steps: 9000, note: "Walked home.", weight_kg: null });
    expect(await db.outbox.count()).toBe(0);
    expect(await getMeta("cursor")).toBe(server.rev);
  });

  it("pulls days from another device without queueing them", async () => {
    server.seed("body_log", bodyRow(DAY, T0, { weight_kg: 84.2, steps: 5000 }));
    server.seed("body_log", bodyRow("2026-11-09", T0, { weight_kg: 84.9 }));
    await client.sync();
    expect((await db.body_log.orderBy("date").toArray()).map((r) => [r.date, r.weight_kg])).toEqual([
      ["2026-11-09", 84.9],
      [DAY, 84.2],
    ]);
    expect(await db.outbox.count()).toBe(0);
  });

  it("last write wins per day in both directions", async () => {
    // Local edit at T0, the server holds a newer one: the server row wins and nothing is pushed back.
    await repo.saveBodyLog(DAY, { weight_kg: 85, protein_g: 50 });
    server.seed("body_log", bodyRow(DAY, T1, { weight_kg: 84.4, protein_g: 120 }));
    await client.sync();
    expect(await db.body_log.get(`bd_${DAY}`)).toMatchObject({ weight_kg: 84.4, protein_g: 120, updated_at: T1 });
    expect(server.get("body_log", `bd_${DAY}`)).toMatchObject({ weight_kg: 84.4 });

    // A later local edit builds on the pulled row and wins on the server.
    setClock(() => T2);
    await repo.addToBodyLog(DAY, "protein_g", 30);
    await client.sync();
    expect(server.get("body_log", `bd_${DAY}`)).toMatchObject({ weight_kg: 84.4, protein_g: 150, updated_at: T2 });
    expect(await db.outbox.count()).toBe(0);
  });

  it("a soft delete from another device arrives, and a new log for that day syncs back", async () => {
    await repo.saveBodyLog(DAY, { weight_kg: 85, protein_g: 90 });
    await client.sync();
    server.seed("body_log", bodyRow(DAY, T1, { deleted_at: T1 }));
    await client.sync();
    expect((await db.body_log.get(`bd_${DAY}`))?.deleted_at).toBe(T1);

    setClock(() => T2);
    await repo.saveBodyLog(DAY, { steps: 4000 });
    await client.sync();
    expect(server.get("body_log", `bd_${DAY}`)).toMatchObject({ deleted_at: null, steps: 4000, weight_kg: null, protein_g: null });
  });

  it("works offline: logs wait in the outbox and go out later", async () => {
    server.mode = "offline";
    await repo.saveBodyLog(DAY, { weight_kg: 84.6 });
    await repo.addToBodyLog(DAY, "steps", 3000);
    expect((await client.sync()).state).toBe("offline");
    expect(await db.body_log.get(`bd_${DAY}`)).toMatchObject({ weight_kg: 84.6, steps: 3000 });
    expect(await db.outbox.count()).toBe(2);

    server.mode = "ok";
    expect((await client.sync()).state).toBe("idle");
    expect(server.get("body_log", `bd_${DAY}`)).toMatchObject({ weight_kg: 84.6, steps: 3000 });
    expect(await db.outbox.count()).toBe(0);
  });

  it("a second device ends up with the same days", async () => {
    await repo.updateSettings({ sex: "male", birth_year: 1986, height_cm: 180, goal_weight_kg: 80 });
    await repo.saveBodyLog(DAY, { weight_kg: 84.6, waist_cm: 91, sleep_h: 7.5 });
    await client.sync();

    const other = new WorkoutDb("workout-os-second-device");
    extra.push(other);
    const otherClient = new SyncClient({ fetch: server.fetch, database: other });
    await otherClient.sync();
    expect(await other.body_log.toArray()).toEqual(await db.body_log.toArray());
    expect(await other.settings.get("settings")).toMatchObject({ sex: "male", birth_year: 1986, height_cm: 180, goal_weight_kg: 80, goal: "cut" });
    expect(await other.outbox.count()).toBe(0);
    otherClient.stop();
  });

  it("after a server reset every body log is pushed again", async () => {
    await repo.saveBodyLog(DAY, { weight_kg: 84.6 });
    await repo.saveBodyLog("2026-11-09", { weight_kg: 85 });
    await client.sync();
    expect(await db.outbox.count()).toBe(0);

    // The database was recreated: new epoch, nothing in it.
    const fresh = new FakeServer(2);
    client.configure({ fetch: fresh.fetch });
    await client.sync();
    expect(fresh.get("body_log", `bd_${DAY}`)).toMatchObject({ weight_kg: 84.6 });
    expect(fresh.get("body_log", "bd_2026-11-09")).toMatchObject({ weight_kg: 85 });
    expect(await db.outbox.count()).toBe(0);
  });

  it("a pulled body log this bundle cannot read is held, the rest lands", async () => {
    server.seed("body_log", bodyRow(DAY, T0));
    server.extraChanges = { body_log: [{ ...bodyRow("2026-11-09", T0), weight_kg: 900 }] };
    const status = await client.sync();
    expect(status.state).toBe("idle");
    expect((await db.body_log.toArray()).map((r) => r.id)).toEqual([`bd_${DAY}`]);
    expect(await getMeta<unknown[]>("quarantine")).toHaveLength(1);
  });
});

describe("export / import", () => {
  async function seed() {
    await repo.updateSettings({ sex: "female", birth_year: 1990, height_cm: 168, goal: "recomp", steps_target: 9000 });
    await repo.saveBodyLog("2026-11-08", { weight_kg: 62.4, protein_g: 120 });
    await repo.saveBodyLog("2026-11-09", { weight_kg: 62.1, steps: 9500, kcal: 1900 });
    const gone = await repo.saveBodyLog(DAY, { weight_kg: 62 });
    await db.body_log.put({ ...gone, deleted_at: T1, updated_at: T1 });
    await repo.saveCheckin({ date: DAY, sleep: 4, soreness: 4, stress: 4, energy: 4 });
  }

  it("the export carries body_log and the body settings, and merge brings every row back", async () => {
    await seed();
    const before = await allRows();
    const file = JSON.parse(JSON.stringify(await exportLocal()));
    expect(ExportFile.safeParse(file).success).toBe(true);
    expect(Object.keys(file.tables).sort()).toEqual([...SYNC_TABLES].sort());
    expect(file.tables.body_log).toHaveLength(3); // the soft deleted day too
    expect(file.tables.settings[0]).toMatchObject({ sex: "female", goal: "recomp", steps_target: 9000 });

    await resetDb();
    const res = await importLocal(file, "merge");
    expect(res).toEqual({ written: before.length, skipped: 0, deleted: 0 });
    expect(await allRows()).toEqual(before);
    const queued = new Set(await outboxKeys());
    expect(queued.has("body_log/bd_2026-11-08")).toBe(true);
    expect(queued.has(`body_log/bd_${DAY}`)).toBe(true);
  });

  it("merge keeps a newer local day", async () => {
    await seed();
    const file = await exportLocal();
    setClock(() => T2);
    await repo.addToBodyLog("2026-11-09", "steps", 500);
    await db.outbox.clear();
    const res = await importLocal(file, "merge");
    expect(res.written).toBe(0);
    expect((await db.body_log.get("bd_2026-11-09"))?.steps).toBe(10_000);
    expect(await db.outbox.count()).toBe(0);
  });

  it("an export from before body_log and the body settings existed still imports", async () => {
    await seed();
    const current = JSON.parse(JSON.stringify(await exportLocal()));
    const { body_log: _body, ...tables } = current.tables;
    const BODY_KEYS = ["sex", "birth_year", "height_cm", "job_activity", "goal", "cut_rate_pct", "goal_weight_kg", "kcal_override", "protein_override_g", "steps_target", "body_adjust_since", "body_adjust_base_kcal"];
    const oldSettings = Object.fromEntries(Object.entries(tables.settings[0] as Record<string, unknown>).filter(([k]) => !BODY_KEYS.includes(k)));
    const old = { ...current, tables: { ...tables, settings: [{ ...oldSettings, updated_at: T2 }] } };
    expect(old.tables.body_log).toBeUndefined();

    // Merge: the old settings row is newer, so it lands with the defaults filled in. Body logs are left alone.
    const merged = await importLocal(old, "merge");
    expect(merged.written).toBe(1);
    expect(await db.settings.get("settings")).toMatchObject({ sex: null, goal: "cut", cut_rate_pct: 0.5, steps_target: 8000, job_activity: "desk" });
    expect((await db.body_log.toArray()).filter((r) => !r.deleted_at)).toHaveLength(2);
  });

  it("replace is the clear everything path: body logs missing from the file are soft deleted and queued", async () => {
    await seed();
    await db.outbox.clear();
    const keep = await db.body_log.get("bd_2026-11-08");
    setClock(() => T2);
    const res = await importLocal({ format: "workout-os-export", version: 1, exported_at: T2, tables: { body_log: [keep] } }, "replace");
    // One live body log and the check-in are gone; the kept day is rewritten; settings are never deleted.
    expect(res).toEqual({ written: 1, skipped: 0, deleted: 2 });
    expect(await db.body_log.get("bd_2026-11-09")).toMatchObject({ deleted_at: T2, updated_at: T2 });
    expect(await db.body_log.get("bd_2026-11-08")).toMatchObject({ deleted_at: null, weight_kg: 62.4, updated_at: T2 });
    expect((await db.settings.get("settings"))?.deleted_at).toBeNull();
    const queued = new Set(await outboxKeys());
    expect(queued).toEqual(new Set(["body_log/bd_2026-11-09", "body_log/bd_2026-11-08", `checkin/ck_${DAY}`]));

    // An empty file clears every body log.
    await importLocal({ format: "workout-os-export", version: 1, exported_at: T2, tables: {} }, "replace");
    expect((await db.body_log.toArray()).every((r) => r.deleted_at != null)).toBe(true);
    // And the server hears about it.
    await client.sync();
    expect(server.get("body_log", "bd_2026-11-08")?.deleted_at).not.toBeNull();
  });
});

describe("Dexie upgrade from version 1", () => {
  const V1 = {
    settings: "id",
    exercise: "id",
    training_week: "id",
    session: "id, started_at",
    set_log: "id, session_id, [session_id+exercise_id]",
    cardio_log: "id, date, session_id",
    checkin: "id, date",
    decision: "id, session_id",
    outbox: "++seq, table, row_id, queued_at",
    meta: "key",
  };
  const oldSettings = {
    id: "settings",
    block_start_date: "2026-11-09",
    block_number: 1,
    timezone: "Europe/Stockholm",
    limitations: ["knee_friendly"],
    remembered_weights: { back_squat: { weight: 100, reps: 5 } },
    interval_modality: "bike",
    session_order: ["A", "B", "C"],
    block_swaps: { B3: "lat_pulldown" },
    rest_overrides: {},
    increment_overrides: {},
    start_pct: 0.6,
    sound: false,
    evening_hour: null,
    week_killers: ["travel"],
    updated_at: "2026-11-09T08:00:00.000Z",
    deleted_at: null,
  };
  const oldSession = {
    id: "01JOLDSESSION",
    program_day_id: "A",
    started_at: "2026-11-09T17:00:00.000Z",
    ended_at: "2026-11-09T18:00:00.000Z",
    mode: "full",
    flags: [],
    swaps: {},
    notes: "First one",
    updated_at: "2026-11-09T18:00:00.000Z",
    deleted_at: null,
  };

  async function installV1(name: string): Promise<void> {
    await Dexie.delete(name);
    const old = new Dexie(name);
    old.version(1).stores(V1);
    await old.open();
    await old.table("settings").put(oldSettings);
    await old.table("session").put(oldSession);
    await old.table("checkin").put({ id: "ck_2026-11-09", date: "2026-11-09", sleep: 4, soreness: 3, stress: 4, energy: 5, hrv: null, rhr: null, sleep_hours: null, hrv_type: null, updated_at: "2026-11-09T07:00:00.000Z", deleted_at: null });
    await old.table("outbox").add({ table: "session", row_id: oldSession.id, queued_at: "2026-11-09T18:00:00.000Z" });
    await old.table("meta").bulkPut([{ key: "cursor", value: 41 }, { key: "sync_key", value: "secret" }, { key: "client_id", value: "phone" }]);
    expect(old.verno).toBe(1);
    expect(old.tables.map((t) => t.name)).not.toContain("body_log");
    old.close();
  }

  it("adds the body_log store and keeps every row, the outbox and the sync state", async () => {
    const name = "workout-os-upgrade-test";
    await installV1(name);
    const upgraded = new WorkoutDb(name);
    extra.push(upgraded);
    await upgraded.open();
    expect(upgraded.verno).toBe(3);
    expect(upgraded.tables.map((t) => t.name)).toContain("body_log");

    expect(await upgraded.session.get(oldSession.id)).toEqual(oldSession);
    expect(await upgraded.checkin.count()).toBe(1);
    expect((await upgraded.outbox.toArray()).map((e) => `${e.table}/${e.row_id}`)).toEqual([`session/${oldSession.id}`]);
    expect(await getMeta("cursor", upgraded)).toBe(41);
    expect(await getMeta("sync_key", upgraded)).toBe("secret");
    expect(await getMeta("client_id", upgraded)).toBe("phone");

    // The settings row keeps everything it had (evening_hour null means off) and gains the new defaults,
    // without a new updated_at: nothing to push.
    expect(await upgraded.settings.get("settings")).toEqual({
      ...oldSettings,
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
      body_adjust_since: null,
      body_adjust_base_kcal: 0,
    });

    // The new store works, by id and by date.
    await upgraded.body_log.put(bodyRow(DAY, T0));
    expect(await upgraded.body_log.where("date").equals(DAY).count()).toBe(1);
    expect(await upgraded.body_log.get(`bd_${DAY}`)).toMatchObject({ weight_kg: 85 });
  });

  it("an upgraded device syncs: old rows go out, body logs come in", async () => {
    const name = "workout-os-upgrade-sync-test";
    await installV1(name);
    const upgraded = new WorkoutDb(name);
    extra.push(upgraded);
    server.seed("body_log", bodyRow(DAY, T0, { weight_kg: 84.1 }));
    // The device's cursor (41) is ahead of this server: it answers reset and the device pushes everything it holds.
    const c = new SyncClient({ fetch: server.fetch, database: upgraded });
    const status = await c.sync();
    expect(status).toMatchObject({ state: "idle", pending: 0, lastError: null });
    expect(await upgraded.body_log.get(`bd_${DAY}`)).toMatchObject({ weight_kg: 84.1 });
    expect(server.get("session", oldSession.id)).toMatchObject({ notes: "First one" });
    // The upgraded settings row validates on its way out, new fields included.
    expect(server.get("settings", "settings")).toMatchObject({ sound: false, goal: "cut", steps_target: 8000, sex: null });
    c.stop();
  });

  it("a fresh install opens at the current version with an empty body_log", async () => {
    const fresh = new WorkoutDb("workout-os-fresh-test");
    extra.push(fresh);
    await fresh.open();
    expect(fresh.verno).toBe(3);
    expect(await fresh.body_log.count()).toBe(0);
    expect(db.verno).toBe(3);
  });
});
