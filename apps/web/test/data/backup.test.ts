import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@gym/engine", async () => (await import("./engineMock")).engineMock);

import { db } from "../../src/data/db";
import { setClock } from "../../src/data/clock";
import * as repo from "../../src/data/repo";
import { exportLocal, fetchRemoteExport, importLocal, ImportError, parseExportFile, pushRemoteImport } from "../../src/data/backup";
import { ApiError } from "../../src/data/api";
import { allRows, resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
  setClock(null);
});

async function seed() {
  await repo.ensureSettings();
  const s = await repo.startSession({ code: "A", mode: "full" });
  await repo.logSet({
    sessionId: s.id, prescriptionId: "A1", exerciseId: "back_squat", setIndex: 0,
    target: { weight: 60, reps: 8, rir: 3 }, weight: 60, reps: 8, rir: 3,
  });
  const gone = await repo.logSet({
    sessionId: s.id, prescriptionId: "A1", exerciseId: "back_squat", setIndex: 1,
    target: { weight: 60, reps: 8, rir: 3 }, weight: 60, reps: 6, rir: 3,
  });
  await repo.deleteSet(gone.id);
  await repo.finishSession(s.id);
  await repo.saveCheckin({ date: "2026-11-08", sleep: 4, soreness: 4, stress: 4, energy: 4 });
  await repo.logWalk("2026-11-08", 30);
  return s;
}

describe("export / import", () => {
  it("roundtrips every row (soft-deleted included) through JSON with merge", async () => {
    await seed();
    const before = await allRows();
    const file = JSON.parse(JSON.stringify(await exportLocal()));
    expect(file.format).toBe("workout-os-export");

    await resetDb();
    const res = await importLocal(file, "merge");
    expect(res).toEqual({ written: before.length, skipped: 0, deleted: 0 });
    expect(await allRows()).toEqual(before);
    // Everything imported is queued for sync.
    const queued = new Set((await db.outbox.toArray()).map((e) => `${e.table}/${e.row_id}`));
    expect(queued.size).toBe(before.length);
  });

  it("merge keeps newer local rows and skips identical ones", async () => {
    const s = await seed();
    const file = await exportLocal();
    await repo.updateSessionNotes(s.id, "newer local note");
    await db.outbox.clear();

    const res = await importLocal(file, "merge");
    expect(res.written).toBe(0);
    expect((await db.session.get(s.id))?.notes).toBe("newer local note");
    expect(await db.outbox.count()).toBe(0);
  });

  it("replace soft deletes local rows missing from the file and makes file rows win", async () => {
    setClock(() => "2026-11-08T10:00:00.000Z");
    const s = await seed();
    const file = await exportLocal();
    setClock(() => "2026-11-08T11:00:00.000Z");
    const extra = await repo.startSession({ code: "B", mode: "short" });
    await repo.updateSessionNotes(s.id, "changed after export");
    await db.outbox.clear();

    setClock(() => "2026-11-08T12:00:00.000Z");
    const res = await importLocal(file, "replace");
    expect(res.deleted).toBe(1);
    expect((await db.session.get(extra.id))?.deleted_at).toBe("2026-11-08T12:00:00.000Z");
    const restored = await db.session.get(s.id);
    expect(restored?.notes).toBeNull();
    expect(restored!.updated_at > "2026-11-08T11:00:00.000Z").toBe(true);
    expect(await db.settings.get("settings")).toBeDefined();
    const queued = new Set((await db.outbox.toArray()).map((e) => `${e.table}/${e.row_id}`));
    expect(queued.has(`session/${extra.id}`)).toBe(true);
    expect(queued.has(`session/${s.id}`)).toBe(true);
  });

  it("rejects files that are not exports", async () => {
    await expect(importLocal({ hello: "world" }, "merge")).rejects.toBeInstanceOf(ImportError);
    expect(() => parseExportFile({ format: "workout-os-export", version: 1, exported_at: "x", tables: {} })).toThrow(/exported_at/);
    expect(await db.outbox.count()).toBe(0);
  });
});

describe("remote export / import", () => {
  it("fetches and validates the server export", async () => {
    await seed();
    const file = await exportLocal();
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(file), { status: 200 }));
    const remote = await fetchRemoteExport({ fetch: fetchFn });
    expect(remote.tables.session).toHaveLength(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/export");
    expect(init).toMatchObject({ credentials: "same-origin", redirect: "manual" });
  });

  it("maps auth failures to ApiError auth_required", async () => {
    const fetchFn = vi.fn(async () => new Response("", { status: 403 }));
    await expect(fetchRemoteExport({ fetch: fetchFn })).rejects.toMatchObject({ kind: "auth_required" });
    await expect(fetchRemoteExport({ fetch: fetchFn })).rejects.toBeInstanceOf(ApiError);
  });

  it("posts an import with the mode", async () => {
    await seed();
    const file = await exportLocal();
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await pushRemoteImport(file, "replace", { fetch: fetchFn });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/import?mode=replace");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body)).format).toBe("workout-os-export");
  });
});
