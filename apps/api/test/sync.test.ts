import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { SYNC_TABLES, SyncResponse } from "@gym/schema";
import { post, resetDb, sync } from "./helpers";
import { T0, T1, T2, allFixtures, fixtures } from "./fixtures";

beforeEach(resetDb);

async function globalRev(): Promise<number> {
  const row = await env.DB.prepare("SELECT value FROM sync_meta WHERE key = 'rev'").first<{ value: number }>();
  return row!.value;
}

function countRows(res: SyncResponse): number {
  return SYNC_TABLES.reduce((n, t) => n + (res.changes[t]?.length ?? 0), 0);
}

describe("POST /api/sync", () => {
  it("roundtrips every table exactly (booleans, JSON, nulls, floats)", async () => {
    const changes = allFixtures();
    const res = await sync({ changes });
    expect(SyncResponse.safeParse(res).success).toBe(true);
    expect(res.accepted).toBe(8);
    expect(res.rejected).toEqual([]);
    expect(res.cursor).toBe(8);
    expect(res.more).toBe(false);
    for (const t of SYNC_TABLES) expect(res.changes[t], t).toEqual(changes[t]);

    // Another device starting from scratch gets the same rows.
    const fresh = await sync({ client_id: "phone-2", cursor: 0 });
    for (const t of SYNC_TABLES) expect(fresh.changes[t], t).toEqual(changes[t]);

    // Nothing new after the cursor: cursor stays put.
    const empty = await sync({ cursor: res.cursor });
    expect(countRows(empty)).toBe(0);
    expect(empty.cursor).toBe(res.cursor);
    expect(empty.more).toBe(false);
    expect(Object.keys(empty.changes).sort()).toEqual([...SYNC_TABLES].sort());
  });

  it("server_time is an ISO UTC timestamp", async () => {
    const res = await sync({});
    expect(res.server_time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  describe("last write wins on updated_at", () => {
    const at = (updated_at: string, notes: string) => fixtures.session({ updated_at, notes });

    beforeEach(async () => {
      await sync({ changes: { session: [at(T1, "server")] } });
    });

    it("older incoming row is ignored", async () => {
      const res = await sync({ cursor: 0, changes: { session: [at(T0, "older")] } });
      expect(res.accepted).toBe(0);
      expect(res.changes.session).toEqual([at(T1, "server")]);
    });

    it("newer incoming row wins", async () => {
      const res = await sync({ cursor: 0, changes: { session: [at(T2, "newer")] } });
      expect(res.accepted).toBe(1);
      expect(res.changes.session).toEqual([at(T2, "newer")]);
    });

    it("a tie keeps the server row", async () => {
      const res = await sync({ cursor: 0, changes: { session: [at(T1, "tie")] } });
      expect(res.accepted).toBe(0);
      expect(res.changes.session).toEqual([at(T1, "server")]);
    });

    it("compares instants, not strings (no ms vs ms)", async () => {
      await sync({ changes: { training_week: [fixtures.training_week({ updated_at: "2026-11-05T10:00:00Z" })] } });
      const later = fixtures.training_week({ updated_at: "2026-11-05T10:00:00.5Z", repaired: true });
      const res = await sync({ cursor: 0, changes: { training_week: [later] } });
      expect(res.accepted).toBe(1);
      expect(res.changes.training_week).toEqual([later]);
      // Same instant spelled differently is a tie.
      const same = fixtures.training_week({ updated_at: "2026-11-05T10:00:00.500Z", repaired: false });
      expect((await sync({ changes: { training_week: [same] } })).accepted).toBe(0);
    });
  });

  it("re-pushing the same rows is idempotent: nothing written, no new revs", async () => {
    const first = await sync({ changes: allFixtures() });
    const rev = await globalRev();
    const again = await sync({ cursor: first.cursor, changes: allFixtures() });
    expect(again.accepted).toBe(0);
    expect(countRows(again)).toBe(0);
    expect(again.cursor).toBe(first.cursor);
    expect(await globalRev()).toBe(rev);
  });

  it("invalid rows go to rejected without failing the request", async () => {
    const good = fixtures.set_log();
    const res = await sync({
      changes: {
        set_log: [
          good,
          { ...fixtures.set_log({ id: "bad_reps" }), reps: -1 },
          { id: "no_fields" },
          "not an object",
        ],
        checkin: [{ ...fixtures.checkin(), sleep: 9 }],
        settings: [{ ...fixtures.settings(), id: "not-settings" }],
        mystery: [{ id: "m1" }],
      },
    });
    expect(res.accepted).toBe(1);
    expect(res.changes.set_log).toEqual([good]);
    const rejected = res.rejected.map((r) => `${r.table}/${r.id}`).sort();
    expect(rejected).toEqual(
      ["checkin/ck_2026-11-02", "mystery/m1", "set_log/", "set_log/bad_reps", "set_log/no_fields", "settings/not-settings"].sort(),
    );
    expect(res.rejected.find((r) => r.id === "bad_reps")!.reason).toContain("reps");
    expect(res.rejected.find((r) => r.table === "mystery")!.reason).toBe("unknown_table");
  });

  it("applies schema defaults and strips unknown fields", async () => {
    const { is_top_set: _drop, ...row } = fixtures.set_log();
    const res = await sync({ changes: { set_log: [{ ...row, extra_field: "x" }] } });
    expect(res.accepted).toBe(1);
    expect(res.changes.set_log).toEqual([{ ...row, is_top_set: false }]);
  });

  it("duplicate ids in one push collapse to the newest", async () => {
    const res = await sync({
      changes: {
        session: [
          fixtures.session({ updated_at: T1, notes: "mid" }),
          fixtures.session({ updated_at: T2, notes: "new" }),
          fixtures.session({ updated_at: T0, notes: "old" }),
        ],
      },
    });
    expect(res.accepted).toBe(1);
    expect(res.changes.session).toEqual([fixtures.session({ updated_at: T2, notes: "new" })]);
  });

  it("paginates in rev order across tables with more and cursor", async () => {
    const sets = Array.from({ length: 23 }, (_, i) =>
      fixtures.set_log({ id: `set_${String(i).padStart(2, "0")}`, set_index: i }),
    );
    await sync({ changes: { set_log: sets.slice(0, 10) } });
    await sync({ changes: { checkin: [fixtures.checkin()], decision: [fixtures.decision()] } });
    await sync({ changes: { set_log: sets.slice(10) } });
    const total = 25;

    const seen: string[] = [];
    let cursor = 0;
    let pages = 0;
    let more = true;
    let lastCursor = 0;
    while (more) {
      const page = await sync({ cursor, limit: 10 });
      pages++;
      const n = countRows(page);
      expect(n).toBeLessThanOrEqual(10);
      for (const t of SYNC_TABLES) for (const r of page.changes[t] ?? []) seen.push(`${t}/${r.id}`);
      expect(page.cursor).toBeGreaterThan(lastCursor);
      lastCursor = page.cursor;
      cursor = page.cursor;
      more = page.more;
      if (more) expect(n).toBe(10);
    }
    expect(pages).toBe(3);
    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
    expect(cursor).toBe(total);

    // Page boundaries follow global rev order: the first page is the first 10 set logs only.
    const first = await sync({ cursor: 0, limit: 10 });
    expect(first.changes.set_log!.map((r) => r.id)).toEqual(sets.slice(0, 10).map((s) => s.id));
    expect(first.changes.checkin).toEqual([]);
    const second = await sync({ cursor: first.cursor, limit: 2 });
    expect(second.changes.checkin).toHaveLength(1);
    expect(second.changes.decision).toHaveLength(1);
    expect(second.more).toBe(true);
  });

  it("an exact fit is more=false", async () => {
    await sync({ changes: { set_log: [fixtures.set_log({ id: "a" }), fixtures.set_log({ id: "b" })] } });
    const res = await sync({ cursor: 0, limit: 2 });
    expect(countRows(res)).toBe(2);
    expect(res.more).toBe(false);
  });

  it("soft deletes propagate like any change", async () => {
    const first = await sync({ changes: { cardio_log: [fixtures.cardio_log()] } });
    const deleted = fixtures.cardio_log({ updated_at: T1, deleted_at: T1 });
    const push = await sync({ cursor: first.cursor, changes: { cardio_log: [deleted] } });
    expect(push.accepted).toBe(1);
    const other = await sync({ client_id: "ipad", cursor: first.cursor });
    expect(other.changes.cardio_log).toEqual([deleted]);
    // A stale undelete (older updated_at) does not resurrect it.
    const stale = await sync({ changes: { cardio_log: [fixtures.cardio_log({ updated_at: T0 })] } });
    expect(stale.accepted).toBe(0);
  });

  it("a cursor ahead of the server (restored DB) resends everything and says reset", async () => {
    await sync({ changes: { checkin: [fixtures.checkin()] } });
    const res = await sync({ cursor: 500 });
    expect(res.changes.checkin).toHaveLength(1);
    expect(res.cursor).toBe(1);
    expect(res.reset).toBe(true);
    // A normal sync is not a reset.
    expect((await sync({ cursor: 1 })).reset).toBe(false);
    expect((await sync({ cursor: 0 })).reset).toBe(false);
  });

  describe("epoch", () => {
    const rotateEpoch = () =>
      env.DB.prepare(`UPDATE sync_meta SET value = value + 1 WHERE key = 'epoch'`).run();

    it("every response carries the database epoch", async () => {
      const res = await sync({});
      expect(Number.isSafeInteger(res.epoch)).toBe(true);
      expect((await sync({ epoch: res.epoch })).reset).toBe(false);
    });

    it("another epoch is a reset even when the cursor looks valid (wiped database, rev kept)", async () => {
      const first = await sync({ changes: { checkin: [fixtures.checkin({ id: "ck_2026-11-01", date: "2026-11-01" })] } });
      // Manual wipe that keeps sync_meta.rev, then the epoch is rotated as the README says. Another device writes 3 rows.
      await env.DB.prepare(`DELETE FROM checkin`).run();
      await rotateEpoch();
      await sync({
        client_id: "laptop",
        changes: { session: [fixtures.session({ id: "s_a" }), fixtures.session({ id: "s_b" }), fixtures.session({ id: "s_c" })] },
      });
      const res = await sync({ cursor: first.cursor, epoch: first.epoch });
      expect(res.reset).toBe(true);
      expect(res.changes.session).toHaveLength(3); // pulled from 0, nothing skipped
      expect(res.epoch).toBe(first.epoch! + 1);
      expect((await sync({ cursor: res.cursor, epoch: res.epoch })).reset).toBe(false);
    });

    it("a client that never saw an epoch is not reset", async () => {
      const first = await sync({ changes: { checkin: [fixtures.checkin()] } });
      const res = await sync({ cursor: first.cursor });
      expect(res.reset).toBe(false);
      expect(res.changes.checkin).toEqual([]);
    });
  });

  it("a cursor ahead of the reset server counts as 0 even when the same request's push lifts the rev past it", async () => {
    // Another device wrote 2 rows after the reset (revs 1, 2). This client still holds cursor 3 from the old database
    // and pushes 3 rows (revs 3..5). Judged after its push, cursor 3 would look valid and revs 1..2 would be skipped.
    await sync({ client_id: "ipad", changes: { checkin: [fixtures.checkin({ id: "ck_2026-11-01", date: "2026-11-01" }), fixtures.checkin({ id: "ck_2026-11-02", date: "2026-11-02" })] } });
    const push = {
      session: [fixtures.session({ id: "s_a" }), fixtures.session({ id: "s_b" }), fixtures.session({ id: "s_c" })],
    };
    const res = await sync({ cursor: 3, changes: push });
    expect(res.accepted).toBe(3);
    expect(res.changes.checkin?.map((r) => r.id).sort()).toEqual(["ck_2026-11-01", "ck_2026-11-02"]);
    expect(res.changes.session).toHaveLength(3);
    expect(res.cursor).toBe(5);
    // A cursor equal to the server rev is normal: nothing new.
    const again = await sync({ cursor: 5 });
    expect(Object.values(again.changes).flat()).toEqual([]);
    expect(again.cursor).toBe(5);
  });

  it("settings round trip evening_hour and week_killers; an older client's row gets the defaults", async () => {
    const mine = fixtures.settings({ evening_hour: null, week_killers: ["travel"] });
    await sync({ changes: { settings: [mine] } });
    expect((await sync({ client_id: "ipad" })).changes.settings).toEqual([mine]);

    await resetDb();
    const { evening_hour: _e, week_killers: _w, ...legacy } = fixtures.settings();
    const res = await sync({ changes: { settings: [legacy] } });
    expect(res.accepted).toBe(1);
    expect(res.changes.settings?.[0]).toMatchObject({ evening_hour: 19, week_killers: ["work_peaks", "travel", "evenings"] });
  });

  it("rejects a malformed envelope with 400", async () => {
    for (const body of [
      { cursor: 0, changes: {} },
      { client_id: "x", cursor: -1, changes: {} },
      { client_id: "x", cursor: 0, changes: {}, limit: 5000 },
      { client_id: "x", cursor: 0, changes: { set_log: "nope" } },
      [],
    ]) {
      const res = await post("/api/sync", body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_request" });
    }
  });

  it("revs are unique and increase in push order", async () => {
    await sync({ changes: allFixtures() });
    await sync({ changes: { session: [fixtures.session({ updated_at: T2 })] } });
    const revs: number[] = [];
    for (const t of SYNC_TABLES) {
      const { results } = await env.DB.prepare(`SELECT rev FROM "${t}"`).all<{ rev: number }>();
      revs.push(...results.map((r) => r.rev));
    }
    expect(new Set(revs).size).toBe(revs.length);
    expect(Math.max(...revs)).toBe(await globalRev());
    const session = await env.DB.prepare(`SELECT rev FROM session`).first<{ rev: number }>();
    expect(session!.rev).toBe(9);
  });
});
