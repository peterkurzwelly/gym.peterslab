import { SYNC_TABLES, type SyncTable } from "@gym/schema";
import { db, type WorkoutDb } from "../../src/data/db";

/** Empty every table of the shared test database. */
export async function resetDb(database: WorkoutDb = db): Promise<void> {
  if (!database.isOpen()) await database.open();
  await database.transaction("rw", database.tables, async () => {
    for (const t of database.tables) await t.clear();
  });
}

export async function outboxKeys(database: WorkoutDb = db): Promise<string[]> {
  return (await database.outbox.orderBy("seq").toArray()).map((e) => `${e.table}/${e.row_id}`);
}

export async function allRows(database: WorkoutDb = db): Promise<{ table: SyncTable; row: { id: string; updated_at: string } }[]> {
  const out: { table: SyncTable; row: { id: string; updated_at: string } }[] = [];
  for (const table of SYNC_TABLES) {
    for (const row of await database.table(table).toArray()) out.push({ table, row });
  }
  return out;
}

/** Poll until cond() is true (real timers). */
export async function until(cond: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > timeoutMs) throw new Error("until: timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}
