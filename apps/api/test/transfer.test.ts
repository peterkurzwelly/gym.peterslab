import { beforeEach, describe, expect, it } from "vitest";
import { ExportFile, SYNC_TABLES } from "@gym/schema";
import { call, post, resetDb, sync } from "./helpers";
import { T0, T1, T2, allFixtures, fixtures } from "./fixtures";

beforeEach(resetDb);

async function exportFile(): Promise<ExportFile> {
  const res = await call("/api/export");
  expect(res.status).toBe(200);
  return ExportFile.parse(await res.json());
}

function file(tables: Record<string, unknown[]>) {
  return { format: "workout-os-export", version: 1, exported_at: T2, tables };
}

describe("GET /api/export", () => {
  it("returns every row of every table, soft-deleted ones included", async () => {
    const tables = allFixtures();
    tables.session.push(fixtures.session({ id: "gone", deleted_at: T1, updated_at: T1 }));
    await sync({ changes: tables });

    const res = await call("/api/export");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; filename=workout-os-export-\d{4}-\d{2}-\d{2}\.json$/);
    const out = ExportFile.parse(await res.json());
    expect(out.format).toBe("workout-os-export");
    expect(out.version).toBe(1);
    for (const t of SYNC_TABLES) expect(out.tables[t], t).toEqual(tables[t]);
  });

  it("an empty database exports empty tables", async () => {
    const out = await exportFile();
    for (const t of SYNC_TABLES) expect(out.tables[t]).toEqual([]);
  });
});

describe("POST /api/import", () => {
  it("merge: inserts, then last write wins, with counts per table", async () => {
    const res = await post("/api/import?mode=merge", file(allFixtures()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; mode: string; counts: Record<string, { received: number; written: number; deleted: number }> };
    expect(body.ok).toBe(true);
    expect(body.mode).toBe("merge");
    for (const t of SYNC_TABLES) expect(body.counts[t], t).toEqual({ received: 1, written: 1, deleted: 0 });

    // Same file again writes nothing; a newer row wins and an older one is ignored.
    const again = (await (await post("/api/import?mode=merge", file(allFixtures()))).json()) as typeof body;
    expect(Object.values(again.counts).every((c) => c.written === 0)).toBe(true);
    const mixed = (await (
      await post(
        "/api/import",
        file({
          session: [fixtures.session({ updated_at: T2, notes: "newer" })],
          checkin: [fixtures.checkin({ updated_at: "2026-10-01T00:00:00.000Z", sleep: 1 })],
        }),
      )
    ).json()) as typeof body;
    expect(mixed.mode).toBe("merge");
    expect(mixed.counts.session!.written).toBe(1);
    expect(mixed.counts.checkin!.written).toBe(0);
    const out = await exportFile();
    expect(out.tables.session).toEqual([fixtures.session({ updated_at: T2, notes: "newer" })]);
    expect(out.tables.checkin).toEqual([fixtures.checkin()]);
  });

  it("merge: invalid rows are reported, valid rows still land", async () => {
    const res = await post(
      "/api/import?mode=merge",
      file({ set_log: [fixtures.set_log(), { id: "bad" }], unknown_table: [{ id: "u" }] }),
    );
    const body = (await res.json()) as { counts: Record<string, { written: number }>; rejected: { table: string; id: string }[] };
    expect(res.status).toBe(200);
    expect(body.counts.set_log!.written).toBe(1);
    expect(body.rejected.map((r) => `${r.table}/${r.id}`).sort()).toEqual(["set_log/bad", "unknown_table/u"]);
  });

  it("replace: soft-deletes rows missing from the file and writes every file row stamped with the import instant", async () => {
    await sync({
      changes: {
        session: [
          fixtures.session({ id: "keep", updated_at: T2, notes: "server newer" }),
          fixtures.session({ id: "drop", updated_at: T1 }),
          fixtures.session({ id: "already_gone", updated_at: T0, deleted_at: T0 }),
        ],
        checkin: [fixtures.checkin()],
      },
    });
    const before = await sync({});
    const startedAt = Date.now();

    const restored = fixtures.session({ id: "keep", updated_at: T0, notes: "from backup" });
    const added = fixtures.session({ id: "new_one", updated_at: T0 });
    const res = await post("/api/import?mode=replace", file({ session: [restored, added] }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mode: string; counts: Record<string, { received: number; written: number; deleted: number }> };
    expect(body.mode).toBe("replace");
    expect(body.counts.session).toEqual({ received: 2, written: 2, deleted: 1 });
    expect(body.counts.checkin).toEqual({ received: 0, written: 0, deleted: 1 });

    const out = await exportFile();
    const byId = Object.fromEntries(out.tables.session!.map((s) => [s.id, s]));
    const drop = byId.drop!;
    expect(drop.deleted_at).not.toBeNull();
    expect(drop.updated_at).toBe(drop.deleted_at);
    expect(Date.parse(drop.deleted_at!)).toBeGreaterThanOrEqual(startedAt - 1000);
    const at = drop.deleted_at!;
    // Written even though older than the server row, and stamped with the import instant like the soft deletes,
    // so a device whose copy is newer than the file (T2 here) takes the restored row on its next pull.
    expect(byId.keep).toEqual({ ...restored, updated_at: at });
    expect(Date.parse(byId.keep!.updated_at)).toBeGreaterThan(Date.parse(T2));
    expect(byId.new_one).toEqual({ ...added, updated_at: at });
    expect(byId.already_gone).toEqual(fixtures.session({ id: "already_gone", updated_at: T0, deleted_at: T0 }));
    expect(out.tables.checkin![0]!.deleted_at).not.toBeNull();

    // Other devices see every change after their cursor.
    const pull = await sync({ client_id: "other", cursor: before.cursor });
    expect(pull.changes.session!.map((s) => s.id).sort()).toEqual(["drop", "keep", "new_one"]);
    expect(pull.changes.checkin).toHaveLength(1);
  });

  it("replace: export then replace into an empty database reproduces the data", async () => {
    const tables = allFixtures();
    tables.decision.push(fixtures.decision({ id: "d2", deleted_at: T1, updated_at: T1 }));
    await sync({ changes: tables });
    const exported = await exportFile();
    await resetDb();
    const res = await post("/api/import?mode=replace", exported);
    expect(res.status).toBe(200);
    const again = await exportFile();
    const at = again.tables.session![0]!.updated_at;
    for (const t of SYNC_TABLES) {
      expect(again.tables[t], t).toEqual(exported.tables[t]!.map((r) => ({ ...r, updated_at: at })));
    }
  });

  it("body_log travels through export, merge and replace", async () => {
    const days = [
      fixtures.body_log(),
      fixtures.body_log({ id: "bd_2026-11-03", date: "2026-11-03", weight_kg: 84.1, waist_cm: null, note: null }),
      fixtures.body_log({ id: "bd_2026-11-04", date: "2026-11-04", deleted_at: T1, updated_at: T1 }),
    ];
    await sync({ changes: { body_log: days, settings: [fixtures.settings()] } });
    const exported = await exportFile();
    expect(exported.tables.body_log).toEqual(days);
    expect(exported.tables.settings).toEqual([fixtures.settings()]);

    // Merge into an empty database: every row lands as it was.
    await resetDb();
    const merged = (await (await post("/api/import?mode=merge", exported)).json()) as { counts: Record<string, { received: number; written: number; deleted: number }> };
    expect(merged.counts.body_log).toEqual({ received: 3, written: 3, deleted: 0 });
    expect((await exportFile()).tables.body_log).toEqual(days);

    // Replace with a file that holds one day: the other live day is soft deleted, the deleted one stays deleted.
    const res = await post("/api/import?mode=replace", file({ body_log: [days[0]!], settings: [fixtures.settings()] }));
    const body = (await res.json()) as typeof merged;
    expect(body.counts.body_log).toEqual({ received: 1, written: 1, deleted: 1 });
    const after = Object.fromEntries((await exportFile()).tables.body_log!.map((r) => [r.id, r]));
    expect(after["bd_2026-11-02"]).toMatchObject({ weight_kg: 84.35, deleted_at: null });
    expect(after["bd_2026-11-03"]!.deleted_at).not.toBeNull();
    expect(after["bd_2026-11-04"]).toEqual(days[2]);
  });

  it("an export written before body_log and the body settings existed still imports", async () => {
    const {
      sex: _s, birth_year: _b, height_cm: _h, job_activity: _j, goal: _g, cut_rate_pct: _c,
      goal_weight_kg: _gw, kcal_override: _k, protein_override_g: _p, steps_target: _st,
      body_adjust_since: _as, body_adjust_base_kcal: _ab,
      ...oldSettings
    } = fixtures.settings();
    const { body_log: _body, ...oldTables } = allFixtures();
    const old = file({ ...oldTables, settings: [oldSettings] });
    expect(ExportFile.safeParse(old).success).toBe(true);

    const merge = await post("/api/import?mode=merge", old);
    expect(merge.status).toBe(200);
    const merged = (await merge.json()) as { counts: Record<string, { received: number; written: number; deleted: number }>; rejected: unknown[] };
    expect(merged.rejected).toEqual([]);
    expect(merged.counts.body_log).toEqual({ received: 0, written: 0, deleted: 0 });
    expect(merged.counts.settings).toEqual({ received: 1, written: 1, deleted: 0 });
    const out = await exportFile();
    expect(out.tables.body_log).toEqual([]);
    expect(out.tables.settings![0]).toMatchObject({ sex: null, goal: "cut", cut_rate_pct: 0.5, steps_target: 8000, job_activity: "desk", body_adjust_since: null, body_adjust_base_kcal: 0 });

    // Replace with the old file: body logs made since are soft deleted like any row missing from the file.
    await sync({ changes: { body_log: [fixtures.body_log({ updated_at: T2 })] } });
    const replace = await post("/api/import?mode=replace", old);
    expect(replace.status).toBe(200);
    const replaced = (await replace.json()) as typeof merged;
    expect(replaced.counts.body_log).toEqual({ received: 0, written: 0, deleted: 1 });
    expect((await exportFile()).tables.body_log![0]!.deleted_at).not.toBeNull();
  });

  it("replace: refuses a file with invalid rows and changes nothing", async () => {
    await sync({ changes: { checkin: [fixtures.checkin()] } });
    const res = await post("/api/import?mode=replace", file({ session: [fixtures.session(), { id: "broken" }] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "invalid_rows", rejected: [{ table: "session", id: "broken" }] });
    const out = await exportFile();
    expect(out.tables.checkin).toEqual([fixtures.checkin()]);
    expect(out.tables.session).toEqual([]);
  });

  it("rejects a bad envelope or mode", async () => {
    expect((await post("/api/import?mode=wipe", file({}))).status).toBe(400);
    expect((await post("/api/import?mode=merge", { ...file({}), format: "other" })).status).toBe(400);
    expect((await post("/api/import?mode=merge", { ...file({}), version: 2 })).status).toBe(400);
    expect((await post("/api/import?mode=merge", { format: "workout-os-export", version: 1 })).status).toBe(400);
  });
});
