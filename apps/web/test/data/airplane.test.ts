/**
 * Acceptance criterion 3: a full session logged in airplane mode survives app close
 * and syncs later with no data loss. Each row reaches the server exactly once.
 */
import { afterAll, expect, it, vi } from "vitest";
import { SYNC_TABLES } from "@gym/schema";

vi.mock("@gym/engine", async () => (await import("./engineMock")).engineMock);

import { db, getMeta, WorkoutDb } from "../../src/data/db";
import * as repo from "../../src/data/repo";
import { SyncClient, syncClient } from "../../src/data/sync";
import { FakeServer } from "./fakeServer";
import { allRows, resetDb, until } from "./helpers";

let reopened: WorkoutDb | null = null;
afterAll(() => {
  syncClient.stop();
  reopened?.close();
});

it("logs a full session offline, survives a restart, then syncs every row exactly once", async () => {
  await resetDb();

  // Airplane mode: every request fails at the network level.
  const offlineFetch = vi.fn(async () => {
    throw new TypeError("Failed to fetch");
  });
  syncClient.configure({ fetch: offlineFetch, debounceMs: 5, intervalMs: 60_000 });
  syncClient.start();

  await repo.ensureSettings();
  await repo.saveCheckin({ date: "2026-11-08", sleep: 4, soreness: 4, stress: 3, energy: 4 });
  const s = await repo.startSession({ code: "A", mode: "full" });

  const plan = [
    { pid: "A1", ex: "back_squat", sets: 3, w: 60 },
    { pid: "A2", ex: "bench_press", sets: 3, w: 50 },
    { pid: "A3", ex: "seated_cable_row", sets: 3, w: 45 },
    { pid: "A4", ex: "romanian_deadlift", sets: 2, w: 60 },
  ];
  const setIds: string[] = [];
  for (const p of plan) {
    for (let i = 0; i < p.sets; i++) {
      const set = await repo.logSet({
        sessionId: s.id, prescriptionId: p.pid, exerciseId: p.ex, setIndex: i,
        target: { weight: p.w, reps: 8, rir: 2 }, weight: p.w, reps: 8, rir: 2,
      });
      setIds.push(set.id);
    }
  }
  await repo.updateSet(setIds[1]!, { reps: 7, rir: 1 }); // corrected a set
  await repo.setPain(s.id, "romanian_deadlift", true);
  await repo.swapExercise(s.id, "A3", "seated_cable_row");
  const finished = await repo.finishSession(s.id);
  expect(finished.decisions).toBe(plan.length);
  await repo.logWalk("2026-11-08", 25);

  // Sync was attempted while offline and lost nothing.
  await until(() => offlineFetch.mock.calls.length > 0 && syncClient.getStatus().state === "offline");
  await syncClient.sync();
  expect(syncClient.getStatus().state).toBe("offline");
  const localBefore = await allRows();
  const clientId = await getMeta<string>("client_id");
  const queuedRows = new Set((await db.outbox.toArray()).map((e) => `${e.table}/${e.row_id}`));
  expect(queuedRows.size).toBe(localBefore.length);

  // App close: listeners gone, connection closed, all in-memory state dropped.
  syncClient.stop();
  db.close();

  // Reopen with a fresh connection and a fresh sync client; the network is back.
  reopened = new WorkoutDb();
  await reopened.open();
  const server = new FakeServer();
  const client = new SyncClient({ database: reopened, fetch: server.fetch });
  const status = await client.sync();

  expect(status.state).toBe("idle");
  expect(status.pending).toBe(0);
  expect(await reopened.outbox.count()).toBe(0);
  expect(server.requests[0]!.body.client_id).toBe(clientId);

  const localAfter = await allRows(reopened);
  expect(localAfter).toEqual(localBefore); // nothing lost locally
  expect(server.pushes).toHaveLength(localBefore.length); // each row pushed exactly once
  for (const { table, row } of localBefore) {
    expect(server.pushCount(table, row.id), `${table}/${row.id}`).toBe(1);
    expect(server.get(table, row.id)).toEqual(row);
  }
  // Sanity: the session, all 11 sets, the walk, the check-in, settings and the 4 decisions.
  const counts = Object.fromEntries(SYNC_TABLES.map((t) => [t, localBefore.filter((r) => r.table === t).length]));
  expect(counts).toMatchObject({ session: 1, set_log: 11, cardio_log: 1, checkin: 1, settings: 1, decision: 4 });

  // A second sync is a no-op push.
  await client.sync();
  expect(server.pushes).toHaveLength(localBefore.length);
});
