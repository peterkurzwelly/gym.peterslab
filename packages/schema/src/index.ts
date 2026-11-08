/**
 * @gym/schema: shared Zod schemas and types for the web app, the Worker and the engine.
 *
 * Conventions
 * - IDs are client generated ULIDs, except singletons with deterministic IDs:
 *   settings ("settings"), checkin ("ck_YYYY-MM-DD"), training_week ("wk_YYYY-MM-DD", the Monday).
 *   Decisions use deterministic IDs built by the engine (see engine docs).
 * - Every synced row has updated_at (ISO 8601 UTC with ms) and deleted_at (ISO or null, soft delete).
 * - Local dates are "YYYY-MM-DD" in the user's timezone (settings.timezone).
 * - Check-in scores are 1..5 where HIGHER IS BETTER for all four (5 = slept great, fresh, calm, high energy).
 * - Weights are kg. Dumbbell exercises log the weight of ONE dumbbell. Bodyweight exercises log added load (0 = bodyweight).
 */
import { z } from "zod";

// ---------- primitives ----------
export const IsoDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/, "ISO UTC timestamp");
export const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
export const Id = z.string().min(1).max(64);

const syncFields = {
  updated_at: IsoDateTime,
  deleted_at: IsoDateTime.nullable(),
};

export const Pattern = z.enum([
  "squat", "hinge", "h_push", "v_push", "h_pull", "v_pull", "lunge", "carry", "core", "isolation",
]);
export type Pattern = z.infer<typeof Pattern>;

/** Curated muscle list used for volume tracking (free-exercise-db names are mapped onto these). */
export const Muscle = z.enum([
  "chest", "back", "shoulders", "biceps", "triceps", "forearms", "traps",
  "quads", "hamstrings", "glutes", "calves", "lower_back", "core",
]);
export type Muscle = z.infer<typeof Muscle>;

export const Equipment = z.enum([
  "barbell", "trap_bar", "dumbbell", "kettlebell", "cable", "machine", "bodyweight", "band", "bench", "other",
]);
export type Equipment = z.infer<typeof Equipment>;

export const Measure = z.enum(["reps", "seconds", "meters"]);
export type Measure = z.infer<typeof Measure>;

/** double = double progression on load. reps_only = progress reps, at top of range suggest load or harder variation. none = log only. */
export const ProgressionRule = z.enum(["double", "reps_only", "none"]);
export type ProgressionRule = z.infer<typeof ProgressionRule>;

export const PhaseName = z.enum(["return", "build", "deload", "push", "consolidate"]);
export type PhaseName = z.infer<typeof PhaseName>;

export const DayCode = z.enum(["A", "B", "C", "CARDIO", "TRAVEL"]);
export type DayCode = z.infer<typeof DayCode>;
export const StrengthDayCode = z.enum(["A", "B", "C"]);
export type StrengthDayCode = z.infer<typeof StrengthDayCode>;

export const SessionMode = z.enum(["full", "short", "travel", "comeback"]);
export type SessionMode = z.infer<typeof SessionMode>;

/** Modifiers the engine applied when the session was planned. Stored on the session for the record. */
export const SessionFlag = z.enum(["comeback", "deload", "readiness", "break_resume", "long_break_restart", "consolidate_top_set"]);
export type SessionFlag = z.infer<typeof SessionFlag>;

export const CardioModality = z.enum(["bike", "rower", "run", "walk", "other"]);
export type CardioModality = z.infer<typeof CardioModality>;
export const CardioIntensity = z.enum(["easy", "hard"]);
export type CardioIntensity = z.infer<typeof CardioIntensity>;

// ---------- exercise library ----------
export const Exercise = z.object({
  id: Id,
  name: z.string(),
  pattern: Pattern,
  primary_muscles: z.array(Muscle).min(1),
  secondary_muscles: z.array(Muscle),
  equipment: Equipment,
  fatigue_rating: z.number().int().min(1).max(3),
  /** Smallest load step, used for rounding (barbell 2.5, dumbbell pair step, machine stack step). */
  increment_kg: z.number().positive(),
  /** Normal progression jump. Lower body barbell lifts use 5, most others equal increment_kg. */
  step_kg: z.number().positive(),
  default_rest_s: z.number().int().positive(),
  /** Limitation tags, for example knee_friendly, low_spinal_load, unilateral, shoulder_friendly, deep_knee_flexion. */
  tags: z.array(z.string()),
  measure: Measure.default("reps"),
  /** true when the logged weight is per dumbbell / per hand. */
  per_hand: z.boolean().default(false),
  /** true when weight is added to bodyweight (pull-up, dip). Load 0 means bodyweight. */
  bodyweight: z.boolean().default(false),
  instructions: z.array(z.string()).default([]),
  source: z.string(),
  source_id: z.string().nullable().default(null),
  custom: z.boolean().default(false),
});
export type Exercise = z.infer<typeof Exercise>;

/** Custom exercises the user creates are synced. Library exercises ship in data/exercises.json. */
export const ExerciseRow = Exercise.extend({ ...syncFields });
export type ExerciseRow = z.infer<typeof ExerciseRow>;

export const ExerciseLibraryFile = z.object({
  source: z.string(),
  license: z.string(),
  exercises: z.array(Exercise),
});
export type ExerciseLibraryFile = z.infer<typeof ExerciseLibraryFile>;

// ---------- program config (config/program.json) ----------
export const Alternative = z.object({
  exercise_id: Id,
  rep_min: z.number().int().positive().optional(),
  rep_max: z.number().int().positive().optional(),
  measure: Measure.optional(),
  progression_rule: ProgressionRule.optional(),
  /** Overrides prescription.per_side when this alternative is used (e.g. one-arm row). */
  per_side: z.boolean().optional(),
});
export type Alternative = z.infer<typeof Alternative>;

export const Prescription = z.object({
  id: Id, // stable, e.g. "A1"
  exercise_id: Id,
  order: z.number().int().positive(),
  sets: z.number().int().positive(), // program default sets (phase rules may override)
  rep_min: z.number().int().positive(),
  rep_max: z.number().int().positive(),
  measure: Measure.default("reps"),
  starred: z.boolean(), // in the 30 min version
  main_lift: z.boolean().default(false),
  per_side: z.boolean().default(false),
  rest_s: z.number().int().positive(),
  alternatives: z.array(Alternative),
  progression_rule: ProgressionRule.default("double"),
  superset_group: z.string().nullable().default(null),
  note: z.string().optional(),
});
export type Prescription = z.infer<typeof Prescription>;

export const ProgramDay = z.object({
  code: DayCode,
  name: z.string(),
  fatigue_tag: z.enum(["heavy_lower", "mixed", "intervals", "circuit"]),
  est_minutes: z.number().int().positive(),
  short_minutes: z.number().int().positive().nullable(),
  has_short_version: z.boolean(),
  rounds: z.number().int().positive().nullable().default(null), // travel circuit
  prescriptions: z.array(Prescription),
});
export type ProgramDay = z.infer<typeof ProgramDay>;

export const SetsRule = z.object({
  weeks: z.tuple([z.number().int(), z.number().int()]), // inclusive training-week range
  main_lift: z.number().int().positive(),
  starred: z.number().int().positive(),
  /** Non starred exercises use their program sets, capped at this value when not null. */
  other_cap: z.number().int().positive().nullable(),
});
export type SetsRule = z.infer<typeof SetsRule>;

export const Phase = z.object({
  name: PhaseName,
  label: z.string(), // "Return phase"
  week_from: z.number().int().positive(),
  week_to: z.number().int().positive(),
  rir_min: z.number().int().min(0),
  rir_max: z.number().int().min(0),
  sets: z.array(SetsRule), // empty for deload (derived from deload config)
  large_jumps: z.boolean(),
  top_set: z.object({ main_lifts: z.boolean(), rir: z.number().int().min(0) }).nullable(),
});
export type Phase = z.infer<typeof Phase>;

export const CardioProtocol = z.object({
  weeks: z.tuple([z.number().int(), z.number().int()]),
  warmup_min: z.number().positive(),
  intervals: z.number().int().positive(),
  hard_min: z.number().positive(),
  easy_min: z.number().positive(),
  cooldown_min: z.number().positive(),
});
export type CardioProtocol = z.infer<typeof CardioProtocol>;

export const ProgramConfig = z.object({
  id: Id,
  name: z.string(),
  version: z.number().int(),
  block_weeks: z.number().int().positive(),
  default_start_date: LocalDate,
  rotation: z.array(StrengthDayCode).min(1),
  main_lifts: z.array(Id),
  warmup: z.string(),
  days: z.array(ProgramDay), // A, B, C, TRAVEL
  phases: z.array(Phase),
  cardio: z.object({
    name: z.string(),
    modalities: z.array(CardioModality),
    protocols: z.array(CardioProtocol),
    deload_easy_min: z.number().positive(),
    hard_description: z.string(),
  }),
  travel: z.object({ counts_toward_floor: z.boolean(), advances_rotation: z.boolean() }),
  /** Limitation id -> how it filters exercise choice. Peter to confirm the entries (SPEC 11.1). */
  limitations: z.record(
    z.string(),
    z.object({
      label: z.string(),
      description: z.string(),
      avoid_tags: z.array(z.string()),
      prefer_tags: z.array(z.string()),
    }),
  ),
});
export type ProgramConfig = z.infer<typeof ProgramConfig>;

// ---------- engine config (config/engine.json) ----------
// Every threshold the engine uses. Groups tagged evidence "convention" are coaching convention, not research.
const Evidence = z.enum(["research", "convention"]).optional();
export const EngineConfig = z.object({
  engine_version: z.string(),
  timezone_default: z.string(),
  week: z.object({
    starts_on: z.literal("monday"),
    strength_target: z.number().int(),
    cardio_target: z.number().int(),
    strength_floor: z.number().int(),
    /** Session kinds that make a week non zero. */
    zero_week_counts: z.array(z.enum(["strength", "cardio", "travel"])),
    repair: z.object({ window_weeks: z.number().int(), max_per_window: z.number().int(), evidence: Evidence }),
  }),
  e1rm: z.object({ divisor: z.number().positive() }),
  fractional_sets: z.object({ primary: z.number(), secondary: z.number() }),
  calibration: z.object({
    start_pct: z.number(),
    start_pct_min: z.number(),
    start_pct_max: z.number(),
    first_exposure_target: z.enum(["rep_min", "rep_max"]),
    calibration_reps: z.number().int(),
    calibration_min_rir: z.number().int(),
    evidence: Evidence,
  }),
  progression: z.object({
    below_range_min_sets: z.number().int(),
    after_increase_target: z.enum(["rep_min", "rep_max"]),
    hold_target: z.enum(["rep_min", "rep_max"]),
    large_jump: z.object({
      reps_over: z.number().int(),
      /** Every set must reach rep_max + all_sets_min_over ... */
      all_sets_min_over: z.number().int(),
      /** ... and at least this share of sets must reach rep_max + reps_over. */
      share_sets_over: z.number(),
      reps_over_for_max: z.number().int(),
      pct_min: z.number(),
      pct_max: z.number(),
      evidence: Evidence,
    }),
    reset: z.object({ consecutive_below: z.number().int(), pct_min: z.number(), pct_max: z.number(), evidence: Evidence }),
    return_e1rm_cap_pct: z.number(),
    max_jump_pct: z.number(),
  }),
  stall: z.object({ exposures: z.number().int() }),
  reactive_deload: z.object({
    max_per_block: z.number().int(),
    e1rm_drop_pct: z.number(),
    e1rm_drop_lifts: z.number().int(),
    e1rm_drop_span_sessions: z.number().int(),
    missed_reps_sessions: z.number().int(),
    missed_reps_exercises: z.number().int(),
    checkin_avg_max: z.number(),
    checkin_days: z.number().int(),
    evidence: Evidence,
  }),
  readiness: z.object({
    threshold: z.number(),
    set_drops: z.array(z.object({ max_avg: z.number(), drop: z.number().int() })),
    load_cut: z.object({
      at_threshold_pct: z.number(),
      at_floor_pct: z.number(),
      floor_avg: z.number(),
      pct_step: z.number(),
      scope: z.enum(["first_exercise", "main_lifts", "all"]),
    }),
    min_sets: z.number().int(),
    cardio_swap_easy_min: z.number(),
    evidence: Evidence,
  }),
  deload: z.object({
    planned_week: z.number().int(),
    sets_base_phase: PhaseName,
    sets_factor: z.number(),
    sets_rounding: z.enum(["ceil", "floor", "round"]),
    min_sets: z.number().int(),
  }),
  short_version: z.object({ set_reduction: z.number().int(), min_sets: z.number().int() }),
  comeback: z.object({
    set_reduction: z.number().int(),
    min_sets: z.number().int(),
    /** true: a comeback after a zero week keeps the same weights even when the gap also meets the short break rule (PROGRAM.md rule 4). */
    overrides_short_break: z.boolean(),
  }),
  break: z.object({
    short_days_min: z.number().int(),
    short_days_max: z.number().int(),
    short_load_pct: z.number(),
    short_duration_days: z.number().int(),
    long_restart_week: z.number().int(),
    long_load_pct: z.number(),
    evidence: Evidence,
  }),
  never_miss_twice: z.object({ hours: z.number() }),
  spacing: z.object({
    max_consecutive_strength_days: z.number().int(),
    hard_cardio_before_heavy_hours: z.number(),
    heavy_days: z.array(StrengthDayCode),
  }),
  volume: z.object({
    band_min: z.number(),
    band_max: z.number(),
    session_cap: z.number(),
    band_phases: z.array(PhaseName),
    tracked_muscles: z.array(Muscle),
    evidence: Evidence,
  }),
  session: z.object({ auto_finish_hours: z.number() }),
  rest: z.object({ main_lift_s: z.number().int(), starred_s: z.number().int(), other_s: z.number().int() }),
  who: z.object({ weekly_minutes: z.number(), hard_multiplier: z.number() }),
});
export type EngineConfig = z.infer<typeof EngineConfig>;

// ---------- synced tables ----------
export const WeekKiller = z.enum(["work_peaks", "travel", "evenings", "low_energy"]);
export type WeekKiller = z.infer<typeof WeekKiller>;

export const RememberedWeight = z.object({ weight: z.number().nonnegative(), reps: z.number().int().positive() });
export type RememberedWeight = z.infer<typeof RememberedWeight>;

export const Settings = z.object({
  id: z.literal("settings"),
  block_start_date: LocalDate,
  block_number: z.number().int().positive(),
  timezone: z.string(),
  /** e.g. ["knee_friendly", "shoulder_symmetry"]. Mapping lives in config (limitations section of program/engine). */
  limitations: z.array(z.string()),
  /** exercise_id -> remembered working weight for reps, used for week 1 calibration. */
  remembered_weights: z.record(z.string(), RememberedWeight),
  interval_modality: z.enum(["bike", "rower", "both"]),
  session_order: z.array(StrengthDayCode).min(1),
  /** prescription_id -> exercise_id, "swap exercise for the block". */
  block_swaps: z.record(z.string(), Id),
  rest_overrides: z.record(z.string(), z.number().int().positive()),
  increment_overrides: z.record(z.string(), z.number().positive()),
  start_pct: z.number().min(0.5).max(0.7),
  sound: z.boolean(),
  /** Local hour from which the app leads with the ★ 30 min version (week killer "evenings"). null = off. */
  evening_hour: z.number().int().min(0).max(23).nullable().default(19),
  /** What usually kills Peter's weeks (SPEC 11.5); decides which fallback the app pushes hardest. */
  week_killers: z.array(WeekKiller).default(["work_peaks", "travel", "evenings"]),
  ...syncFields,
});
export type Settings = z.infer<typeof Settings>;

/** User controlled week flags only. Week state (done counts, floor, zero) is always computed by the engine. */
export const TrainingWeek = z.object({
  id: Id, // "wk_YYYY-MM-DD" (Monday)
  start_date: LocalDate,
  repaired: z.boolean(),
  ...syncFields,
});
export type TrainingWeek = z.infer<typeof TrainingWeek>;

export const Session = z.object({
  id: Id,
  program_day_id: DayCode, // "A" | "B" | "C" | "CARDIO" | "TRAVEL"
  started_at: IsoDateTime,
  ended_at: IsoDateTime.nullable(),
  mode: SessionMode,
  flags: z.array(SessionFlag),
  /** prescription_id -> exercise_id swaps for this session only. */
  swaps: z.record(z.string(), Id),
  notes: z.string().nullable(),
  ...syncFields,
});
export type Session = z.infer<typeof Session>;

export const SetLog = z.object({
  id: Id,
  session_id: Id,
  exercise_id: Id,
  prescription_id: Id.nullable(),
  set_index: z.number().int().min(0),
  target_weight: z.number().nullable(),
  target_reps: z.number().int().nullable(),
  target_rir: z.number().int().nullable(),
  weight: z.number().nonnegative(),
  reps: z.number().int().nonnegative(), // seconds or meters when the measure says so
  rir: z.number().int().min(0).max(5).nullable(),
  is_warmup: z.boolean(),
  is_top_set: z.boolean().default(false),
  pain_flag: z.boolean(),
  completed_at: IsoDateTime,
  ...syncFields,
});
export type SetLog = z.infer<typeof SetLog>;

export const CardioLog = z.object({
  id: Id,
  session_id: Id.nullable(), // null for walking logs
  date: LocalDate,
  modality: CardioModality,
  minutes: z.number().nonnegative(),
  hard_minutes: z.number().nonnegative().nullable(),
  intensity: CardioIntensity,
  avg_hr: z.number().int().positive().nullable(),
  source: z.enum(["manual", "timer", "import"]),
  ...syncFields,
});
export type CardioLog = z.infer<typeof CardioLog>;

const Score = z.number().int().min(1).max(5);
export const Checkin = z.object({
  id: Id, // "ck_YYYY-MM-DD"
  date: LocalDate,
  sleep: Score,
  soreness: Score,
  stress: Score,
  energy: Score,
  hrv: z.number().nullable(),
  rhr: z.number().nullable(),
  sleep_hours: z.number().nullable(),
  hrv_type: z.enum(["sdnn", "rmssd"]).nullable(),
  ...syncFields,
});
export type Checkin = z.infer<typeof Checkin>;

export const Decision = z.object({
  id: Id,
  date: IsoDateTime,
  rule_id: z.string(),
  engine_version: z.string(),
  session_id: Id.nullable(),
  exercise_id: Id.nullable(),
  inputs_snapshot: z.record(z.string(), z.unknown()),
  output: z.record(z.string(), z.unknown()),
  explanation: z.string(),
  ...syncFields,
});
export type Decision = z.infer<typeof Decision>;

// ---------- sync protocol ----------
export const SYNC_TABLES = [
  "settings", "exercise", "training_week", "session", "set_log", "cardio_log", "checkin", "decision",
] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

export const TableSchemas = {
  settings: Settings,
  exercise: ExerciseRow,
  training_week: TrainingWeek,
  session: Session,
  set_log: SetLog,
  cardio_log: CardioLog,
  checkin: Checkin,
  decision: Decision,
} as const satisfies Record<SyncTable, z.ZodTypeAny>;

export type RowOf<T extends SyncTable> = z.infer<(typeof TableSchemas)[T]>;

const changesShape = Object.fromEntries(
  SYNC_TABLES.map((t) => [t, z.array(TableSchemas[t]).optional()]),
) as { [K in SyncTable]: z.ZodOptional<z.ZodArray<(typeof TableSchemas)[K]>> };
export const Changes = z.object(changesShape);
export type Changes = Partial<{ [K in SyncTable]: RowOf<K>[] }>;

/**
 * POST /api/sync
 * Client pushes its outbox rows and pulls everything with server rev > cursor.
 * Server applies last-write-wins on updated_at (strictly newer wins; ties keep the server row),
 * stamps every accepted row with a new monotonically increasing rev, and returns rows with rev > cursor,
 * at most `limit` rows in total; `more: true` means call again with the returned cursor.
 */
export const SyncRequest = z.object({
  client_id: z.string().min(1).max(64),
  cursor: z.number().int().min(0),
  changes: Changes,
  limit: z.number().int().positive().max(2000).optional(),
});
export type SyncRequest = z.infer<typeof SyncRequest>;

export const SyncResponse = z.object({
  cursor: z.number().int().min(0),
  more: z.boolean(),
  accepted: z.number().int().min(0),
  rejected: z.array(z.object({ table: z.string(), id: z.string(), reason: z.string() })),
  changes: Changes,
  server_time: IsoDateTime,
});
export type SyncResponse = z.infer<typeof SyncResponse>;

/** GET /api/export and POST /api/import body. */
export const ExportFile = z.object({
  format: z.literal("workout-os-export"),
  version: z.literal(1),
  exported_at: IsoDateTime,
  tables: Changes,
});
export type ExportFile = z.infer<typeof ExportFile>;
