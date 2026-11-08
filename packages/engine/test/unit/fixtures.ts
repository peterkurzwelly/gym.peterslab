/**
 * Unit test fixtures: real config/engine.json + config/program.json, an inline exercise library
 * (data/exercises.json is produced elsewhere) and a small history builder.
 */
import { EngineConfig, ProgramConfig } from "@gym/schema";
import type { CardioLog, Checkin, DayCode, Equipment, Exercise, Muscle, Pattern, Session, SessionMode, SetLog, Settings, TrainingWeek } from "@gym/schema";
import type { EngineContext } from "../../src/types";
import { defaultSettings } from "../../src/defaults";
import { addDays, localMidnightMs } from "../../src/dates";
import engineJson from "../../../../config/engine.json" with { type: "json" };
import programJson from "../../../../config/program.json" with { type: "json" };

export const TZ = "Europe/Stockholm";
export const config: EngineConfig = EngineConfig.parse(engineJson);
export const program: ProgramConfig = ProgramConfig.parse(programJson);
/** Monday 2026-11-09, the program's default start. */
export const BLOCK_START = program.default_start_date;

type ExOpts = Partial<Pick<Exercise, "measure" | "per_hand" | "bodyweight" | "tags" | "fatigue_rating" | "default_rest_s">>;

function ex(
  id: string,
  name: string,
  pattern: Pattern,
  primary: Muscle[],
  secondary: Muscle[],
  equipment: Equipment,
  increment_kg: number,
  step_kg: number,
  o: ExOpts = {},
): Exercise {
  return {
    id,
    name,
    pattern,
    primary_muscles: primary,
    secondary_muscles: secondary,
    equipment,
    fatigue_rating: o.fatigue_rating ?? 2,
    increment_kg,
    step_kg,
    default_rest_s: o.default_rest_s ?? 90,
    tags: o.tags ?? [],
    measure: o.measure ?? "reps",
    per_hand: o.per_hand ?? false,
    bodyweight: o.bodyweight ?? false,
    instructions: [],
    source: "test",
    source_id: null,
    custom: false,
  };
}

const BB = 2.5; // barbell increment
const DB = 2; // dumbbell pair step
const MC = 5; // machine stack
const CB = 2.5; // cable

const LIST: Exercise[] = [
  // Session A
  ex("back_squat", "Back squat", "squat", ["quads", "glutes"], ["hamstrings", "lower_back"], "barbell", BB, 5, { tags: ["deep_knee_flexion"], fatigue_rating: 3 }),
  ex("hack_squat", "Hack squat", "squat", ["quads"], ["glutes"], "machine", MC, MC, { tags: ["knee_friendly", "low_spinal_load"] }),
  ex("goblet_squat", "Goblet squat", "squat", ["quads", "glutes"], ["core"], "dumbbell", DB, DB, { tags: ["deep_knee_flexion"] }),
  ex("leg_press", "Leg press", "squat", ["quads", "glutes"], ["hamstrings"], "machine", MC, MC, { tags: ["knee_friendly", "low_spinal_load"] }),
  ex("bench_press", "Bench press", "h_push", ["chest"], ["triceps", "shoulders"], "barbell", BB, BB, { fatigue_rating: 3 }),
  ex("dumbbell_bench_press", "Dumbbell bench press", "h_push", ["chest"], ["triceps", "shoulders"], "dumbbell", DB, DB, { per_hand: true }),
  ex("chest_supported_row", "Chest supported row", "h_pull", ["back"], ["biceps"], "machine", MC, MC),
  ex("seated_cable_row", "Seated cable row", "h_pull", ["back"], ["biceps"], "cable", CB, CB),
  ex("romanian_deadlift", "Romanian deadlift", "hinge", ["hamstrings", "glutes"], ["lower_back"], "barbell", BB, 5, { fatigue_rating: 3 }),
  ex("back_extension", "Back extension", "hinge", ["lower_back"], ["glutes", "hamstrings"], "bodyweight", BB, BB, { bodyweight: true }),
  ex("lateral_raise", "Lateral raise", "isolation", ["shoulders"], [], "dumbbell", DB, DB, { per_hand: true }),
  ex("cable_lateral_raise", "Cable lateral raise", "isolation", ["shoulders"], [], "cable", CB, CB, { tags: ["unilateral"] }),
  ex("plank", "Plank", "core", ["core"], [], "bodyweight", BB, BB, { measure: "seconds", bodyweight: true }),
  ex("dead_bug", "Dead bug", "core", ["core"], [], "bodyweight", BB, BB, { bodyweight: true }),
  // Session B
  ex("trap_bar_deadlift", "Trap bar deadlift", "hinge", ["glutes", "hamstrings", "quads"], ["back", "lower_back", "traps"], "trap_bar", BB, 5, { fatigue_rating: 3 }),
  ex("conventional_deadlift", "Deadlift", "hinge", ["glutes", "hamstrings"], ["back", "lower_back"], "barbell", BB, 5, { fatigue_rating: 3 }),
  ex("overhead_press", "Overhead press", "v_push", ["shoulders"], ["triceps"], "barbell", BB, BB),
  ex("dumbbell_shoulder_press", "Dumbbell shoulder press", "v_push", ["shoulders"], ["triceps"], "dumbbell", DB, DB, { per_hand: true }),
  ex("seated_dumbbell_press", "Seated dumbbell press", "v_push", ["shoulders"], ["triceps"], "dumbbell", DB, DB, { per_hand: true }),
  ex("pull_up", "Pull-up", "v_pull", ["back"], ["biceps"], "bodyweight", BB, BB, { bodyweight: true }),
  ex("lat_pulldown", "Lat pulldown", "v_pull", ["back"], ["biceps"], "cable", CB, CB),
  ex("assisted_pull_up", "Assisted pull-up", "v_pull", ["back"], ["biceps"], "machine", MC, MC),
  ex("bulgarian_split_squat", "Bulgarian split squat", "lunge", ["quads", "glutes"], ["hamstrings"], "dumbbell", DB, DB, { per_hand: true, tags: ["deep_knee_flexion", "unilateral"] }),
  ex("walking_lunge", "Walking lunge", "lunge", ["quads", "glutes"], ["hamstrings"], "dumbbell", DB, DB, { per_hand: true, tags: ["unilateral"] }),
  ex("step_up", "Step-up", "lunge", ["quads", "glutes"], [], "dumbbell", DB, DB, { per_hand: true, tags: ["unilateral", "knee_friendly"] }),
  ex("face_pull", "Face pull", "h_pull", ["shoulders"], ["traps", "back"], "cable", CB, CB),
  ex("reverse_fly", "Reverse fly", "isolation", ["shoulders"], ["back"], "dumbbell", DB, DB, { per_hand: true }),
  ex("hanging_knee_raise", "Hanging knee raise", "core", ["core"], [], "bodyweight", BB, BB, { bodyweight: true }),
  ex("cable_crunch", "Cable crunch", "core", ["core"], [], "cable", CB, CB),
  // Session C
  ex("incline_dumbbell_press", "Incline dumbbell press", "h_push", ["chest"], ["shoulders", "triceps"], "dumbbell", DB, DB, { per_hand: true }),
  ex("incline_machine_press", "Incline machine press", "h_push", ["chest"], ["shoulders", "triceps"], "machine", MC, MC),
  ex("one_arm_dumbbell_row", "One arm dumbbell row", "h_pull", ["back"], ["biceps"], "dumbbell", DB, DB, { tags: ["unilateral"] }),
  ex("machine_row", "Machine row", "h_pull", ["back"], ["biceps"], "machine", MC, MC),
  ex("hamstring_curl", "Hamstring curl", "isolation", ["hamstrings"], [], "machine", MC, MC, { tags: ["knee_friendly"] }),
  ex("nordic_curl", "Nordic curl", "isolation", ["hamstrings"], [], "bodyweight", BB, BB, { bodyweight: true }),
  ex("biceps_curl", "Biceps curl", "isolation", ["biceps"], ["forearms"], "dumbbell", DB, DB, { per_hand: true }),
  ex("cable_biceps_curl", "Cable biceps curl", "isolation", ["biceps"], [], "cable", CB, CB),
  ex("triceps_pushdown", "Triceps pushdown", "isolation", ["triceps"], [], "cable", CB, CB),
  ex("overhead_triceps_extension", "Overhead triceps extension", "isolation", ["triceps"], [], "cable", CB, CB),
  ex("farmers_carry", "Farmer's carry", "carry", ["forearms", "traps"], ["core"], "dumbbell", DB, DB, { per_hand: true, measure: "meters" }),
  ex("suitcase_carry", "Suitcase carry", "carry", ["core", "forearms"], [], "dumbbell", DB, DB, { measure: "meters", tags: ["unilateral"] }),
  // Travel
  ex("push_up", "Push-up", "h_push", ["chest"], ["triceps", "shoulders"], "bodyweight", BB, BB, { bodyweight: true }),
  ex("dumbbell_romanian_deadlift", "Dumbbell Romanian deadlift", "hinge", ["hamstrings", "glutes"], ["lower_back"], "dumbbell", DB, DB, { per_hand: true }),
  ex("split_squat", "Split squat", "lunge", ["quads", "glutes"], [], "dumbbell", DB, DB, { per_hand: true, tags: ["unilateral"] }),
];

export const exercises: Record<string, Exercise> = Object.fromEntries(LIST.map((e) => [e.id, e]));

/** Instant (ISO UTC) of a local wall clock time in Stockholm. */
export function at(date: string, hhmm = "18:00"): string {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(localMidnightMs(date, TZ) + ((h ?? 0) * 60 + (m ?? 0)) * 60_000).toISOString();
}

export function settings(over: Partial<Settings> = {}): Settings {
  return { ...defaultSettings(config, program, at(BLOCK_START, "00:00")), ...over };
}

export type SetSpec = [weight: number, reps: number, rir?: number | null];

export interface ExerciseLog {
  pid: string;
  /** Defaults to the prescription's exercise. */
  ex?: string;
  sets: SetSpec[];
  pain?: boolean;
  warmups?: SetSpec[];
  top?: SetSpec[];
}

export interface SessionSpec {
  code: DayCode;
  date: string;
  time?: string;
  mode?: SessionMode;
  ended?: boolean;
  durationMin?: number;
  exercises?: ExerciseLog[];
  flags?: Session["flags"];
  swaps?: Record<string, string>;
  cardio?: { minutes: number; hard_minutes?: number | null; intensity?: "easy" | "hard"; modality?: CardioLog["modality"] };
}

const prescriptions = new Map(program.days.flatMap((d) => d.prescriptions.map((p) => [p.id, p] as const)));

/** Small deterministic history builder. Ids are sequential so runs are reproducible. */
export class History {
  sessions: Session[] = [];
  setLogs: SetLog[] = [];
  cardioLogs: CardioLog[] = [];
  checkins: Checkin[] = [];
  trainingWeeks: TrainingWeek[] = [];
  private seq = 0;

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}${String(this.seq).padStart(4, "0")}`;
  }

  session(spec: SessionSpec): Session {
    const start = at(spec.date, spec.time ?? "18:00");
    const startMs = Date.parse(start);
    const id = this.id("s");
    let minute = 0;
    const iso = () => new Date(startMs + (minute += 2) * 60_000).toISOString();
    for (const e of spec.exercises ?? []) {
      const p = prescriptions.get(e.pid);
      const exerciseId = e.ex ?? p?.exercise_id ?? e.pid;
      let idx = 0;
      const add = (s: SetSpec, warm: boolean, top: boolean, pain: boolean) =>
        this.setLogs.push({
          id: this.id("l"),
          session_id: id,
          exercise_id: exerciseId,
          prescription_id: p ? e.pid : null,
          set_index: idx++,
          target_weight: null,
          target_reps: null,
          target_rir: null,
          weight: s[0],
          reps: s[1],
          rir: s[2] === undefined ? 3 : s[2],
          is_warmup: warm,
          is_top_set: top,
          pain_flag: pain,
          completed_at: iso(),
          updated_at: iso(),
          deleted_at: null,
        });
      for (const w of e.warmups ?? []) add(w, true, false, false);
      e.sets.forEach((s, i) => add(s, false, false, !!e.pain && i === e.sets.length - 1));
      for (const t of e.top ?? []) add(t, false, true, false);
    }
    if (spec.cardio) {
      this.cardioLogs.push({
        id: this.id("c"),
        session_id: id,
        date: spec.date,
        modality: spec.cardio.modality ?? "bike",
        minutes: spec.cardio.minutes,
        hard_minutes: spec.cardio.hard_minutes ?? null,
        intensity: spec.cardio.intensity ?? "hard",
        avg_hr: null,
        source: "manual",
        updated_at: start,
        deleted_at: null,
      });
    }
    const ended = spec.ended === false ? null : new Date(startMs + (spec.durationMin ?? Math.max(minute + 2, 45)) * 60_000).toISOString();
    const session: Session = {
      id,
      program_day_id: spec.code,
      started_at: start,
      ended_at: ended,
      mode: spec.mode ?? (spec.code === "TRAVEL" ? "travel" : "full"),
      flags: spec.flags ?? [],
      swaps: spec.swaps ?? {},
      notes: null,
      updated_at: ended ?? start,
      deleted_at: null,
    };
    this.sessions.push(session);
    return session;
  }

  /** Strength session where every listed prescription logs the same sets. */
  simple(code: DayCode, date: string, pids: string[], sets: SetSpec[], extra: Partial<SessionSpec> = {}): Session {
    return this.session({ code, date, exercises: pids.map((pid) => ({ pid, sets })), ...extra });
  }

  cardio(date: string, minutes = 26, intensity: "easy" | "hard" = "hard", time = "07:00"): Session {
    return this.session({ code: "CARDIO", date, time, cardio: { minutes, intensity, hard_minutes: intensity === "hard" ? 8 : 0 }, durationMin: minutes });
  }

  walk(date: string, minutes: number): CardioLog {
    const log: CardioLog = {
      id: this.id("w"),
      session_id: null,
      date,
      modality: "walk",
      minutes,
      hard_minutes: null,
      intensity: "easy",
      avg_hr: null,
      source: "manual",
      updated_at: at(date, "20:00"),
      deleted_at: null,
    };
    this.cardioLogs.push(log);
    return log;
  }

  checkin(date: string, sleep: number, soreness = sleep, stress = sleep, energy = sleep): Checkin {
    const c: Checkin = {
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
    };
    this.checkins.push(c);
    return c;
  }

  repair(monday: string): void {
    this.trainingWeeks.push({ id: `wk_${monday}`, start_date: monday, repaired: true, updated_at: at(monday, "12:00"), deleted_at: null });
  }
}

export function ctxOf(h: History, now: string, s: Partial<Settings> = {}): EngineContext {
  return {
    config,
    program,
    exercises,
    settings: settings(s),
    history: { sessions: h.sessions, setLogs: h.setLogs, cardioLogs: h.cardioLogs, checkins: h.checkins, trainingWeeks: h.trainingWeeks },
    now,
  };
}

/** Config with a deep override, for "changing engine.json changes behavior" tests. */
export function withConfig(ctx: EngineContext, mutate: (c: EngineConfig) => void): EngineContext {
  const c = structuredClone(ctx.config);
  mutate(c);
  return { ...ctx, config: c };
}

export function withProgram(ctx: EngineContext, mutate: (p: ProgramConfig) => void): EngineContext {
  const p = structuredClone(ctx.program);
  mutate(p);
  return { ...ctx, program: p };
}

/** Date n days after block start. */
export const day = (n: number) => addDays(BLOCK_START, n);
