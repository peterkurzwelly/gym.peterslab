/**
 * Public types of @gym/engine. This file is the contract between the engine, the web app and the tests.
 * Change it only deliberately; the web app codes against these shapes.
 * Semantics of every rule: docs/ENGINE_RULES.md.
 */
import type {
  CardioLog,
  CardioModality,
  Checkin,
  DayCode,
  Decision,
  EngineConfig,
  Exercise,
  ExerciseRow,
  Measure,
  Muscle,
  PhaseName,
  ProgramConfig,
  ProgressionRule,
  Session,
  SessionFlag,
  SessionMode,
  SetLog,
  Settings,
  StrengthDayCode,
  TrainingWeek,
} from "@gym/schema";

// ---------------- inputs ----------------

/** Raw rows as stored. Rows with deleted_at != null are ignored by the engine (callers may pass them). */
export interface EngineHistory {
  sessions: Session[];
  setLogs: SetLog[];
  cardioLogs: CardioLog[];
  checkins: Checkin[];
  trainingWeeks: TrainingWeek[];
  customExercises?: ExerciseRow[];
}

export interface EngineContext {
  config: EngineConfig;
  program: ProgramConfig;
  /** Library + custom exercises, keyed by id. */
  exercises: Record<string, Exercise>;
  settings: Settings;
  history: EngineHistory;
  /** ISO UTC timestamp. The engine never reads the clock itself. */
  now: string;
}

// ---------------- weeks and block ----------------

export type WeekStatus =
  | "future" // not started yet
  | "in_progress" // current week, below floor so far (0 or more sessions)
  | "below_floor" // completed, at least one session but floor not reached
  | "floor" // floor reached (current or completed)
  | "target" // target reached (current or completed)
  | "zero"; // completed with no qualifying session

export interface WeekState {
  id: string; // "wk_YYYY-MM-DD" (Monday)
  start_date: string; // Monday, local date
  end_date: string; // Sunday, local date
  calendar_index: number; // 1-based calendar week since block start
  /** Training (block) week this calendar week counts as. Zero weeks repeat the index (block extends). */
  training_week: number;
  phase: PhaseName;
  phase_label: string;
  is_current: boolean;
  is_complete: boolean; // the week has ended (end_date < today)
  strength_done: number; // strength sessions incl. short, comeback and travel (if program.travel.counts_toward_floor)
  cardio_done: number; // cardio sessions (intervals or easy), not walks
  bonus_done: number; // strength beyond target + cardio beyond target
  walking_minutes: number;
  floor_reached: boolean;
  target_reached: boolean;
  is_zero: boolean; // only for completed weeks
  repaired: boolean;
  can_repair: boolean;
  /** true when this calendar week was a reactive deload week. */
  reactive_deload: boolean;
  status: WeekStatus;
  session_ids: string[];
  /** What still reaches the floor / target this week, e.g. "1 more strength session reaches the floor". */
  to_floor_text: string | null;
  to_target_text: string | null;
}

export type DotState = "target" | "floor" | "below_floor" | "current" | "future";

export interface BlockState {
  block_number: number;
  block_start_date: string;
  /** Training week of the current calendar week (1..block_weeks; > block_weeks means the block is complete). */
  training_week: number;
  block_weeks: number;
  phase: PhaseName;
  phase_label: string;
  complete: boolean;
  /** Calendar weeks added because of zero weeks. */
  extension_weeks: number;
  /** 12 dots, one per training week. */
  dots: DotState[];
  reactive_deload_used: boolean;
  /** Training week of the deload (planned 8, or the pulled-forward week). */
  deload_week: number;
}

export interface StreakState {
  /** Completed (or current, once floor is reached) calendar weeks that were not zero, or zero but repaired. Headline "x of 12". */
  weeks_without_zero: number;
  floor_weeks: number;
  target_weeks: number;
  zero_weeks: number;
  repairs_used: number;
  current_run: number; // consecutive weeks without an unrepaired zero, up to now
  best_run: number;
}

// ---------------- planning ----------------

export interface PlannedSet {
  index: number;
  /** null while calibrating: the user picks the weight. */
  weight: number | null;
  reps: number; // target reps (or seconds / meters per measure)
  rir: number; // target RIR (phase rir_min, or the top set rir)
  kind: "work" | "top";
}

export interface LastTime {
  session_id: string;
  date: string; // local date
  sets: { weight: number; reps: number; rir: number | null }[];
}

export interface AlternativeOption {
  exercise_id: string;
  name: string;
  rep_min: number;
  rep_max: number;
  measure: Measure;
  /** false when filtered out by settings.limitations. */
  allowed: boolean;
  reason: string | null;
}

export interface PlannedExercise {
  prescription_id: string;
  exercise_id: string;
  name: string;
  /** Program default exercise for this prescription. */
  primary_exercise_id: string;
  swapped: null | "session" | "block" | "limitation";
  starred: boolean;
  main_lift: boolean;
  measure: Measure;
  per_side: boolean;
  per_hand: boolean;
  bodyweight: boolean;
  progression_rule: ProgressionRule;
  rep_min: number;
  rep_max: number;
  target_rir: number;
  rir_range: [number, number];
  rest_s: number;
  superset_group: string | null;
  increment_kg: number;
  sets: PlannedSet[];
  calibration: boolean;
  /** One line reason shown under the exercise. Equals decisions[decision_id].explanation. */
  reason: string;
  rule_id: string;
  decision_id: string;
  last_time: LastTime | null;
  pain_last_time: boolean;
  stalled: boolean;
  alternatives: AlternativeOption[];
  note: string | null;
}

export interface Adjustment {
  rule_id: string;
  text: string; // banner line, e.g. "Sleep 2/5: Back squat −7.5%, 1 set dropped per exercise."
}

export interface SpacingWarning {
  rule_id: string;
  text: string;
}

export interface SessionPlan {
  code: DayCode;
  name: string;
  mode: SessionMode;
  flags: SessionFlag[];
  training_week: number;
  phase: PhaseName;
  phase_label: string;
  est_minutes: number;
  exercises: PlannedExercise[];
  adjustments: Adjustment[];
  warnings: SpacingWarning[];
  /** Every decision behind a number in this plan (one per exercise + plan level ones). */
  decisions: Decision[];
  /** Travel circuit rounds, else null. */
  rounds: number | null;
}

export interface PlanOptions {
  code: DayCode;
  mode: SessionMode;
  /** prescription_id -> exercise_id swaps for this session. */
  swaps?: Record<string, string>;
  /** Plan as if at this time (defaults to ctx.now). */
  at?: string;
  /** Session being resumed: excluded from progression history so targets stay frozen. */
  sessionId?: string;
}

export interface CardioSegment {
  label: string; // "Warm-up", "Hard 1/4", "Easy 1/4", "Cool-down", "Easy"
  kind: "warmup" | "hard" | "easy" | "cooldown";
  seconds: number;
}

export interface CardioPlan {
  kind: "intervals" | "easy";
  rule_id: string;
  reason: string;
  modality_options: CardioModality[];
  intervals: { count: number; hard_min: number; easy_min: number } | null;
  warmup_min: number;
  cooldown_min: number;
  total_min: number;
  hard_minutes: number; // minutes at hard intensity (0 for easy)
  segments: CardioSegment[];
  hard_description: string;
  /** "target" when it counts toward this week's cardio target, "bonus" when target cardio is done. */
  counts_as: "target" | "bonus";
  warnings: SpacingWarning[];
}

export interface NextSession {
  code: StrengthDayCode;
  name: string;
  est_minutes: number;
  short_minutes: number | null;
  /** "Next in line after B", "First session of the block". */
  reason: string;
  /** A strength session was already done today: never stack. UI shows it as tomorrow / whenever it fits. */
  done_today: boolean;
  /** Full version plan with today's check-in applied. */
  plan: SessionPlan;
}

export interface ReadinessResult {
  checkin_id: string;
  date: string;
  average: number;
  lowest: { metric: "sleep" | "soreness" | "stress" | "energy"; value: number };
  adjusted: boolean;
  sets_drop: number;
  load_cut_pct: number; // 0.075 means −7.5%
  cardio_swap: boolean;
  banner: string | null;
}

export interface Nudge {
  kind: "never_miss_twice" | "comeback" | "break_resume" | "long_break" | "book_floor" | "sunday_review" | "block_complete";
  rule_id: string;
  text: string;
  /** Suggested action for the UI. */
  action: { mode: SessionMode; code: DayCode } | null;
}

export interface Flag {
  kind: "stall" | "reactive_deload" | "deload_criteria_met" | "below_range" | "readiness_trend" | "pain" | "volume_low" | "volume_high";
  rule_id: string;
  text: string;
  date: string;
  exercise_id: string | null;
}

// ---------------- progression state ----------------

export interface E1rmPoint {
  date: string;
  session_id: string;
  e1rm: number;
}

/** Statistics per exercise (independent of rep range). */
export interface ExerciseStats {
  exercise_id: string;
  e1rm: number | null; // latest (after cap)
  best_e1rm: number | null;
  first_e1rm: number | null;
  history: E1rmPoint[];
  exposures: number;
  exposures_since_best: number;
  stalled: boolean;
}

/** Load track per exercise + rep range (see ENGINE_RULES "Tracks"). */
export interface TrackState {
  key: string; // `${exercise_id}@${rep_min}-${rep_max}`
  exercise_id: string;
  rep_min: number;
  rep_max: number;
  base_weight: number | null; // next target load before session modifiers
  base_reps: number; // next target reps per set
  exposures: number;
  below_range_streak: number;
  last_rule_id: string | null;
  last_decision_id: string | null;
  last: LastTime | null;
}

// ---------------- analytics ----------------

export interface CumulativeTotals {
  sessions: number;
  strength_sessions: number;
  cardio_sessions: number;
  sets: number;
  cardio_minutes: number;
  walking_minutes: number;
  kg_lifted: number; // sum weight × reps of working strength sets (per_hand exercises count both hands)
}

export interface WeekVolume {
  week_id: string;
  /** Fractional working sets per tracked muscle. */
  by_muscle: Partial<Record<Muscle, number>>;
  band: { min: number; max: number } | null; // null when the week's phase is not a band phase
  who_minutes: number; // moderate equivalent: easy + hard × hard_multiplier, incl. walking
  who_target: number;
  checkin_avg: number | null;
}

export interface EngineState {
  engine_version: string;
  today: string;
  block: BlockState;
  streak: StreakState;
  weeks: WeekState[]; // calendar weeks from block start through the current week
  current_week: WeekState;
  /** Session started and not finished (and not auto finished). */
  active: { session: Session; plan: SessionPlan } | null;
  next: NextSession;
  cardio: CardioPlan;
  readiness: ReadinessResult | null;
  nudges: Nudge[];
  warnings: SpacingWarning[];
  flags: Flag[];
  tracks: Record<string, TrackState>;
  stats: Record<string, ExerciseStats>;
  /** All decisions produced by replaying history plus current plans, deterministic ids. */
  decisions: Decision[];
  totals: CumulativeTotals;
  volume: WeekVolume[];
  /** Sessions the engine considers finished because of inactivity (callers persist ended_at). */
  auto_finished: { session_id: string; ended_at: string }[];
}

export interface SessionChange {
  exercise_id: string;
  name: string;
  rule_id: string;
  decision_id: string;
  from: { weight: number | null; reps: number } | null;
  to: { weight: number | null; reps: number } | null;
  explanation: string;
}

export interface SessionSummary {
  session_id: string;
  code: DayCode;
  mode: SessionMode;
  duration_min: number;
  sets_logged: number;
  kg_lifted: number;
  changes: SessionChange[];
  prs: { exercise_id: string; name: string; e1rm: number; previous_best: number | null }[];
  week: WeekState;
  decisions: Decision[];
}
