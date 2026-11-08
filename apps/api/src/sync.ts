/** POST /api/sync: push outbox rows (LWW), then pull rows with rev > cursor. See SyncRequest in @gym/schema. */
import { z } from "zod";
import type { SyncResponse } from "@gym/schema";
import { LooseTables, idsByTable, lwwWinners, serializeTables, validateTables } from "./rows";
import { pullSince, readSyncMeta, readUpdatedAt, writeRows } from "./store";

export const DEFAULT_PULL_LIMIT = 1000;

/** Same envelope as SyncRequest, but rows stay unknown so one bad row cannot fail the request. */
export const SyncEnvelope = z.object({
  client_id: z.string().min(1).max(64),
  cursor: z.number().int().min(0),
  changes: LooseTables.default({}),
  limit: z.number().int().positive().max(2000).optional(),
  epoch: z.number().int().optional(),
});
export type SyncEnvelope = z.infer<typeof SyncEnvelope>;

export async function handleSync(db: D1Database, req: SyncEnvelope): Promise<SyncResponse> {
  const { valid, rejected } = validateTables(req.changes);

  // The client's history does not belong to this database when its cursor is ahead of the server's highest rev, or
  // when it last saw another epoch (recreated, wiped or restored database). Pull from 0 and answer reset: true so the
  // client also pushes every row it holds. Read the rev before this request's own push, which could otherwise lift it
  // past the cursor.
  const meta = await readSyncMeta(db);
  const reset =
    req.cursor > meta.rev || (req.epoch !== undefined && meta.epoch !== null && req.epoch !== meta.epoch);
  const from = reset ? 0 : req.cursor;

  const stored = await readUpdatedAt(db, idsByTable(valid));
  const winners = lwwWinners(valid, stored);
  // The SQL upsert repeats the LWW check, so a concurrent push between read and write stays correct.
  const { written } = await writeRows(db, { rows: serializeTables(winners), mode: "lww" });
  const accepted = Object.values(written).reduce((a, b) => a + b, 0);

  const pull = await pullSince(db, from, req.limit ?? DEFAULT_PULL_LIMIT);

  return {
    cursor: pull.cursor,
    more: pull.more,
    accepted,
    rejected,
    changes: pull.changes as SyncResponse["changes"],
    server_time: new Date().toISOString(),
    reset,
    ...(meta.epoch !== null && { epoch: meta.epoch }),
  };
}
