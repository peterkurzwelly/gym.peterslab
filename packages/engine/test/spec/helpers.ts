/**
 * Fixture DSL for the black-box spec tests (test/spec/**).
 *
 * - Configs are the real config/engine.json and config/program.json, parsed with the shared Zod schemas.
 *   Tests patch clones with configWith / programWith (or pass a patch function to makeCtx).
 * - The exercise library is inline so the tests do not depend on data/exercises.json.
 * - Every row builder returns rows parsed through @gym/schema, so a fixture can never be invalid.
 * - All dates and times are Europe/Stockholm local; builders convert to ISO UTC.
 *   The block starts Monday 2026-11-09 (CET, UTC+1 until 2027-03-28).
 */
import engineJson from "../../../../config/engine.json";
import programJson from "../../../../config/program.json";
import {
  CardioLog,
  Checkin,
  EngineConfig,
  Exercise,
  ProgramConfig,
  Session,
  SetLog,
  Settings,
  TrainingWeek,
} from "@gym/schema";
import type { CardioIntensity, CardioModality, Muscle, SessionFlag, SessionMode } from "@gym/schema";
import type { EngineContext, EngineHistory, PlannedExercise, SessionPlan } from "../../src/index";

export const TZ = "Europe/Stockholm";
export const BLOCK_START = "2026-11-09";

// ---------------------------------------------------------------- configs

export const BASE_CONFIG: EngineConfig = EngineConfig.parse(engineJson);
export const BASE_PROGRAM: ProgramConfig = ProgramConfig.parse(programJson);

export function configWith(patch: (c: EngineConfig) => void): EngineConfig {
  const c = structuredClone(BASE_CONFIG);
  patch(c);
  return EngineConfig.parse(c);
}

export function programWith(patch: (p: ProgramConfig) => void): ProgramConfig {
  const p = structuredClone(BASE_PROGRAM);
  patch(p);
  return ProgramConfig.parse(p);
}

export type Prescription = ProgramConfig["days"][number]["prescriptions"][number];

export function prescription(program: ProgramConfig, id: string): Prescription {
  for (const d of program.days) {
    const p = d.prescriptions.find((x) => x.id === id);
    if (p) return p;
  }
  throw new Error(`no prescription ${id}`);
}

/** The spec 6.3 example: bench press 3 × 6 to 8 (program.json has 5 to 8). */
export const SPEC_BENCH_PROGRAM = programWith((p) => {
  const a2 = prescription(p, "A2");
  a2.rep_min = 6;
  a2.rep_max = 8;
});

// ---------------------------------------------------------------- exercise library

type ExOpts = {
  step?: number;
  inc?: number;
  fatigue?: number;
  tags?: string[];
  measure?: Exercise["measure"];
  per_hand?: boolean;
  bodyweight?: boolean;
  rest?: number;
};

/** [increment_kg, step_kg] per equipment. Lower body barbell lifts override step to 5. */
const EQUIPMENT_STEPS: Record<Exercise["equipment"], [number, number]> = {
  barbell: [2.5, 2.5],
  trap_bar: [2.5, 5],
  dumbbell: [2, 2],
  kettlebell: [4, 4],
  cable: [2.5, 2.5],
  machine: [5, 5],
  bodyweight: [2.5, 2.5], // added load
  band: [1, 1],
  bench: [2.5, 2.5],
  other: [2.5, 2.5],
};

function defEx(
  id: string,
  name: string,
  pattern: Exercise["pattern"],
  equipment: Exercise["equipment"],
  primary: Muscle[],
  secondary: Muscle[],
  o: ExOpts = {},
): Exercise {
  const [inc, step] = EQUIPMENT_STEPS[equipment];
  return Exercise.parse({
    id,
    name,
    pattern,
    primary_muscles: primary,
    secondary_muscles: secondary,
    equipment,
    fatigue_rating: o.fatigue ?? 2,
    increment_kg: o.inc ?? inc,
    step_kg: o.step ?? step,
    default_rest_s: o.rest ?? 90,
    tags: o.tags ?? [],
    measure: o.measure ?? "reps",
    per_hand: o.per_hand ?? equipment === "dumbbell",
    bodyweight: o.bodyweight ?? equipment === "bodyweight",
    instructions: [],
    source: "spec-test",
    source_id: null,
    custom: false,
  });
}

const LIBRARY_LIST: Exercise[] = [
  // Session A
  defEx("back_squat", "Back squat", "squat", "barbell", ["quads", "glutes"], ["hamstrings", "lower_back", "core"], { step: 5, fatigue: 3, rest: 180, tags: ["deep_knee_flexion"] }),
  defEx("hack_squat", "Hack squat", "squat", "machine", ["quads"], ["glutes"], { tags: ["knee_friendly"] }),
  defEx("goblet_squat", "Goblet squat", "squat", "dumbbell", ["quads", "glutes"], ["core"], { per_hand: false, tags: ["deep_knee_flexion"] }),
  defEx("leg_press", "Leg press", "squat", "machine", ["quads", "glutes"], ["hamstrings"], { tags: ["knee_friendly"] }),
  defEx("bench_press", "Bench press", "h_push", "barbell", ["chest"], ["triceps", "shoulders"], { rest: 180 }),
  defEx("dumbbell_bench_press", "Dumbbell bench press", "h_push", "dumbbell", ["chest"], ["triceps", "shoulders"]),
  defEx("chest_supported_row", "Chest supported row", "h_pull", "machine", ["back"], ["biceps"]),
  defEx("seated_cable_row", "Seated cable row", "h_pull", "cable", ["back"], ["biceps"]),
  defEx("romanian_deadlift", "Romanian deadlift", "hinge", "barbell", ["hamstrings", "glutes"], ["lower_back"], { step: 5 }),
  defEx("back_extension", "Back extension", "hinge", "bodyweight", ["lower_back", "glutes"], ["hamstrings"], { fatigue: 1 }),
  defEx("lateral_raise", "Lateral raise", "isolation", "dumbbell", ["shoulders"], [], { fatigue: 1 }),
  defEx("cable_lateral_raise", "Cable lateral raise", "isolation", "cable", ["shoulders"], [], { fatigue: 1 }),
  defEx("plank", "Plank", "core", "bodyweight", ["core"], [], { measure: "seconds", fatigue: 1 }),
  defEx("dead_bug", "Dead bug", "core", "bodyweight", ["core"], [], { fatigue: 1 }),
  // Session B
  defEx("trap_bar_deadlift", "Trap bar deadlift", "hinge", "trap_bar", ["glutes", "quads", "hamstrings"], ["lower_back", "traps", "forearms"], { fatigue: 3, rest: 180 }),
  defEx("conventional_deadlift", "Conventional deadlift", "hinge", "barbell", ["hamstrings", "glutes", "lower_back"], ["quads", "traps", "forearms"], { step: 5, fatigue: 3, rest: 180 }),
  defEx("overhead_press", "Overhead press", "v_push", "barbell", ["shoulders"], ["triceps"], { rest: 180 }),
  defEx("dumbbell_shoulder_press", "Dumbbell shoulder press", "v_push", "dumbbell", ["shoulders"], ["triceps"]),
  defEx("seated_dumbbell_press", "Seated dumbbell press", "v_push", "dumbbell", ["shoulders"], ["triceps"]),
  defEx("pull_up", "Pull-up", "v_pull", "bodyweight", ["back"], ["biceps"]),
  defEx("lat_pulldown", "Lat pulldown", "v_pull", "cable", ["back"], ["biceps"]),
  defEx("assisted_pull_up", "Assisted pull-up", "v_pull", "machine", ["back"], ["biceps"]),
  defEx("bulgarian_split_squat", "Bulgarian split squat", "lunge", "dumbbell", ["quads", "glutes"], ["hamstrings"], { tags: ["unilateral"] }),
  defEx("walking_lunge", "Walking lunge", "lunge", "dumbbell", ["quads", "glutes"], ["hamstrings"], { tags: ["unilateral"] }),
  defEx("step_up", "Step-up", "lunge", "dumbbell", ["quads", "glutes"], ["hamstrings"], { tags: ["unilateral"] }),
  defEx("face_pull", "Face pull", "h_pull", "cable", ["shoulders"], ["back", "traps"], { fatigue: 1 }),
  defEx("reverse_fly", "Reverse fly", "isolation", "dumbbell", ["shoulders"], ["back"], { fatigue: 1 }),
  defEx("hanging_knee_raise", "Hanging knee raise", "core", "bodyweight", ["core"], [], { fatigue: 1 }),
  defEx("cable_crunch", "Cable crunch", "core", "cable", ["core"], [], { fatigue: 1 }),
  // Session C
  defEx("incline_dumbbell_press", "Incline dumbbell press", "h_push", "dumbbell", ["chest"], ["shoulders", "triceps"]),
  defEx("incline_machine_press", "Incline machine press", "h_push", "machine", ["chest"], ["shoulders", "triceps"]),
  defEx("one_arm_dumbbell_row", "One-arm dumbbell row", "h_pull", "dumbbell", ["back"], ["biceps"], { tags: ["unilateral"] }),
  defEx("machine_row", "Machine row", "h_pull", "machine", ["back"], ["biceps"]),
  defEx("hamstring_curl", "Hamstring curl", "isolation", "machine", ["hamstrings"], [], { fatigue: 1 }),
  defEx("nordic_curl", "Nordic curl", "isolation", "bodyweight", ["hamstrings"], []),
  defEx("biceps_curl", "Biceps curl", "isolation", "dumbbell", ["biceps"], ["forearms"], { fatigue: 1 }),
  defEx("cable_biceps_curl", "Cable biceps curl", "isolation", "cable", ["biceps"], ["forearms"], { fatigue: 1 }),
  defEx("triceps_pushdown", "Triceps pushdown", "isolation", "cable", ["triceps"], [], { fatigue: 1 }),
  defEx("overhead_triceps_extension", "Overhead triceps extension", "isolation", "cable", ["triceps"], [], { fatigue: 1 }),
  defEx("farmers_carry", "Farmer's carry", "carry", "dumbbell", ["forearms", "traps"], ["core"], { measure: "meters" }),
  defEx("suitcase_carry", "Suitcase carry", "carry", "dumbbell", ["core", "forearms"], ["traps"], { measure: "meters", tags: ["unilateral"] }),
  // Travel
  defEx("push_up", "Push-up", "h_push", "bodyweight", ["chest"], ["triceps", "shoulders"], { fatigue: 1 }),
  defEx("dumbbell_romanian_deadlift", "Dumbbell Romanian deadlift", "hinge", "dumbbell", ["hamstrings", "glutes"], ["lower_back"]),
  defEx("split_squat", "Split squat", "lunge", "dumbbell", ["quads", "glutes"], ["hamstrings"], { tags: ["unilateral"] }),
];

export const LIBRARY: Record<string, Exercise> = Object.fromEntries(LIBRARY_LIST.map((e) => [e.id, e]));

export function lib(id: string): Exercise {
  return must(LIBRARY[id], `exercise ${id} not in test library`);
}

/** Every exercise id the program references, including alternatives and travel. */
export function programExerciseIds(program: ProgramConfig = BASE_PROGRAM): string[] {
  const ids = new Set<string>();
  for (const d of program.days)
    for (const p of d.prescriptions) {
      ids.add(p.exercise_id);
      for (const a of p.alternatives) ids.add(a.exercise_id);
    }
  return [...ids].sort();
}

// ---------------------------------------------------------------- settings

export const SETTINGS_UPDATED_AT = "2026-11-08T12:00:00.000Z";

export function makeSettings(patch: Partial<Settings> = {}): Settings {
  return Settings.parse({
    id: "settings",
    block_start_date: BLOCK_START,
    block_number: 1,
    timezone: TZ,
    limitations: [],
    remembered_weights: {},
    interval_modality: "both",
    session_order: ["A", "B", "C"],
    block_swaps: {},
    rest_overrides: {},
    increment_overrides: {},
    start_pct: BASE_CONFIG.calibration.start_pct,
    sound: true,
    updated_at: SETTINGS_UPDATED_AT,
    deleted_at: null,
    ...patch,
  });
}

// ---------------------------------------------------------------- time (Europe/Stockholm)

const DOW = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 } as const;
export type Dow = keyof typeof DOW;

const pad = (n: number) => String(n).padStart(2, "0");

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Local date of a weekday in calendar week `cw` (1 = the week of 2026-11-09). */
export function day(cw: number, dow: Dow): string {
  return addDays(BLOCK_START, (cw - 1) * 7 + DOW[dow]);
}

/** Monday of calendar week `cw`. */
export function monday(cw: number): string {
  return day(cw, "mon");
}

/** Engine week id of calendar week `cw`. */
export function weekId(cw: number): string {
  return `wk_${monday(cw)}`;
}

const zoned = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function zonedParts(ms: number) {
  const parts = zoned.formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? NaN);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour"), mi: get("minute"), s: get("second") };
}

function offsetMs(ms: number): number {
  const p = zonedParts(ms);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/** ISO UTC instant of a Stockholm wall-clock time. */
export function at(date: string, hhmm = "18:00"): string {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi] = hhmm.split(":").map(Number) as [number, number];
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let utc = wall - offsetMs(wall - 3_600_000);
  utc = wall - offsetMs(utc);
  return new Date(utc).toISOString();
}

/** Stockholm local date of an ISO instant (test side, independent of the engine). */
export function localDateOf(iso: string): string {
  const p = zonedParts(Date.parse(iso));
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
}

export function plusMinutes(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
}

export function plusHours(iso: string, hours: number): string {
  return plusMinutes(iso, hours * 60);
}

// ---------------------------------------------------------------- history rows

/** A slice of history produced by one builder. `id` is the session id when there is one. */
export interface Part extends Partial<EngineHistory> {
  id?: string;
}

export function emptyHistory(): EngineHistory {
  return { sessions: [], setLogs: [], cardioLogs: [], checkins: [], trainingWeeks: [] };
}

/** Merge builder output into one EngineHistory. Accepts nested arrays. */
export function hist(...parts: (Part | Part[])[]): EngineHistory {
  const h = emptyHistory();
  for (const part of parts.flat()) {
    h.sessions.push(...(part.sessions ?? []));
    h.setLogs.push(...(part.setLogs ?? []));
    h.cardioLogs.push(...(part.cardioLogs ?? []));
    h.checkins.push(...(part.checkins ?? []));
    h.trainingWeeks.push(...(part.trainingWeeks ?? []));
    if (part.customExercises) (h.customExercises ??= []).push(...part.customExercises);
  }
  return h;
}

/** [weight, reps (or seconds / meters), rir]. */
export type SetTuple = readonly [weight: number, reps: number, rir: number | null];

export interface ExerciseLog {
  sets: readonly SetTuple[];
  /** pain_flag on the last working set. */
  pain?: boolean;
  /** Prescription id; resolved from the program day when omitted. */
  pid?: string;
  warmups?: readonly SetTuple[];
  /** Sets logged with is_top_set (consolidate). */
  top?: readonly SetTuple[];
}

export type ExerciseEntry = readonly SetTuple[] | ExerciseLog;

export type StrengthCode = "A" | "B" | "C" | "TRAVEL";

export interface StrengthSpec {
  code: StrengthCode;
  date: string; // local date
  time?: string; // local "HH:MM", default 18:00
  mode?: SessionMode;
  flags?: SessionFlag[];
  /** Duration; default 50 (full), 30 (short / travel). */
  minutes?: number;
  /** Not finished: ended_at = null. Sets are then 3 minutes apart. */
  open?: boolean;
  swaps?: Record<string, string>;
  id?: string;
  deleted?: boolean;
  /** Program used to resolve prescription ids (default BASE_PROGRAM). */
  program?: ProgramConfig;
  /** exercise_id -> sets. */
  log: Record<string, ExerciseEntry>;
}

function resolvePid(program: ProgramConfig, code: StrengthCode, exerciseId: string, swaps: Record<string, string>): string {
  const d = must(program.days.find((x) => x.code === code), `no day ${code}`);
  for (const p of d.prescriptions) if (swaps[p.id] === exerciseId) return p.id;
  for (const p of d.prescriptions) if (p.exercise_id === exerciseId) return p.id;
  for (const p of d.prescriptions) if (p.alternatives.some((a) => a.exercise_id === exerciseId)) return p.id;
  throw new Error(`${exerciseId} is not part of day ${code}`);
}

export function strength(spec: StrengthSpec): Part {
  const program = spec.program ?? BASE_PROGRAM;
  const swaps = spec.swaps ?? {};
  const mode: SessionMode = spec.mode ?? (spec.code === "TRAVEL" ? "travel" : "full");
  const id = spec.id ?? `s_${spec.date}_${spec.code}`;
  const start = at(spec.date, spec.time ?? "18:00");
  const minutes = spec.minutes ?? (mode === "short" || spec.code === "TRAVEL" ? 30 : 50);

  type Row = { exercise: string; pid: string; set: SetTuple; warmup: boolean; top: boolean; pain: boolean; index: number };
  const rows: Row[] = [];
  for (const [exercise, entry] of Object.entries(spec.log)) {
    const e: ExerciseLog = "sets" in entry ? entry : { sets: entry };
    const pid = e.pid ?? resolvePid(program, spec.code, exercise, swaps);
    let index = 0;
    for (const s of e.warmups ?? []) rows.push({ exercise, pid, set: s, warmup: true, top: false, pain: false, index: index++ });
    e.sets.forEach((s, i) =>
      rows.push({ exercise, pid, set: s, warmup: false, top: false, pain: !!e.pain && i === e.sets.length - 1, index: index++ }),
    );
    for (const s of e.top ?? []) rows.push({ exercise, pid, set: s, warmup: false, top: true, pain: false, index: index++ });
  }

  const n = rows.length;
  const completedAt = (i: number) =>
    spec.open ? plusMinutes(start, 3 * (i + 1)) : plusMinutes(start, Math.round(((i + 1) * minutes) / (n + 1)));
  const ended = spec.open ? null : plusMinutes(start, minutes);
  const updated = ended ?? (n > 0 ? completedAt(n - 1) : start);
  const deleted = spec.deleted ? updated : null;

  const session = Session.parse({
    id,
    program_day_id: spec.code,
    started_at: start,
    ended_at: ended,
    mode,
    flags: spec.flags ?? [],
    swaps,
    notes: null,
    updated_at: updated,
    deleted_at: deleted,
  });

  const setLogs = rows.map((r, i) =>
    SetLog.parse({
      id: `${id}_${r.exercise}_${r.index}`,
      session_id: id,
      exercise_id: r.exercise,
      prescription_id: r.pid,
      set_index: r.index,
      target_weight: null,
      target_reps: null,
      target_rir: null,
      weight: r.set[0],
      reps: r.set[1],
      rir: r.set[2],
      is_warmup: r.warmup,
      is_top_set: r.top,
      pain_flag: r.pain,
      completed_at: completedAt(i),
      updated_at: completedAt(i),
      deleted_at: deleted,
    }),
  );
  return { id, sessions: [session], setLogs };
}

/** n identical sets. */
export function sets(n: number, weight: number, reps: number, rir: number | null): SetTuple[] {
  return Array.from({ length: n }, () => [weight, reps, rir] as const);
}

/** One set per reps value, same weight and rir. */
export function repsAt(weight: number, reps: number[], rir: number | null | (number | null)[]): SetTuple[] {
  return reps.map((r, i) => [weight, r, Array.isArray(rir) ? (rir[i] ?? null) : rir] as const);
}

export interface CardioSpec {
  date: string;
  time?: string; // default 10:00
  minutes: number;
  intensity: CardioIntensity;
  hard_minutes?: number | null;
  modality?: CardioModality;
  id?: string;
  open?: boolean;
}

export function cardio(spec: CardioSpec): Part {
  const id = spec.id ?? `c_${spec.date}`;
  const start = at(spec.date, spec.time ?? "10:00");
  const end = spec.open ? null : plusMinutes(start, spec.minutes);
  const updated = end ?? start;
  const session = Session.parse({
    id,
    program_day_id: "CARDIO",
    started_at: start,
    ended_at: end,
    mode: "full",
    flags: [],
    swaps: {},
    notes: null,
    updated_at: updated,
    deleted_at: null,
  });
  const log = CardioLog.parse({
    id: `${id}_log`,
    session_id: id,
    date: spec.date,
    modality: spec.modality ?? "bike",
    minutes: spec.minutes,
    hard_minutes: spec.hard_minutes ?? (spec.intensity === "easy" ? 0 : null),
    intensity: spec.intensity,
    avg_hr: null,
    source: "timer",
    updated_at: updated,
    deleted_at: null,
  });
  return { id, sessions: [session], cardioLogs: [log] };
}

/** 4x4 style interval session per PROGRAM.md for training week tw (26 / 31 / 38 min). */
export function intervals(date: string, tw = 1, time = "10:00"): Part {
  const p = tw <= 2 ? { total: 26, hard: 8 } : tw <= 4 ? { total: 31, hard: 12 } : { total: 38, hard: 16 };
  return cardio({ date, time, minutes: p.total, intensity: "hard", hard_minutes: p.hard });
}

export function easyCardio(date: string, minutes = 30, time = "10:00"): Part {
  return cardio({ date, time, minutes, intensity: "easy", hard_minutes: 0 });
}

/** Walking log: no session, never counts as a session. */
export function walk(date: string, minutes: number): Part {
  return {
    cardioLogs: [
      CardioLog.parse({
        id: `w_${date}_${minutes}`,
        session_id: null,
        date,
        modality: "walk",
        minutes,
        hard_minutes: null,
        intensity: "easy",
        avg_hr: null,
        source: "manual",
        updated_at: at(date, "21:00"),
        deleted_at: null,
      }),
    ],
  };
}

/** Check-in with scores [sleep, soreness, stress, energy], 1..5, higher is better. */
export function checkin(date: string, scores: readonly [number, number, number, number]): Part {
  const [sleep, soreness, stress, energy] = scores;
  return {
    checkins: [
      Checkin.parse({
        id: `ck_${date}`,
        date,
        sleep,
        soreness,
        stress,
        energy,
        hrv: null,
        rhr: null,
        sleep_hours: null,
        hrv_type: null,
        updated_at: at(date, "07:00"),
        deleted_at: null,
      }),
    ],
  };
}

/** A repaired (streak frozen) week, keyed by its Monday. */
export function repairedWeek(mondayDate: string): Part {
  return {
    trainingWeeks: [
      TrainingWeek.parse({
        id: `wk_${mondayDate}`,
        start_date: mondayDate,
        repaired: true,
        updated_at: at(addDays(mondayDate, 7), "12:00"),
        deleted_at: null,
      }),
    ],
  };
}

// ---------------------------------------------------------------- canned histories

/** Starting loads for steady histories (kg; 0 = bodyweight). */
export const BASE_LOAD: Record<string, number> = {
  back_squat: 60,
  bench_press: 50,
  chest_supported_row: 40,
  romanian_deadlift: 50,
  lateral_raise: 8,
  plank: 0,
  trap_bar_deadlift: 80,
  overhead_press: 35,
  pull_up: 0,
  bulgarian_split_squat: 12,
  face_pull: 15,
  hanging_knee_raise: 0,
  leg_press: 100,
  incline_dumbbell_press: 16,
  seated_cable_row: 45,
  hamstring_curl: 30,
  biceps_curl: 10,
  triceps_pushdown: 20,
  farmers_carry: 24,
  goblet_squat: 20,
  dumbbell_bench_press: 20,
  one_arm_dumbbell_row: 22,
  dumbbell_romanian_deadlift: 20,
  split_squat: 12,
  push_up: 0,
};

/**
 * Every default exercise of a day at exposure k: weight = base + step × floor(k / 2), reps = middle of the range + (k mod 2).
 * So e1RM rises on every exposure (no stall, no e1RM drop) and reps always sit inside the range (no below range).
 */
export function dayLog(code: StrengthCode, k: number, o: { sets?: number; rir?: number; only?: string[] } = {}): Record<string, ExerciseEntry> {
  const d = must(BASE_PROGRAM.days.find((x) => x.code === code), `no day ${code}`);
  const out: Record<string, ExerciseEntry> = {};
  for (const p of d.prescriptions) {
    if (o.only && !o.only.includes(p.exercise_id)) continue;
    const base = BASE_LOAD[p.exercise_id] ?? 0;
    const weight = base === 0 ? 0 : base + lib(p.exercise_id).step_kg * Math.floor(k / 2);
    const reps = Math.floor((p.rep_min + p.rep_max) / 2) + (k % 2);
    out[p.exercise_id] = sets(o.sets ?? 3, weight, reps, o.rir ?? 3);
  }
  return out;
}

/**
 * Regular weeks: A Monday, B Wednesday, C Friday at 18:00 (+ cardio Saturday 10:00 unless cardio: false).
 * Week 8 cardio is the 30 min easy deload session, other weeks intervals. Exposure index k = cw − 1.
 * No session flags are stored: the engine derives phase, deload and modifiers from the history.
 */
export function steadyWeeks(from: number, to: number, o: { cardio?: boolean; sets?: number } = {}): Part[] {
  const out: Part[] = [];
  for (let cw = from; cw <= to; cw++) {
    const k = cw - 1;
    const so = o.sets === undefined ? {} : { sets: o.sets };
    out.push(strength({ code: "A", date: day(cw, "mon"), log: dayLog("A", k, so) }));
    out.push(strength({ code: "B", date: day(cw, "wed"), log: dayLog("B", k, so) }));
    out.push(strength({ code: "C", date: day(cw, "fri"), log: dayLog("C", k, so) }));
    if (o.cardio !== false) out.push(cw === 8 ? easyCardio(day(cw, "sat")) : intervals(day(cw, "sat"), cw));
  }
  return out;
}

/**
 * Cheap non zero weeks that touch no lift the tests look at: two C sessions (leg press only),
 * Monday and Thursday, so no gap between sessions ever reaches the 7 day break threshold.
 */
export function fillerWeeks(from: number, to: number): Part[] {
  const out: Part[] = [];
  for (let cw = from; cw <= to; cw++) {
    const w = 100 + 5 * (cw - 1);
    out.push(strength({ code: "C", date: day(cw, "mon"), id: `f_${day(cw, "mon")}`, log: { leg_press: sets(2, w, 10, 3) } }));
    out.push(strength({ code: "C", date: day(cw, "thu"), id: `f_${day(cw, "thu")}`, log: { leg_press: sets(2, w, 11, 3) } }));
  }
  return out;
}

/** History rows that exist at `nowIso` (sessions started, check-ins and walks dated up to today). */
export function upTo(h: EngineHistory, nowIso: string): EngineHistory {
  const now = Date.parse(nowIso);
  const today = localDateOf(nowIso);
  const sessions = h.sessions.filter((s) => Date.parse(s.started_at) <= now);
  const ids = new Set(sessions.map((s) => s.id));
  return {
    sessions,
    setLogs: h.setLogs.filter((l) => ids.has(l.session_id) && Date.parse(l.completed_at) <= now),
    cardioLogs: h.cardioLogs.filter((c) => (c.session_id === null ? c.date <= today : ids.has(c.session_id))),
    checkins: h.checkins.filter((c) => c.date <= today),
    trainingWeeks: h.trainingWeeks.filter((w) => w.start_date <= today),
    ...(h.customExercises ? { customExercises: h.customExercises } : {}),
  };
}

// ---------------------------------------------------------------- context

export interface CtxInput {
  now: string;
  settings?: Partial<Settings>;
  history?: EngineHistory | (Part | Part[])[];
  config?: EngineConfig | ((c: EngineConfig) => void);
  program?: ProgramConfig | ((p: ProgramConfig) => void);
  exercises?: Record<string, Exercise>;
}

export function makeCtx(input: CtxInput): EngineContext {
  const config =
    typeof input.config === "function" ? configWith(input.config) : structuredClone(input.config ?? BASE_CONFIG);
  const program =
    typeof input.program === "function" ? programWith(input.program) : structuredClone(input.program ?? BASE_PROGRAM);
  const history = Array.isArray(input.history) ? hist(...input.history) : structuredClone(input.history ?? emptyHistory());
  return {
    config,
    program,
    exercises: structuredClone(input.exercises ?? LIBRARY),
    settings: makeSettings(input.settings),
    history,
    now: input.now,
  };
}

// ---------------------------------------------------------------- assertions helpers

export function must<T>(v: T | null | undefined, msg = "expected a value"): T {
  if (v === null || v === undefined) throw new Error(msg);
  return v;
}

export function planned(plan: SessionPlan, prescriptionId: string): PlannedExercise {
  return must(plan.exercises.find((e) => e.prescription_id === prescriptionId), `${prescriptionId} not in plan ${plan.code}`);
}

export function workSets(pe: PlannedExercise) {
  return pe.sets.filter((s) => s.kind === "work");
}

export function topSets(pe: PlannedExercise) {
  return pe.sets.filter((s) => s.kind === "top");
}

export function trackKey(exerciseId: string, repMin: number, repMax: number): string {
  return `${exerciseId}@${repMin}-${repMax}`;
}

export function keyOf(pe: PlannedExercise): string {
  return trackKey(pe.exercise_id, pe.rep_min, pe.rep_max);
}

const EPS = 1e-9;
const r2 = (x: number) => Math.round(x * 100) / 100;
export const floorTo = (x: number, inc: number) => r2(Math.floor(x / inc + EPS) * inc);
export const ceilTo = (x: number, inc: number) => r2(Math.ceil(x / inc - EPS) * inc);
export const nearestTo = (x: number, inc: number) => r2(Math.round(x / inc) * inc);

/** Epley with RIR, computed test side for fixture derivations. */
export const epley = (w: number, reps: number, rir: number, divisor = BASE_CONFIG.e1rm.divisor) => w * (1 + (reps + rir) / divisor);

/** Fractional sets per muscle of a plan (every planned set, work and top), from the test library. */
export function planMuscleSets(plan: SessionPlan, config: EngineConfig = BASE_CONFIG): Partial<Record<Muscle, number>> {
  const out: Partial<Record<Muscle, number>> = {};
  for (const pe of plan.exercises) {
    const e = lib(pe.exercise_id);
    const n = pe.sets.length;
    for (const m of e.primary_muscles) out[m] = (out[m] ?? 0) + n * config.fractional_sets.primary;
    for (const m of e.secondary_muscles) out[m] = (out[m] ?? 0) + n * config.fractional_sets.secondary;
  }
  return out;
}

/** true when any number nested in `value` satisfies `pred`. */
export function someNumber(value: unknown, pred: (n: number) => boolean): boolean {
  if (typeof value === "number") return pred(value);
  if (Array.isArray(value)) return value.some((v) => someNumber(v, pred));
  if (value && typeof value === "object") return Object.values(value).some((v) => someNumber(v, pred));
  return false;
}

/** Words the copy rules forbid in any explanation, banner or nudge. */
export const GUILT_WORDS = /\bfail(ed|ure)?\b/i;
