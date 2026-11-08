/**
 * Dexie database "workout-os". One table per synced row type (same shapes as D1),
 * plus the sync outbox and a small key/value meta table.
 */
import { Dexie, type Table } from "dexie";
import type {
  CardioLog,
  Checkin,
  Decision,
  ExerciseRow,
  Session,
  SetLog,
  Settings,
  SyncTable,
  TrainingWeek,
  RowOf,
} from "@gym/schema";

export const DB_NAME = "workout-os";

/** One queued change. The row itself is read at push time, so only its key is stored. */
export interface OutboxEntry {
  seq?: number;
  table: SyncTable;
  row_id: string;
  queued_at: string;
}

/** Known meta keys. sync_key is local only: never synced, never logged. */
export type MetaKey = "cursor" | "client_id" | "last_sync_at" | "sync_key";
export interface MetaEntry {
  key: MetaKey | (string & {});
  value: unknown;
}

export class WorkoutDb extends Dexie {
  settings!: Table<Settings, string>;
  exercise!: Table<ExerciseRow, string>;
  training_week!: Table<TrainingWeek, string>;
  session!: Table<Session, string>;
  set_log!: Table<SetLog, string>;
  cardio_log!: Table<CardioLog, string>;
  checkin!: Table<Checkin, string>;
  decision!: Table<Decision, string>;
  outbox!: Table<OutboxEntry, number>;
  meta!: Table<MetaEntry, string>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores({
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
    });
  }

  /** Typed access to a synced table by name. */
  rows<T extends SyncTable>(table: T): Table<RowOf<T>, string> {
    return this.table(table) as unknown as Table<RowOf<T>, string>;
  }
}

/** The app's single database instance. */
export const db = new WorkoutDb();

export async function getMeta<T>(key: MetaKey, database: WorkoutDb = db): Promise<T | undefined> {
  const entry = await database.meta.get(key);
  return entry?.value as T | undefined;
}

export async function setMeta(key: MetaKey, value: unknown, database: WorkoutDb = db): Promise<void> {
  await database.meta.put({ key, value });
}
