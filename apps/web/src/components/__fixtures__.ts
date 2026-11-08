/**
 * Realistic fixtures typed as the engine's output, for the Kit preview and component tests.
 * Scenario: block starts Mon 9 Nov 2026. Session A in the return phase, week 1.
 */
import type {
  Adjustment,
  AlternativeOption,
  BlockState,
  CardioPlan,
  CardioSegment,
  DotState,
  NextSession,
  Nudge,
  PlannedExercise,
  PlannedSet,
  SessionPlan,
  SessionSummary,
  SpacingWarning,
  WeekState,
} from "@gym/engine";
import type { SetLog } from "@gym/schema";
import type { WeekGoals } from "./WeekCard";

export const TODAY = "2026-11-11";
export const NOW_ISO = "2026-11-11T17:30:00.000Z";
export const goals: WeekGoals = { strength_target: 3, cardio_target: 1, strength_floor: 2 };

// ---------------- weeks and block ----------------

const baseWeek: WeekState = {
  id: "wk_2026-11-09",
  start_date: "2026-11-09",
  end_date: "2026-11-15",
  calendar_index: 1,
  training_week: 1,
  phase: "return",
  phase_label: "Return phase",
  is_current: true,
  is_complete: false,
  strength_done: 0,
  cardio_done: 0,
  bonus_done: 0,
  walking_minutes: 0,
  floor_reached: false,
  target_reached: false,
  is_zero: false,
  repaired: false,
  can_repair: false,
  reactive_deload: false,
  status: "in_progress",
  session_ids: [],
  to_floor_text: "2 strength sessions reach the floor",
  to_target_text: "3 strength + 1 cardio reach the target",
};

export const weekFresh: WeekState = baseWeek;

const week3 = { id: "wk_2026-11-23", start_date: "2026-11-23", end_date: "2026-11-29", calendar_index: 3, training_week: 3 };

export const weekBelowFloor: WeekState = {
  ...baseWeek,
  ...week3,
  strength_done: 1,
  session_ids: ["s_a"],
  to_floor_text: "1 more strength session reaches the floor",
  to_target_text: "2 strength + 1 cardio reach the target",
};

export const weekFloor: WeekState = {
  ...weekBelowFloor,
  strength_done: 2,
  floor_reached: true,
  status: "floor",
  session_ids: ["s_a", "s_b"],
  to_floor_text: null,
  to_target_text: "1 strength + 1 cardio reach the target",
};

export const weekTarget: WeekState = {
  ...weekFloor,
  strength_done: 4,
  cardio_done: 1,
  bonus_done: 1,
  target_reached: true,
  status: "target",
  session_ids: ["s_a", "s_b", "s_c", "s_cardio", "s_a2"],
  to_target_text: null,
};

const dots = (...head: DotState[]): DotState[] => [...head, ...Array<DotState>(12 - head.length).fill("future")];

export const blockWeek1: BlockState = {
  block_number: 1,
  block_start_date: "2026-11-09",
  training_week: 1,
  block_weeks: 12,
  phase: "return",
  phase_label: "Return phase",
  complete: false,
  extension_weeks: 0,
  dots: dots("current"),
  reactive_deload_used: false,
  deload_week: 8,
};

export const blockWeek3: BlockState = { ...blockWeek1, training_week: 3, dots: dots("target", "floor", "current") };
export const blockWeek3Floor: BlockState = { ...blockWeek3, dots: dots("target", "floor", "floor") };
export const blockWeek3Target: BlockState = { ...blockWeek3, dots: dots("target", "floor", "target") };
/** A zero week happened: the block is one week longer. Shown neutrally. */
export const blockExtended: BlockState = { ...blockWeek3, extension_weeks: 1, dots: dots("floor", "below_floor", "current") };

// ---------------- planned exercises ----------------

const work = (n: number, weight: number | null, reps: number, rir: number): PlannedSet[] =>
  Array.from({ length: n }, (_, index) => ({ index, weight, reps, rir, kind: "work" as const }));

const alt = (exercise_id: string, name: string, rep_min: number, rep_max: number, extra: Partial<AlternativeOption> = {}): AlternativeOption => ({
  exercise_id,
  name,
  rep_min,
  rep_max,
  measure: "reps",
  allowed: true,
  reason: null,
  ...extra,
});

const baseExercise: Omit<PlannedExercise, "prescription_id" | "exercise_id" | "name" | "primary_exercise_id" | "sets" | "reason" | "rule_id" | "decision_id"> = {
  swapped: null,
  starred: false,
  main_lift: false,
  measure: "reps",
  per_side: false,
  per_hand: false,
  bodyweight: false,
  progression_rule: "double",
  rep_min: 8,
  rep_max: 12,
  target_rir: 3,
  rir_range: [3, 4],
  rest_s: 90,
  superset_group: null,
  increment_kg: 2.5,
  calibration: false,
  last_time: null,
  pain_last_time: false,
  stalled: false,
  alternatives: [],
  note: null,
};

/** Session A, return week 1: back squat 2 × 8 @ RIR 3 at 60 kg (60% of a remembered 100 kg). */
export const backSquat: PlannedExercise = {
  ...baseExercise,
  prescription_id: "A1",
  exercise_id: "back_squat",
  primary_exercise_id: "back_squat",
  name: "Back squat",
  starred: true,
  main_lift: true,
  rep_min: 5,
  rep_max: 8,
  rest_s: 180,
  increment_kg: 2.5,
  sets: work(2, 60, 8, 3),
  reason: "Week 1: 60% of your remembered 100 kg × 8. It should feel light.",
  rule_id: "calib.remembered",
  decision_id: "d:init:back_squat@5-8",
  alternatives: [alt("hack_squat", "Hack squat", 5, 8), alt("goblet_squat", "Goblet squat", 5, 8), alt("leg_press", "Leg press", 5, 8)],
};

/** No history and no remembered weight: calibration, the user picks the weight. */
export const benchCalibration: PlannedExercise = {
  ...baseExercise,
  prescription_id: "A2",
  exercise_id: "bench_press",
  primary_exercise_id: "bench_press",
  name: "Bench press",
  starred: true,
  main_lift: true,
  rep_min: 5,
  rep_max: 8,
  rest_s: 180,
  sets: work(2, null, 8, 3),
  calibration: true,
  reason: "No history yet: pick a weight you could lift about 8 times with 3 or more reps left.",
  rule_id: "calib.pick",
  decision_id: "d:init:bench_press@5-8",
  alternatives: [alt("dumbbell_bench_press", "Dumbbell bench press", 5, 8)],
};

export const chestSupportedRow: PlannedExercise = {
  ...baseExercise,
  prescription_id: "A3",
  exercise_id: "chest_supported_row",
  primary_exercise_id: "chest_supported_row",
  name: "Chest supported row",
  starred: true,
  rest_s: 150,
  sets: work(2, 30, 12, 3),
  reason: "Within range: same load, add reps.",
  rule_id: "dp.hold_add_reps",
  decision_id: "d:s_prev:chest_supported_row@8-12",
  last_time: { session_id: "s_prev", date: "2026-11-09", sets: [{ weight: 30, reps: 11, rir: 3 }, { weight: 30, reps: 10, rir: 3 }] },
  alternatives: [alt("seated_cable_row", "Seated cable row", 8, 12)],
};

export const plank: PlannedExercise = {
  ...baseExercise,
  prescription_id: "A6",
  exercise_id: "plank",
  primary_exercise_id: "plank",
  name: "Plank",
  measure: "seconds",
  bodyweight: true,
  progression_rule: "reps_only",
  rep_min: 30,
  rep_max: 45,
  rest_s: 60,
  sets: work(2, 0, 35, 3),
  reason: "Within range: hold and add seconds.",
  rule_id: "ro.add_reps",
  decision_id: "d:s_prev:plank@30-45",
  last_time: { session_id: "s_prev", date: "2026-11-09", sets: [{ weight: 0, reps: 30, rir: 3 }, { weight: 0, reps: 30, rir: 2 }] },
  alternatives: [alt("dead_bug", "Dead bug", 8, 12)],
};

export const splitSquat: PlannedExercise = {
  ...baseExercise,
  prescription_id: "B4",
  exercise_id: "bulgarian_split_squat",
  primary_exercise_id: "bulgarian_split_squat",
  name: "Bulgarian split squat",
  per_side: true,
  per_hand: true,
  rep_min: 8,
  rep_max: 10,
  increment_kg: 2,
  sets: work(2, 14, 10, 3),
  reason: "All sets hit top of range at RIR 3: +2 kg.",
  rule_id: "dp.increase",
  decision_id: "d:s_prev2:bulgarian_split_squat@8-10",
  last_time: { session_id: "s_prev2", date: "2026-11-10", sets: [{ weight: 12, reps: 10, rir: 3 }, { weight: 12, reps: 10, rir: 3 }] },
  alternatives: [alt("walking_lunge", "Walking lunge", 8, 10), alt("step_up", "Step-up", 8, 10)],
};

export const pullUp: PlannedExercise = {
  ...baseExercise,
  prescription_id: "B3",
  exercise_id: "pull_up",
  primary_exercise_id: "pull_up",
  name: "Pull-up",
  starred: true,
  bodyweight: true,
  rep_min: 6,
  rep_max: 12,
  target_rir: 2,
  rir_range: [2, 2],
  rest_s: 150,
  sets: work(3, 5, 8, 2),
  stalled: true,
  reason: "Within range: same load, add reps.",
  rule_id: "dp.hold_add_reps",
  decision_id: "d:s_prev3:pull_up@6-12",
  last_time: { session_id: "s_prev3", date: "2026-11-04", sets: [{ weight: 5, reps: 8, rir: 2 }, { weight: 5, reps: 8, rir: 1 }, { weight: 5, reps: 7, rir: 1 }] },
  alternatives: [alt("lat_pulldown", "Lat pulldown", 6, 12), alt("assisted_pull_up", "Assisted pull-up", 6, 12)],
};

export const farmersCarry: PlannedExercise = {
  ...baseExercise,
  prescription_id: "C7",
  exercise_id: "farmers_carry",
  primary_exercise_id: "farmers_carry",
  name: "Farmer's carry",
  measure: "meters",
  per_hand: true,
  rep_min: 30,
  rep_max: 40,
  increment_kg: 2,
  sets: work(3, 24, 30, 3),
  reason: "Week 1: 60% of your remembered 40 kg × 30 m. It should feel light.",
  rule_id: "calib.remembered",
  decision_id: "d:init:farmers_carry@30-40",
  alternatives: [alt("suitcase_carry", "Suitcase carry", 30, 40, { measure: "meters" })],
};

export const bicepsCurl: PlannedExercise = {
  ...baseExercise,
  prescription_id: "C5",
  exercise_id: "biceps_curl",
  primary_exercise_id: "biceps_curl",
  name: "Biceps curl",
  per_hand: true,
  rep_min: 10,
  rep_max: 12,
  increment_kg: 2,
  rest_s: 60,
  superset_group: "C5",
  sets: work(2, 12, 12, 3),
  reason: "Within range: same load, add reps.",
  rule_id: "dp.hold_add_reps",
  decision_id: "d:s_prev:biceps_curl@10-12",
  note: "Superset with triceps pushdown.",
  alternatives: [alt("cable_biceps_curl", "Cable biceps curl", 10, 12)],
};

/** knee_friendly limitation active: back squat swapped to hack squat, back squat shown as filtered. */
export const hackSquatLimitation: PlannedExercise = {
  ...backSquat,
  exercise_id: "hack_squat",
  name: "Hack squat",
  swapped: "limitation",
  sets: work(2, 80, 8, 3),
  reason: "Week 1: 60% of your remembered 135 kg × 8. It should feel light.",
  decision_id: "d:init:hack_squat@5-8",
  alternatives: [
    alt("back_squat", "Back squat", 5, 8, { allowed: false, reason: "Avoided for knee friendly: deep knee flexion." }),
    alt("goblet_squat", "Goblet squat", 5, 8),
    alt("leg_press", "Leg press", 5, 8),
  ],
};

/** Consolidate week: three work sets plus a top set at RIR 1, pain logged last time. */
export const benchTopSet: PlannedExercise = {
  ...benchCalibration,
  sets: [...work(3, 82.5, 5, 2), { index: 3, weight: 90, reps: 5, rir: 1, kind: "top" }],
  calibration: false,
  target_rir: 2,
  rir_range: [2, 3],
  pain_last_time: true,
  reason: "Pain logged: no load increase, swap suggested.",
  rule_id: "dp.pain",
  decision_id: "d:s_w11:bench_press@5-8",
  last_time: { session_id: "s_w11", date: "2027-01-21", sets: [{ weight: 82.5, reps: 6, rir: 2 }, { weight: 82.5, reps: 6, rir: 2 }, { weight: 82.5, reps: 5, rir: 2 }] },
};

export const sessionAWeek1: PlannedExercise[] = [backSquat, benchCalibration, chestSupportedRow, plank];

// ---------------- set logs ----------------

let seq = 0;
export function setLog(ex: PlannedExercise, set_index: number, weight: number, reps: number, rir: number | null, extra: Partial<SetLog> = {}): SetLog {
  const planned = ex.sets[set_index];
  seq += 1;
  return {
    id: `01JFIXTURE${String(seq).padStart(16, "0")}`,
    session_id: "s_today",
    exercise_id: ex.exercise_id,
    prescription_id: ex.prescription_id,
    set_index,
    target_weight: planned?.weight ?? null,
    target_reps: planned?.reps ?? null,
    target_rir: planned?.rir ?? null,
    weight,
    reps,
    rir,
    is_warmup: false,
    is_top_set: planned?.kind === "top",
    pain_flag: false,
    completed_at: NOW_ISO,
    updated_at: NOW_ISO,
    deleted_at: null,
    ...extra,
  };
}

// ---------------- plans ----------------

const planB: SessionPlan = {
  code: "B",
  name: "Hinge + overhead",
  mode: "full",
  flags: [],
  training_week: 3,
  phase: "return",
  phase_label: "Return phase",
  est_minutes: 55,
  exercises: [pullUp, splitSquat],
  adjustments: [],
  warnings: [],
  decisions: [],
  rounds: null,
};

export const nextB: NextSession = {
  code: "B",
  name: "Hinge + overhead",
  est_minutes: 55,
  short_minutes: 30,
  reason: "Next in line after A",
  done_today: false,
  plan: planB,
};

export const nextDoneToday: NextSession = {
  ...nextB,
  code: "C",
  name: "Volume + arms",
  est_minutes: 60,
  reason: "Done for today. Next: Session C, whenever it fits.",
  done_today: true,
  plan: { ...planB, code: "C", name: "Volume + arms" },
};

function intervalSegments(count: number, hardS: number, easyS: number, warmS: number, coolS: number): CardioSegment[] {
  const segs: CardioSegment[] = [{ label: "Warm-up", kind: "warmup", seconds: warmS }];
  for (let i = 1; i <= count; i++) {
    segs.push({ label: `Hard ${i}/${count}`, kind: "hard", seconds: hardS });
    segs.push({ label: `Easy ${i}/${count}`, kind: "easy", seconds: easyS });
  }
  segs.push({ label: "Cool-down", kind: "cooldown", seconds: coolS });
  return segs;
}

export const cardioIntervals: CardioPlan = {
  kind: "intervals",
  rule_id: "cardio.intervals",
  reason: "Weeks 1 to 2: 4 × 2 min hard. Bike or rower.",
  modality_options: ["bike", "rower"],
  intervals: { count: 4, hard_min: 2, easy_min: 2 },
  warmup_min: 5,
  cooldown_min: 5,
  total_min: 26,
  hard_minutes: 8,
  segments: intervalSegments(4, 120, 120, 300, 300),
  hard_description: "90 to 95% of max heart rate: breathing heavily, able to say only a few words.",
  counts_as: "target",
  warnings: [],
};

export const cardioEasy: CardioPlan = {
  ...cardioIntervals,
  kind: "easy",
  rule_id: "cardio.deload",
  reason: "Deload week: 30 min easy, conversation pace.",
  intervals: null,
  warmup_min: 0,
  cooldown_min: 0,
  total_min: 30,
  hard_minutes: 0,
  segments: [{ label: "Easy", kind: "easy", seconds: 1800 }],
};

export const cardioWithWarning: CardioPlan = {
  ...cardioIntervals,
  warnings: [{ rule_id: "spacing.hard_cardio_before_heavy", text: "Next up is A. Keep hard cardio a day away, or go easy today." }],
};

/** Seconds long segments to try the timer and its beeps in the Kit. */
export const cardioDemo: CardioPlan = {
  ...cardioIntervals,
  reason: "Demo: seconds instead of minutes.",
  intervals: { count: 2, hard_min: 0.1, easy_min: 0.1 },
  total_min: 0.8,
  hard_minutes: 0.2,
  segments: intervalSegments(2, 8, 6, 6, 6),
};

// ---------------- nudges, adjustments, warnings ----------------

export const nudgeNeverMissTwice: Nudge = {
  kind: "never_miss_twice",
  rule_id: "event.never_miss_twice",
  text: "Never miss twice: ★ 30 min version of B is enough today.",
  action: { mode: "short", code: "B" },
};

export const nudgeComeback: Nudge = {
  kind: "comeback",
  rule_id: "event.comeback",
  text: "Coming back is easy on purpose: one set less, same weights.",
  action: { mode: "comeback", code: "A" },
};

export const nudgeBookFloor: Nudge = {
  kind: "book_floor",
  rule_id: "event.book_floor",
  text: "Book your two floor sessions for the week.",
  action: null,
};

export const nudgeBlockComplete: Nudge = {
  kind: "block_complete",
  rule_id: "event.block_complete",
  text: "Block done. Plan the next 12 weeks.",
  action: null,
};

export const readinessAdjustments: Adjustment[] = [{ rule_id: "event.readiness", text: "Sleep 2/5: Back squat −7.5%, 1 set dropped per exercise." }];

export const spacingWarnings: SpacingWarning[] = [
  { rule_id: "spacing.consecutive_strength", text: "This would be strength 3 days in a row. Fine if you feel fresh." },
];

// ---------------- summary ----------------

export const summaryA: SessionSummary = {
  session_id: "s_today",
  code: "A",
  mode: "full",
  duration_min: 48,
  sets_logged: 9,
  kg_lifted: 3460,
  changes: [
    {
      exercise_id: "bench_press",
      name: "Bench press",
      rule_id: "dp.increase",
      decision_id: "d:s_today:bench_press@5-8",
      from: { weight: 80, reps: 8 },
      to: { weight: 82.5, reps: 5 },
      explanation: "All sets hit 8 reps at RIR 2: +2.5 kg.",
    },
    {
      exercise_id: "back_squat",
      name: "Back squat",
      rule_id: "dp.large_jump",
      decision_id: "d:s_today:back_squat@5-8",
      from: { weight: 60, reps: 8 },
      to: { weight: 65, reps: 5 },
      explanation: "Beat range by 2+ reps in return phase: larger jump to 65 kg.",
    },
    {
      exercise_id: "chest_supported_row",
      name: "Chest supported row",
      rule_id: "dp.hold_add_reps",
      decision_id: "d:s_today:chest_supported_row@8-12",
      from: { weight: 30, reps: 12 },
      to: { weight: 30, reps: 12 },
      explanation: "Within range: same load, add reps.",
    },
  ],
  prs: [{ exercise_id: "bench_press", name: "Bench press", e1rm: 101.33, previous_best: 98.67 }],
  week: weekFloor,
  decisions: [],
};
