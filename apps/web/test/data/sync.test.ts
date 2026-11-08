import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@gym/schema";

vi.mock("@gym/engine", async () => (await import("./engineMock")).engineMock);

import { db, getMeta } from "../../src/data/db";
import { setClock } from "../../src/data/clock";
import * as repo from "../../src/data/repo";
import { SyncClient } from "../../src/data/sync";
import { FakeServer } from "./fakeServer";
import { makeSettings } from "./engineMock";
import { outboxKeys, resetDb, until } from "./helpers";

let server: FakeServer;
let client: SyncClient;

beforeEach(async () => {
  await resetDb();
  setClock(null);
  server = new FakeServer();
  client = new SyncClient({ fetch: server.fetch });
});
afterEach(() => {
  client.stop();
  setClock(null);
});

const session = (id: string, updated_at: string, notes: string | null = null): Session => ({
  id,
  program_day_id: "A",
  started_at: "2026-11-08T09:00:00.000Z",
  ended_at: null,
  mode: "full",
  flags: [],
  swaps: {},
  notes,
  updated_at,
  deleted_at: null,
});

const logOneSet = (sessionId: string, setIndex = 0) =>
  repo.logSet({
    sessionId, prescriptionId: "A1", exerciseId: "back_squat", setIndex,
    target: { weight: 60, reps: 8, rir: 3 }, weight: 60, reps: 8, rir: 3,
  });

describe("push", () => {
  it("pushes the latest row once per (table, id) and clears the outbox", async () => {
    const s = await repo.startSession({ code: "A", mode: "full" });
    const set = await logOneSet(s.id);
    await repo.updateSet(set.id, { reps: 9 });
    await repo.updateSet(set.id, { reps: 10 });
    expect(await db.outbox.count()).toBe(4);

    const status = await client.sync();
    expect(status.state).toBe("idle");
    expect(status.pending).toBe(0);
    expect(server.requests).toHaveLength(1);
    expect(server.pushCount("set_log", set.id)).toBe(1);
    expect(server.get("set_log", set.id)?.reps).toBe(10);
    expect(await db.outbox.count()).toBe(0);
    expect(await getMeta("cursor")).toBe(server.rev);
    expect(status.lastSyncAt).not.toBeNull();
  });

  it("splits large outboxes into several requests", async () => {
    client.configure({ pushBatchSize: 2 });
    const s = await repo.startSession({ code: "A", mode: "full" });
    for (let i = 0; i < 4; i++) await logOneSet(s.id, i);
    const status = await client.sync();
    expect(status.state).toBe("idle");
    expect(server.requests.length).toBe(3);
    expect(server.pushes).toHaveLength(5);
    expect(await db.outbox.count()).toBe(0);
  });

  it("pushes soft-deleted rows so deletions sync", async () => {
    const s = await repo.startSession({ code: "A", mode: "full" });
    await client.sync();
    await repo.discardSession(s.id);
    await client.sync();
    expect(server.get("session", s.id)?.deleted_at).not.toBeNull();
  });

  it("sends the sync key as a bearer token and never syncs it", async () => {
    await client.setSyncKey("  secret-key ");
    await repo.startSession({ code: "A", mode: "full" });
    await client.sync();
    const req = server.requests[0]!;
    expect(req.headers.Authorization).toBe("Bearer secret-key");
    expect(JSON.stringify(req.body)).not.toContain("secret-key");
    expect(await outboxKeys()).toEqual([]);
    await client.setSyncKey(null);
    await repo.startSession({ code: "B", mode: "full" });
    await client.sync();
    expect(server.requests[1]!.headers.Authorization).toBeUndefined();
  });

  it("keeps the same client id across syncs", async () => {
    await client.sync();
    await client.sync();
    const ids = new Set(server.requests.map((r) => r.body.client_id));
    expect(ids.size).toBe(1);
    expect(await getMeta("client_id")).toBe([...ids][0]);
  });
});

describe("last write wins", () => {
  it("a newer remote row replaces the local one", async () => {
    setClock(() => "2026-11-08T10:00:00.000Z");
    const s = await repo.startSession({ code: "A", mode: "full" });
    server.seed("session", session(s.id, "2026-11-08T12:00:00.000Z", "edited on the laptop"));
    await client.sync();
    expect((await db.session.get(s.id))?.notes).toBe("edited on the laptop");
    // The server kept its newer row (ties and older pushes lose).
    expect(server.get("session", s.id)?.notes).toBe("edited on the laptop");
  });

  it("an older remote row does not overwrite a newer local one, and the local row wins on the server", async () => {
    setClock(() => "2026-11-08T12:00:00.000Z");
    const s = await repo.startSession({ code: "A", mode: "full", notes: "local" });
    server.seed("session", session(s.id, "2026-11-08T10:00:00.000Z", "stale"));
    await client.sync();
    expect((await db.session.get(s.id))?.notes).toBe("local");
    expect(server.get("session", s.id)?.notes).toBe("local");
  });

  it("an older remote row is ignored on pull even without a pending push", async () => {
    setClock(() => "2026-11-08T12:00:00.000Z");
    const s = await repo.startSession({ code: "A", mode: "full", notes: "local" });
    await db.outbox.clear();
    server.seed("session", session(s.id, "2026-11-08T10:00:00.000Z", "stale"));
    await client.sync();
    expect((await db.session.get(s.id))?.notes).toBe("local");
  });

  it("pulled rows are not queued in the outbox", async () => {
    server.seed("session", session("S_REMOTE", "2026-11-08T12:00:00.000Z"));
    await client.sync();
    expect(await db.session.get("S_REMOTE")).toBeDefined();
    expect(await db.outbox.count()).toBe(0);
  });
});

describe("pull pagination", () => {
  it("follows more: true until everything is pulled", async () => {
    server.limit = 2;
    for (let i = 0; i < 5; i++) server.seed("session", session(`S${i}`, `2026-11-08T12:00:0${i}.000Z`));
    const status = await client.sync();
    expect(status.state).toBe("idle");
    expect(server.requests.map((r) => r.body.cursor)).toEqual([0, 2, 4]);
    expect(await db.session.count()).toBe(5);
    expect(await getMeta("cursor")).toBe(5);

    // Next sync starts from the stored cursor.
    await client.sync();
    expect(server.requests.at(-1)!.body.cursor).toBe(5);
  });
});

describe("failures", () => {
  it("opaque redirect (expired Access session) → auth_required, outbox kept", async () => {
    await repo.startSession({ code: "A", mode: "full" });
    server.mode = "redirect";
    const status = await client.sync();
    expect(status.state).toBe("auth_required");
    expect(status.pending).toBe(1);
    expect(await db.outbox.count()).toBe(1);
  });

  it("401 → auth_required, outbox kept", async () => {
    await repo.startSession({ code: "A", mode: "full" });
    server.mode = "401";
    const status = await client.sync();
    expect(status.state).toBe("auth_required");
    expect(status.lastError).toMatch(/sync key/i);
    expect(await db.outbox.count()).toBe(1);
  });

  it("network failure → offline, outbox kept, later sync succeeds", async () => {
    const s = await repo.startSession({ code: "A", mode: "full" });
    server.mode = "offline";
    expect((await client.sync()).state).toBe("offline");
    expect(await db.outbox.count()).toBe(1);
    server.mode = "ok";
    expect((await client.sync()).state).toBe("idle");
    expect(server.get("session", s.id)).toBeDefined();
  });

  it("5xx → error, then retries with backoff once started", async () => {
    client.configure({ backoffBaseMs: 20, intervalMs: 60_000 });
    await repo.startSession({ code: "A", mode: "full" });
    server.mode = "500";
    client.start();
    await until(() => client.getStatus().state === "error");
    expect(client.getStatus().lastError).toMatch(/500/);
    server.mode = "ok";
    await until(() => client.getStatus().state === "idle");
    expect(await db.outbox.count()).toBe(0);
  });

  it("never rejects, even when the database fails", async () => {
    const broken = new SyncClient({ fetch: server.fetch });
    vi.spyOn(db.outbox, "orderBy").mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    const status = await broken.sync();
    expect(status.state).toBe("error");
    expect(status.lastError).toBe("disk full");
  });
});

describe("concurrency", () => {
  it("outbox entries written during an in-flight sync survive and are pushed next time", async () => {
    const s = await repo.startSession({ code: "A", mode: "full" });
    const first = await logOneSet(s.id, 0);
    let second: { id: string } | null = null;
    server.onRequest = async () => {
      server.onRequest = null;
      // While the request is in flight: a new set and an edit of a row being pushed.
      second = await logOneSet(s.id, 1);
      await repo.updateSet(first.id, { reps: 12 });
    };
    await client.sync();
    expect(server.get("set_log", second!.id)).toBeUndefined();
    expect(server.get("set_log", first.id)?.reps).toBe(8);
    expect(await outboxKeys()).toEqual([`set_log/${second!.id}`, `set_log/${first.id}`]);

    await client.sync();
    expect(server.get("set_log", second!.id)).toBeDefined();
    expect(server.get("set_log", first.id)?.reps).toBe(12);
    expect(await db.outbox.count()).toBe(0);
  });

  it("concurrent sync calls share one run (single flight)", async () => {
    await repo.startSession({ code: "A", mode: "full" });
    const [a, b] = await Promise.all([client.sync(), client.sync()]);
    expect(a).toBe(b);
    // The second call asks for one rerun after the first finishes; nothing is pushed twice.
    expect(server.pushes).toHaveLength(1);
  });

  it("debounces writes once started", async () => {
    client.configure({ debounceMs: 20 });
    client.start();
    await until(() => client.getStatus().state === "idle" && server.requests.length >= 1);
    const before = server.requests.length;
    const s = await repo.startSession({ code: "A", mode: "full" });
    client.notifyWrite();
    await logOneSet(s.id);
    client.notifyWrite();
    await until(async () => (await db.outbox.count()) === 0);
    expect(server.requests.length).toBe(before + 1);
  });
});

describe("fresh device settings", () => {
  // Peter's real settings, synced from the iPhone on Saturday.
  const real = {
    ...makeSettings("2026-11-07T18:00:00.000Z"),
    remembered_weights: { back_squat: { weight: 100, reps: 5 }, bench_press: { weight: 80, reps: 6 } },
    block_swaps: { B3: "lat_pulldown" },
    interval_modality: "rower" as const,
    start_pct: 0.65,
    sound: false,
    evening_hour: 20,
  };

  it("the defaults seeded at boot never overwrite the real settings on the server", async () => {
    server.seed("settings", real);
    setClock(() => "2026-11-08T20:00:00.000Z");
    await repo.ensureSettings(); // bootData on an empty device, before any pull
    const status = await client.sync();
    expect(status.state).toBe("idle");
    expect(server.pushCount("settings", "settings")).toBe(0);
    expect(server.get("settings", "settings")).toEqual(real);
    expect(await db.settings.get("settings")).toEqual(real);
  });

  it("also when the sync key is pasted minutes after boot", async () => {
    server.seed("settings", real);
    server.mode = "401";
    setClock(() => "2026-11-08T20:00:00.000Z");
    await repo.ensureSettings();
    expect((await client.sync()).state).toBe("auth_required");
    server.mode = "ok";
    setClock(() => "2026-11-08T20:05:00.000Z");
    await client.setSyncKey("pasted-key");
    await client.sync();
    expect(server.get("settings", "settings")).toEqual(real);
    expect(await db.settings.get("settings")).toEqual(real);
    // The first real edit after the pull builds on the real row and wins everywhere.
    await repo.updateSettings({ sound: true });
    await client.sync();
    expect(server.get("settings", "settings")).toMatchObject({ ...real, sound: true, updated_at: "2026-11-08T20:05:00.000Z" });
  });
});

describe("server reset", () => {
  async function loggedSession() {
    const s = await repo.startSession({ code: "A", mode: "full" });
    const kept = await logOneSet(s.id, 0);
    const gone = await logOneSet(s.id, 1);
    await repo.deleteSet(gone.id);
    return { s, kept, gone };
  }

  it("a cursor ahead of the new server re-pushes every local row, soft-deleted included", async () => {
    const { s, kept, gone } = await loggedSession();
    await client.sync();
    const oldCursor = (await getMeta<number>("cursor"))!;
    expect(oldCursor).toBeGreaterThan(0);

    // D1 recreated: empty, rev 0.
    const fresh = new FakeServer();
    client.configure({ fetch: fresh.fetch });
    const status = await client.sync();
    expect(status.state).toBe("idle");
    expect(fresh.requests[0]!.body.cursor).toBe(oldCursor);
    expect(fresh.get("session", s.id)).toEqual(await db.session.get(s.id));
    expect(fresh.get("set_log", kept.id)).toEqual(await db.set_log.get(kept.id));
    expect(fresh.get("set_log", gone.id)?.deleted_at).not.toBeNull();
    expect(await db.outbox.count()).toBe(0);
    expect(await getMeta("cursor")).toBe(fresh.rev);

    // The next sync is a normal one: nothing pushed again.
    const pushed = fresh.pushes.length;
    await client.sync();
    expect(fresh.pushes).toHaveLength(pushed);
  });

  it("a new epoch is a reset even after another device lifted the new rev past the stale cursor", async () => {
    const { s, kept } = await loggedSession();
    await client.sync();
    const oldCursor = (await getMeta<number>("cursor"))!;
    expect(await getMeta("epoch")).toBe(1);

    // New database (epoch 2). The laptop synced first and wrote more rows than this phone's cursor.
    const fresh = new FakeServer(2);
    for (let i = 1; i <= oldCursor + 2; i++) {
      fresh.seed("checkin", {
        id: `ck_2026-10-${String(i).padStart(2, "0")}`, date: `2026-10-${String(i).padStart(2, "0")}`,
        sleep: 3, soreness: 3, stress: 3, energy: 3, hrv: null, rhr: null, sleep_hours: null, hrv_type: null,
        updated_at: "2026-11-08T08:00:00.000Z", deleted_at: null,
      });
    }
    expect(fresh.rev).toBeGreaterThan(oldCursor);
    client.configure({ fetch: fresh.fetch });
    await client.sync();
    expect(fresh.requests[0]!.body.epoch).toBe(1);
    expect(await db.checkin.count()).toBe(oldCursor + 2); // none of the laptop's first rows skipped
    expect(fresh.get("session", s.id)).toBeDefined(); // and the phone's history reached the new database
    expect(fresh.get("set_log", kept.id)).toBeDefined();
    expect(await getMeta("epoch")).toBe(2);
    expect(await db.outbox.count()).toBe(0);
  });

  it("a server without an epoch still syncs normally", async () => {
    const legacy = new FakeServer(null);
    client.configure({ fetch: legacy.fetch });
    const s = await repo.startSession({ code: "A", mode: "full" });
    await client.sync();
    await client.sync();
    expect(legacy.pushCount("session", s.id)).toBe(1);
    expect(await getMeta("epoch")).toBeUndefined();
    expect(legacy.requests.every((r) => r.body.epoch === undefined)).toBe(true);
  });
});

describe("refused rows", () => {
  it("stay queued and keep the warning until the server takes them", async () => {
    const s = await repo.startSession({ code: "A", mode: "full" });
    const set = await logOneSet(s.id);
    server.refuse.add(set.id);

    let status = await client.sync();
    expect(status.state).toBe("idle");
    expect(status.lastError).toBe("1 change could not be saved on the server");
    expect(server.get("session", s.id)).toBeDefined();
    expect(server.get("set_log", set.id)).toBeUndefined();
    expect(await outboxKeys()).toEqual([`set_log/${set.id}`]);
    expect(status.pending).toBe(1);

    status = await client.sync();
    expect(status.lastError).toBe("1 change could not be saved on the server");
    expect(server.pushCount("set_log", set.id)).toBe(2); // once per sync, not once per round

    server.refuse.clear(); // e.g. after the fixed bundle
    status = await client.sync();
    expect(status.lastError).toBeNull();
    expect(server.get("set_log", set.id)).toBeDefined();
    expect(await db.outbox.count()).toBe(0);
  });

  it("do not hold back the rest of the outbox", async () => {
    client.configure({ pushBatchSize: 2 });
    const s = await repo.startSession({ code: "A", mode: "full" });
    const sets = [];
    for (let i = 0; i < 4; i++) sets.push(await logOneSet(s.id, i));
    server.refuse.add(s.id);
    server.refuse.add(sets[0]!.id);

    const status = await client.sync();
    expect(status.lastError).toBe("2 changes could not be saved on the server");
    for (const set of sets.slice(1)) expect(server.get("set_log", set.id)).toBeDefined();
    expect(await outboxKeys()).toEqual([`session/${s.id}`, `set_log/${sets[0]!.id}`]);
    expect(server.pushCount("session", s.id)).toBe(1);
  });
});

describe("rows from a newer version", () => {
  it("pulled rows keep fields this version does not know, and a local edit pushes them back", async () => {
    server.seed("settings", { ...makeSettings("2026-11-07T18:00:00.000Z"), future_field: "from the laptop" });
    await client.sync();
    expect(await db.settings.get("settings")).toMatchObject({ future_field: "from the laptop" });

    await repo.updateSettings({ sound: false });
    await client.sync();
    const pushed = server.requests.at(-1)!.raw.changes?.settings?.[0];
    expect(pushed).toMatchObject({ future_field: "from the laptop", sound: false });
  });

  it("a pulled row this version cannot read is held; the rest of the page lands and the cursor moves", async () => {
    server.seed("session", session("S_OK", "2026-11-08T12:00:00.000Z"));
    server.extraChanges = {
      session: [{ ...session("S_SKI", "2026-11-08T12:00:00.000Z"), mode: "ski" }],
      future_table: [{ id: "F1" }],
    };
    const status = await client.sync();
    expect(status.state).toBe("idle");
    expect(await db.session.get("S_OK")).toBeDefined();
    expect(await db.session.get("S_SKI")).toBeUndefined();
    expect(await getMeta("cursor")).toBe(server.rev);
    expect((await getMeta<{ table: string }[]>("quarantine"))?.map((h) => h.table)).toEqual(["session", "future_table"]);

    // Held again on the next sync (still unreadable), never duplicated.
    server.extraChanges = { session: [{ ...session("S_SKI", "2026-11-08T13:00:00.000Z"), mode: "ski" }] };
    await client.sync();
    expect(await getMeta<unknown[]>("quarantine")).toHaveLength(2);
  });

  it("held rows land once this version can read them (after an app update)", async () => {
    setClock(() => "2026-11-08T10:00:00.000Z");
    const local = await repo.startSession({ code: "A", mode: "full", notes: "local" });
    await db.meta.put({
      key: "quarantine",
      value: [
        { table: "session", row: session("S_HELD", "2026-11-08T12:00:00.000Z", "held") },
        { table: "session", row: session(local.id, "2026-11-08T09:00:00.000Z", "older than local") },
        { table: "future_table", row: { id: "F1" } },
      ],
    });
    await client.sync();
    expect((await db.session.get("S_HELD"))?.notes).toBe("held");
    expect((await db.session.get(local.id))?.notes).toBe("local"); // LWW like any pull
    expect(await getMeta("quarantine")).toEqual([{ table: "future_table", row: { id: "F1" } }]);
    expect(await db.outbox.count()).toBe(0); // applied rows are not queued
  });
});
