/**
 * The ONLY write path for synced rows. Every mutation runs in one Dexie transaction:
 * build row → bump updated_at (strictly increasing per row) → validate → put → queue outbox.
 * Nothing here waits for the network.
 */
import { ulid } from "ulid";
import type { z } from "zod";
import {
  Exercise,
  TableSchemas,
  type CardioIntensity,
  type CardioLog,
  type CardioModality,
  type Checkin,
  type DayCode,
  type Decision,
  type ExerciseRow,
  type RowOf,
  type Session,
  type SessionFlag,
  type SessionMode,
  type SetLog,
  type Settings,
  type SyncTable,
  type TrainingWeek,
} from "@gym/schema";
import { defaultSettings, summarizeSession } from "@gym/engine";
import { db } from "./db";
import { localDateOf, nextUpdatedAt, nowIso } from "./clock";
import { getDefaults, loadContext } from "./context";
import { syncClient } from "./sync";

/** A row as callers build it; the writer fills updated_at. */
type Draft<T extends SyncTable> = Omit<RowOf<T>, "updated_at"> & { id: string; updated_at?: string };

/** Write helper handed to a transaction body. */
interface Writer {
  now: string;
  put<T extends SyncTable>(table: T, draft: Draft<T>): Promise<RowOf<T>>;
}

function makeWriter(now: string): Writer {
  return {
    now,
    async put(table, draft) {
      const t = db.rows(table);
      const existing = await t.get(draft.id);
      const updated_at = nextUpdatedAt(existing?.updated_at, now);
      const row = TableSchemas[table].parse({ ...draft, updated_at }) as RowOf<typeof table>;
      await t.put(row);
      await db.outbox.add({ table, row_id: row.id, queued_at: now });
      return row;
    },
  };
}

/** Runs fn in one rw transaction over the given tables + outbox, then nudges sync. */
async function write<R>(tables: SyncTable[], fn: (w: Writer) => Promise<R>): Promise<R> {
  const w = makeWriter(nowIso());
  // The scope must be an async function: Dexie only keeps its transaction zone across native awaits
  // for async scopes. A plain arrow returning fn's promise lost the zone on longer chains (updateSettings
  // on a fresh database) and threw PrematureCommitError.
  const result = await db.transaction("rw", [db.outbox, ...tables.map((t) => db.table(t))], async () => fn(w));
  syncClient.notifyWrite();
  return result;
}

const softDelete = <T extends { deleted_at: string | null }>(row: T, now: string): T => ({ ...row, deleted_at: now });

async function requireRow<T extends SyncTable>(table: T, id: string): Promise<RowOf<T>> {
  const row = await db.rows(table).get(id);
  if (!row || row.deleted_at) throw new Error(`${table} ${id} not found`);
  return row;
}

// ---------------- settings ----------------

async function ensureSettingsIn(w: Writer): Promise<Settings> {
  const existing = await db.settings.get("settings");
  if (existing && !existing.deleted_at) return existing;
  const { config, program } = getDefaults();
  const fresh = defaultSettings(config, program, w.now);
  return w.put("settings", { ...fresh, id: "settings", deleted_at: null });
}

/** Creates the settings row from engine defaults when missing. Returns the row. */
export async function ensureSettings(): Promise<Settings> {
  const existing = await db.settings.get("settings");
  if (existing && !existing.deleted_at) return existing;
  return write(["settings"], (w) => ensureSettingsIn(w));
}

export type SettingsPatch = Partial<Omit<Settings, "id" | "updated_at" | "deleted_at">>;

export async function updateSettings(patch: SettingsPatch): Promise<Settings> {
  return write(["settings"], async (w) => {
    const current = await ensureSettingsIn(w);
    return w.put("settings", { ...current, ...patch, id: "settings", deleted_at: null });
  });
}

async function timezone(): Promise<string> {
  const s = await db.settings.get("settings");
  return s?.timezone ?? getDefaults().config.timezone_default;
}

// ---------------- sessions and sets ----------------

export interface StartSessionInput {
  code: DayCode;
  mode: SessionMode;
  swaps?: Record<string, string>;
  flags?: SessionFlag[];
  notes?: string | null;
}

export async function startSession(input: StartSessionInput): Promise<Session> {
  return write(["session"], (w) =>
    w.put("session", {
      id: ulid(),
      program_day_id: input.code,
      started_at: w.now,
      ended_at: null,
      mode: input.mode,
      flags: input.flags ?? [],
      swaps: input.swaps ?? {},
      notes: input.notes ?? null,
      deleted_at: null,
    }),
  );
}

export interface LogSetInput {
  sessionId: string;
  prescriptionId: string | null;
  exerciseId: string;
  setIndex: number;
  target: { weight: number | null; reps: number | null; rir: number | null };
  weight: number;
  reps: number;
  rir: number | null;
  isTopSet?: boolean;
  isWarmup?: boolean;
  painFlag?: boolean;
}

/**
 * Logs one set. Logging the same slot again (session, prescription, exercise, set index)
 * updates that set instead of adding a duplicate, so a double tap is harmless.
 */
export async function logSet(input: LogSetInput): Promise<SetLog> {
  return write(["set_log"], async (w) => {
    const existing = (
      await db.set_log.where("[session_id+exercise_id]").equals([input.sessionId, input.exerciseId]).toArray()
    ).find((s) => !s.deleted_at && s.set_index === input.setIndex && s.prescription_id === input.prescriptionId);
    return w.put("set_log", {
      id: existing?.id ?? ulid(),
      session_id: input.sessionId,
      exercise_id: input.exerciseId,
      prescription_id: input.prescriptionId,
      set_index: input.setIndex,
      target_weight: input.target.weight,
      target_reps: input.target.reps,
      target_rir: input.target.rir,
      weight: input.weight,
      reps: input.reps,
      rir: input.rir,
      is_warmup: input.isWarmup ?? false,
      is_top_set: input.isTopSet ?? false,
      pain_flag: input.painFlag ?? existing?.pain_flag ?? false,
      completed_at: existing?.completed_at ?? w.now,
      deleted_at: null,
    });
  });
}

export interface SetPatch {
  weight?: number;
  reps?: number;
  rir?: number | null;
  painFlag?: boolean;
  isTopSet?: boolean;
  isWarmup?: boolean;
}

export async function updateSet(id: string, patch: SetPatch): Promise<SetLog> {
  return write(["set_log"], async (w) => {
    const cur = await requireRow("set_log", id);
    return w.put("set_log", {
      ...cur,
      ...(patch.weight !== undefined && { weight: patch.weight }),
      ...(patch.reps !== undefined && { reps: patch.reps }),
      ...(patch.rir !== undefined && { rir: patch.rir }),
      ...(patch.painFlag !== undefined && { pain_flag: patch.painFlag }),
      ...(patch.isTopSet !== undefined && { is_top_set: patch.isTopSet }),
      ...(patch.isWarmup !== undefined && { is_warmup: patch.isWarmup }),
    });
  });
}

/** Soft delete. */
export async function deleteSet(id: string): Promise<void> {
  await write(["set_log"], async (w) => {
    const cur = await db.set_log.get(id);
    if (cur && !cur.deleted_at) await w.put("set_log", softDelete(cur, w.now));
  });
}

/** Sets pain_flag on every logged set of the exercise in the session. Returns how many changed. */
export async function setPain(sessionId: string, exerciseId: string, flag: boolean): Promise<number> {
  return write(["set_log"], async (w) => {
    const sets = await db.set_log.where("[session_id+exercise_id]").equals([sessionId, exerciseId]).toArray();
    let changed = 0;
    for (const s of sets) {
      if (s.deleted_at || s.pain_flag === flag) continue;
      await w.put("set_log", { ...s, pain_flag: flag });
      changed++;
    }
    return changed;
  });
}

/** Session swap for one prescription. exerciseId null removes the swap. */
export async function swapExercise(sessionId: string, prescriptionId: string, exerciseId: string | null): Promise<Session> {
  return write(["session"], async (w) => {
    const cur = await requireRow("session", sessionId);
    const swaps = { ...cur.swaps };
    if (exerciseId) swaps[prescriptionId] = exerciseId;
    else delete swaps[prescriptionId];
    return w.put("session", { ...cur, swaps });
  });
}

export async function updateSessionNotes(sessionId: string, notes: string | null): Promise<Session> {
  return write(["session"], async (w) => w.put("session", { ...(await requireRow("session", sessionId)), notes }));
}

export interface FinishResult {
  session: Session;
  /** Decisions persisted for this session (0 when the engine could not summarize it). */
  decisions: number;
  error: Error | null;
}

/**
 * Sets ended_at (kept if already set), persists the engine's decisions for the session and syncs.
 * The session is finished even if the engine throws; the error is returned, not thrown.
 */
export async function finishSession(sessionId: string): Promise<FinishResult> {
  const session = await write(["session"], async (w) => {
    const cur = await requireRow("session", sessionId);
    return cur.ended_at ? cur : w.put("session", { ...cur, ended_at: w.now });
  });
  let decisions = 0;
  let error: Error | null = null;
  try {
    const ctx = await loadContext();
    const summary = summarizeSession(ctx, sessionId);
    decisions = await persistDecisions(summary.decisions);
  } catch (err) {
    error = err instanceof Error ? err : new Error(String(err));
    console.warn("[repo] could not persist decisions for session", sessionId, error.message);
  }
  syncClient.requestSync();
  return { session, decisions, error };
}

/** Soft deletes the session, its sets, cardio logs and decisions. */
export async function discardSession(sessionId: string): Promise<void> {
  await write(["session", "set_log", "cardio_log", "decision"], async (w) => {
    const cur = await db.session.get(sessionId);
    if (cur && !cur.deleted_at) await w.put("session", softDelete(cur, w.now));
    for (const s of await db.set_log.where("session_id").equals(sessionId).toArray()) {
      if (!s.deleted_at) await w.put("set_log", softDelete(s, w.now));
    }
    for (const c of await db.cardio_log.where("session_id").equals(sessionId).toArray()) {
      if (!c.deleted_at) await w.put("cardio_log", softDelete(c, w.now));
    }
    for (const d of await db.decision.where("session_id").equals(sessionId).toArray()) {
      if (!d.deleted_at) await w.put("decision", softDelete(d, w.now));
    }
  });
}

/** Persists ended_at for sessions the engine auto finished. Skips sessions already ended or gone. */
export async function persistAutoFinished(list: { session_id: string; ended_at: string }[]): Promise<number> {
  if (!list.length) return 0;
  return write(["session"], async (w) => {
    let n = 0;
    for (const { session_id, ended_at } of list) {
      const cur = await db.session.get(session_id);
      if (!cur || cur.deleted_at || cur.ended_at) continue;
      await w.put("session", { ...cur, ended_at });
      n++;
    }
    return n;
  });
}

// ---------------- cardio ----------------

export async function startCardioSession(input: { flags?: SessionFlag[] } = {}): Promise<Session> {
  return startSession({ code: "CARDIO", mode: "full", flags: input.flags });
}

export interface LogCardioInput {
  sessionId?: string | null;
  /** Local date; defaults to today in settings.timezone. */
  date?: string;
  modality: CardioModality;
  minutes: number;
  hardMinutes?: number | null;
  intensity: CardioIntensity;
  avgHr?: number | null;
  source?: CardioLog["source"];
}

export async function logCardio(input: LogCardioInput): Promise<CardioLog> {
  const date = input.date ?? localDateOf(nowIso(), await timezone());
  return write(["cardio_log"], (w) =>
    w.put("cardio_log", {
      id: ulid(),
      session_id: input.sessionId ?? null,
      date,
      modality: input.modality,
      minutes: input.minutes,
      hard_minutes: input.hardMinutes ?? (input.intensity === "easy" ? 0 : null),
      intensity: input.intensity,
      avg_hr: input.avgHr ?? null,
      source: input.source ?? "manual",
      deleted_at: null,
    }),
  );
}

/** A walk: cardio_log without a session. Adds walking minutes, never counts as a session. */
export async function logWalk(date: string | undefined, minutes: number): Promise<CardioLog> {
  return logCardio({ sessionId: null, date, modality: "walk", minutes, intensity: "easy", hardMinutes: 0 });
}

export async function updateCardio(
  id: string,
  patch: Partial<Pick<CardioLog, "minutes" | "hard_minutes" | "intensity" | "avg_hr" | "modality" | "date">>,
): Promise<CardioLog> {
  return write(["cardio_log"], async (w) => w.put("cardio_log", { ...(await requireRow("cardio_log", id)), ...patch }));
}

export async function deleteCardio(id: string): Promise<void> {
  await write(["cardio_log"], async (w) => {
    const cur = await db.cardio_log.get(id);
    if (cur && !cur.deleted_at) await w.put("cardio_log", softDelete(cur, w.now));
  });
}

// ---------------- check-in and weeks ----------------

export interface CheckinInput {
  date: string;
  sleep: number;
  soreness: number;
  stress: number;
  energy: number;
  hrv?: number | null;
  rhr?: number | null;
  sleepHours?: number | null;
  hrvType?: Checkin["hrv_type"];
}

/** Upserts the check-in for a local date (id "ck_YYYY-MM-DD"). Optional fields keep their stored value when omitted. */
export async function saveCheckin(input: CheckinInput): Promise<Checkin> {
  const id = `ck_${input.date}`;
  return write(["checkin"], async (w) => {
    const cur = await db.checkin.get(id);
    return w.put("checkin", {
      id,
      date: input.date,
      sleep: input.sleep,
      soreness: input.soreness,
      stress: input.stress,
      energy: input.energy,
      hrv: input.hrv !== undefined ? input.hrv : (cur?.hrv ?? null),
      rhr: input.rhr !== undefined ? input.rhr : (cur?.rhr ?? null),
      sleep_hours: input.sleepHours !== undefined ? input.sleepHours : (cur?.sleep_hours ?? null),
      hrv_type: input.hrvType !== undefined ? input.hrvType : (cur?.hrv_type ?? null),
      deleted_at: null,
    });
  });
}

/** Marks a zero week repaired (streak freeze). weekId is "wk_<monday>". Pass false to undo. */
export async function repairWeek(weekId: string, repaired = true): Promise<TrainingWeek> {
  const start = weekId.replace(/^wk_/, "");
  return write(["training_week"], (w) =>
    w.put("training_week", { id: `wk_${start}`, start_date: start, repaired, deleted_at: null }),
  );
}

// ---------------- decisions ----------------

/** JSON with sorted keys, for change detection independent of key order. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/**
 * Upserts engine decisions by id, only when missing (or deleted) or when explanation/output changed.
 * Unchanged rows are not written and not queued. Returns how many rows were written.
 */
export async function persistDecisions(decisions: Decision[]): Promise<number> {
  if (!decisions.length) return 0;
  // Last occurrence wins when the engine repeats an id.
  const byId = new Map(decisions.map((d) => [d.id, d]));
  const existing = await db.decision.bulkGet([...byId.keys()]);
  const changed = [...byId.values()].filter((d, i) => {
    const cur = existing[i];
    return !cur || cur.deleted_at || cur.explanation !== d.explanation || stableJson(cur.output) !== stableJson(d.output);
  });
  if (!changed.length) return 0;
  return write(["decision"], async (w) => {
    for (const d of changed) await w.put("decision", { ...d, deleted_at: null });
    return changed.length;
  });
}

// ---------------- exercises ----------------

export type CustomExerciseInput = Omit<z.input<typeof Exercise>, "id" | "custom" | "source"> & {
  id?: string;
  source?: string;
};

/** Creates or updates a custom exercise (synced). */
export async function saveCustomExercise(input: CustomExerciseInput): Promise<ExerciseRow> {
  const base = Exercise.parse({ source: "custom", ...input, id: input.id ?? ulid(), custom: true });
  return write(["exercise"], (w) => w.put("exercise", { ...base, deleted_at: null }));
}

export async function deleteCustomExercise(id: string): Promise<void> {
  await write(["exercise"], async (w) => {
    const cur = await db.exercise.get(id);
    if (cur && !cur.deleted_at) await w.put("exercise", softDelete(cur, w.now));
  });
}

// ---------------- import support (backup.ts) ----------------

/**
 * Merge import: writes each row as it is (keeping its updated_at) only when local is missing or older,
 * and queues the written rows. Returns how many were written. Internal to the data layer.
 */
export async function _mergeRows(rows: { table: SyncTable; row: RowOf<SyncTable> }[]): Promise<number> {
  if (!rows.length) return 0;
  const tables = [...new Set(rows.map((r) => r.table))];
  const now = nowIso();
  const written = await db.transaction("rw", [db.outbox, ...tables.map((t) => db.table(t))], async () => {
    let n = 0;
    for (const { table, row } of rows) {
      const t = db.table(table);
      const cur = (await t.get(row.id)) as RowOf<SyncTable> | undefined;
      if (cur && Date.parse(row.updated_at) <= Date.parse(cur.updated_at)) continue;
      await t.put(row);
      await db.outbox.add({ table, row_id: row.id, queued_at: now });
      n++;
    }
    return n;
  });
  if (written) syncClient.notifyWrite();
  return written;
}

/** Writes drafts with fresh updated_at (replace import). Internal to the data layer. */
export async function _writeDrafts(rows: { table: SyncTable; row: Draft<SyncTable> }[]): Promise<void> {
  if (!rows.length) return;
  const tables = [...new Set(rows.map((r) => r.table))];
  await write(tables, async (w) => {
    for (const { table, row } of rows) await w.put(table, row as Draft<typeof table>);
  });
}
