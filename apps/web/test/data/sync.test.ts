import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@gym/schema";

vi.mock("@gym/engine", async () => (await import("./engineMock")).engineMock);

import { db, getMeta } from "../../src/data/db";
import { setClock } from "../../src/data/clock";
import * as repo from "../../src/data/repo";
import { SyncClient } from "../../src/data/sync";
import { FakeServer } from "./fakeServer";
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
