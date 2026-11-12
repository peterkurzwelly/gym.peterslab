/**
 * Engine adapter: reads Dexie and builds the EngineContext the pure engine needs.
 */
import { defaultSettings, loadDefaults, type EngineContext } from "@gym/engine";
import type { CardioLog, Checkin, Exercise, ExerciseRow, Session, SetLog, Settings, TrainingWeek } from "@gym/schema";
import { db, type WorkoutDb } from "./db";
import { nowIso } from "./clock";

type Defaults = ReturnType<typeof loadDefaults>;
let defaults: Defaults | null = null;

/** Bundled configs + exercise library, parsed once per page load. */
export function getDefaults(): Defaults {
  if (!defaults) defaults = loadDefaults();
  return defaults;
}

/** Tests only: forget the memoized defaults. */
export function resetDefaultsForTests(): void {
  defaults = null;
}

/** Everything the engine reads from Dexie, without deleted rows. */
export interface DataSnapshot {
  settings: Settings | null;
  sessions: Session[];
  setLogs: SetLog[];
  cardioLogs: CardioLog[];
  checkins: Checkin[];
  trainingWeeks: TrainingWeek[];
  customExercises: ExerciseRow[];
}

const alive = <T extends { deleted_at: string | null }>(rows: T[]) => rows.filter((r) => r.deleted_at == null);

/** Reads every table the engine needs in one read transaction (also the live query source). */
export async function readSnapshot(database: WorkoutDb = db): Promise<DataSnapshot> {
  return database.transaction(
    "r",
    [
      database.settings,
      database.session,
      database.set_log,
      database.cardio_log,
      database.checkin,
      database.training_week,
      database.exercise,
    ],
    async () => {
      const [settings, sessions, setLogs, cardioLogs, checkins, trainingWeeks, exercises] = await Promise.all([
        database.settings.get("settings"),
        database.session.orderBy("started_at").toArray(),
        database.set_log.toArray(),
        database.cardio_log.toArray(),
        database.checkin.toArray(),
        database.training_week.toArray(),
        database.exercise.toArray(),
      ]);
      return {
        settings: settings && settings.deleted_at == null ? settings : null,
        sessions: alive(sessions),
        setLogs: alive(setLogs),
        cardioLogs: alive(cardioLogs),
        checkins: alive(checkins),
        trainingWeeks: alive(trainingWeeks),
        customExercises: alive(exercises),
      };
    },
  );
}

function stripSync(row: ExerciseRow): Exercise {
  const { updated_at: _u, deleted_at: _d, ...exercise } = row;
  return exercise;
}

/** Pure: snapshot + now → EngineContext. Missing settings fall back to fresh install defaults in memory. */
export function buildContext(snapshot: DataSnapshot, now: string = nowIso()): EngineContext {
  const { config, program, exercises: library } = getDefaults();
  const exercises: Record<string, Exercise> = { ...library };
  for (const row of snapshot.customExercises) exercises[row.id] = stripSync(row);
  return {
    config,
    program,
    exercises,
    settings: snapshot.settings ?? defaultSettings(config, program, now),
    history: {
      sessions: snapshot.sessions,
      setLogs: snapshot.setLogs,
      cardioLogs: snapshot.cardioLogs,
      checkins: snapshot.checkins,
      trainingWeeks: snapshot.trainingWeeks,
      customExercises: snapshot.customExercises,
    },
    now,
  };
}

/** One shot: read Dexie and build the context (used outside React, e.g. finishSession). */
export async function loadContext(now: string = nowIso(), database: WorkoutDb = db): Promise<EngineContext> {
  return buildContext(await readSnapshot(database), now);
}

/**
 * Cheap content signature of groups of rows (FNV-1a over ids and updated_at). Every write bumps updated_at,
 * so equal signatures mean equal data.
 */
export function rowsSignature(groups: { id: string; updated_at: string }[][]): string {
  let h = 0x811c9dc5;
  const mix = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  };
  const counts: number[] = [];
  for (const rows of groups) {
    counts.push(rows.length);
    for (const r of rows) {
      mix(r.id);
      mix(r.updated_at);
    }
    mix("|");
  }
  return `${counts.join(".")}:${(h >>> 0).toString(36)}`;
}

/** Signature of a snapshot, so several hook instances can share one computeState result for identical data. */
export function snapshotSignature(snapshot: DataSnapshot): string {
  return rowsSignature([
    snapshot.settings ? [snapshot.settings] : [],
    snapshot.sessions,
    snapshot.setLogs,
    snapshot.cardioLogs,
    snapshot.checkins,
    snapshot.trainingWeeks,
    snapshot.customExercises,
  ]);
}
