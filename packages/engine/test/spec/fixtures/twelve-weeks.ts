/**
 * Phase 2 acceptance fixture (SPEC 9, phase 2): 13 calendar weeks of Peter's block with
 *   - one zero week (CW7, Christmas week, only a walk),
 *   - six floor-only weeks (CW2, CW4, CW6, CW8, CW10, CW11),
 *   - one bad sleep week (CW4: three consecutive check-ins averaging ≤ 2),
 *   - one stalled lift (overhead press flat at 45 kg × 8 from CW9).
 *
 * Every expected value below is derived by hand from docs/ENGINE_RULES.md; the derivation is in the comments.
 * CW = calendar week since 2026-11-09 (CW1 = Mon 2026-11-09 .. Sun 2026-11-15). All times Europe/Stockholm.
 *
 * Logging pattern (so nothing unintended fires):
 *   - Peter always does the next session in line: A B C | A B | C A B | C A | B C A | B C | – | A B | C A B | C A B | C A | B C A | B C A.
 *   - He logs the three starred exercises of each day. Reps sit mid range (never below range, never at the top of
 *     every set), so double progression always answers dp.hold_add_reps: base load = last eligible load.
 *   - Loads rise on every progression eligible exposure, so e1RM rises on every eligible exposure: no stall, no e1RM drop.
 *     Exceptions: overhead press repeats 42.5 kg in CW8 (no gain, no new best) and is flat at 45 kg from CW9 (the stall).
 *     Non eligible sessions (deload, comeback) are logged at or below the previous eligible load, so they never set a
 *     new best.
 *   - RIR 3 in return and deload weeks, RIR 2 from build on (always ≥ the phase target).
 *   - Check-ins exist only in CW4, so the check-in trigger can fire only there.
 *
 * Derivation
 *   Training weeks (ENGINE_RULES 2): CW1..CW6 non zero → tw 1..6. CW7 zero → tw stays 7, extension_weeks = 1.
 *     CW8 → tw 7, CW9 → tw 8, CW10..12 → tw 9..11, CW13 → tw 12 (consolidate), CW14 → tw 13 (block complete).
 *   Reactive deload (ENGINE_RULES 2): check-ins Mon 11-30 (avg 2.0), Tue 12-01 (1.75), Wed 12-02 (1.75) are consecutive
 *     and all ≤ checkin_avg_max 2.0. The first finished session after them is Thu 12-03 (tw 4) → k + 1 = 5 < 8 →
 *     training week 5 (CW5) becomes the deload, deload_week = 5, week 8 is cancelled and takes build.
 *     Fri 12-04 check-in (avg 3.5) ends the streak, so no later session sees three bad days again.
 *     max_per_block = 1 and no later criteria are met → exactly one reactive_deload flag, no deload_criteria_met.
 *   Phases: tw1..4 return, tw5 deload (reactive), tw6..8 build, tw9..11 push, tw12 consolidate.
 *   Comeback (ENGINE_RULES 4.5 + 4.6): first strength session after the zero week is Mon 12-28 A. Last qualifying session
 *     before it: cardio Sat 12-19 (9 days; strength Thu 12-17, 11 days), which meets the short break rule (7..14), but
 *     comeback.overrides_short_break = true: the comeback keeps the same weights with one set fewer and starts no 85%
 *     window (rule change; before it, both applied and both CW8 sessions held). So only the comeback session holds;
 *     Wed 12-30 B (2 days later) is a normal, progression eligible build session.
 *     Comeback plan for A in tw 7 (build): A1 4 − 1 = 3 sets × 75 kg; A2 3 × 57.5; A3 3 − 1 = 2 × 55. Bases are the CW4 Sat
 *     loads (last eligible A); the comeback is logged at exactly those loads.
 *   Deload plan (Mon CW5, next = B): B1 ceil(4 × 0.5) = 2 sets × 90 (CW3 base), B2 2 × 40, RIR 3, cardio 30 min easy.
 *   Stall (ENGINE_RULES 3): OHP eligible e1RMs 47.83, 51.25, 54.67 (CW1..3), 56.67 (CW6), then 60, 60, 60, 60 (CW9, CW10,
 *     CW12, CW13; 45 × (1 + (8 + 2) / 30) = 60). After CW12 the last three (CW9, 10, 12) beat the earlier best 56.67 → no
 *     stall. After CW13 (Mon 02-01) the last three (CW10, 12, 13) do not exceed the best before them (60) → stall flag.
 *   Week statuses (target = 3 strength + 1 cardio, floor = 2 strength):
 *     CW1 3+1 target · CW2 2+1 floor · CW3 3+1 target · CW4 2+0 floor · CW5 3+1 target (deload counts fully) · CW6 2+1 floor
 *     CW7 0 zero (walk only) · CW8 2+0 floor · CW9 3+1 target · CW10 3+0 floor · CW11 2+1 floor · CW12 3+1 target · CW13 3+1 target
 *   Streak at Sun CW13 20:00 (current week CW13 reached target): weeks_without_zero 11 completed non zero + current = 12,
 *     floor_weeks 12, target_weeks 5 + current = 6, zero_weeks 1, current_run CW8..CW13 = 6, best_run 6 (CW1..CW6 or CW8..CW13).
 *   Dots (training week i+1, last non zero calendar week with that tw): tw7 is CW8 (floor), CW7 zero is skipped.
 */
import type { SessionFlag, SessionMode } from "@gym/schema";
import type { DotState, WeekStatus } from "../../../src/index";
import type { PhaseName } from "@gym/schema";
import {
  type Dow,
  type Part,
  at,
  checkin,
  day,
  easyCardio,
  hist,
  intervals,
  lib,
  sets,
  strength,
  walk,
} from "../helpers";

type Code = "A" | "B" | "C";
export type Kind = "eligible" | "deload" | "comeback" | "break";

/** The starred exercises Peter logs per day, with the reps he does (mid range). */
export const LIFTS: Record<Code, readonly (readonly [exercise: string, reps: number])[]> = {
  A: [["back_squat", 6], ["bench_press", 6], ["chest_supported_row", 10]], // ranges 5-8, 5-8, 8-12
  B: [["trap_bar_deadlift", 5], ["overhead_press", 8]], // ranges 4-6, 6-10
  C: [["leg_press", 11], ["incline_dumbbell_press", 10], ["seated_cable_row", 11]], // ranges 10-12, 8-12, 10-12
};

export interface StrengthRow {
  cw: number;
  dow: Dow;
  code: Code;
  tw: number;
  kind: Kind;
  rir: number;
  /** Working sets per lift, in LIFTS order. */
  sets: number[];
  /** Load per lift, in LIFTS order. */
  loads: number[];
}

const S = (cw: number, dow: Dow, code: Code, tw: number, kind: Kind, rir: number, setCounts: number[], loads: number[]): StrengthRow => ({
  cw,
  dow,
  code,
  tw,
  kind,
  rir,
  sets: setCounts,
  loads,
});

/* prettier-ignore */
export const STRENGTH_ROWS: StrengthRow[] = [
  // CW1 · tw1 return week 1: 2 sets everywhere
  S(1, "mon", "A", 1, "eligible", 3, [2, 2, 2], [60, 50, 40]),
  S(1, "wed", "B", 1, "eligible", 3, [2, 2], [80, 35]),
  S(1, "fri", "C", 1, "eligible", 3, [2, 2, 2], [100, 16, 45]),
  // CW2 · tw2 return: floor week (2 strength + cardio)
  S(2, "tue", "A", 2, "eligible", 3, [3, 3, 3], [65, 52.5, 45]),
  S(2, "thu", "B", 2, "eligible", 3, [3, 3], [85, 37.5]),
  // CW3 · tw3 return
  S(3, "mon", "C", 3, "eligible", 3, [3, 3, 3], [105, 18, 47.5]),
  S(3, "wed", "A", 3, "eligible", 3, [3, 3, 3], [70, 55, 50]),
  S(3, "fri", "B", 3, "eligible", 3, [3, 3], [90, 40]),
  // CW4 · tw4 return, bad sleep Mon to Wed. Thu C is the first session after the third bad check-in: reactive deload.
  S(4, "thu", "C", 4, "eligible", 3, [3, 3, 3], [110, 20, 50]),
  S(4, "sat", "A", 4, "eligible", 3, [3, 3, 3], [75, 57.5, 55]),
  // CW5 · tw5 = reactive deload: half the build sets, same loads, RIR 3. Counts fully: target week.
  S(5, "mon", "B", 5, "deload", 3, [2, 2], [90, 40]),
  S(5, "wed", "C", 5, "deload", 3, [2, 2, 2], [110, 20, 50]),
  S(5, "fri", "A", 5, "deload", 3, [2, 2, 2], [75, 57.5, 55]),
  // CW6 · tw6 build
  S(6, "mon", "B", 6, "eligible", 2, [4, 4], [95, 42.5]),
  S(6, "thu", "C", 6, "eligible", 2, [3, 3, 3], [115, 22, 52.5]),
  // CW7 · zero week (Christmas): a walk only
  // CW8 · tw7 build again: comeback (same weights, one set fewer; it overrides the short break), then a normal B
  S(8, "mon", "A", 7, "comeback", 2, [3, 3, 2], [75, 57.5, 55]),
  S(8, "wed", "B", 7, "eligible", 2, [4, 4], [97.5, 42.5]), // OHP 42.5 × 8 @ 2 = CW6: e1RM 56.67 ties, no new best
  // CW9 · tw8 = build (planned week 8 deload cancelled by the reactive deload)
  S(9, "tue", "C", 8, "eligible", 2, [3, 3, 3], [120, 24, 55]),
  S(9, "thu", "A", 8, "eligible", 2, [4, 4, 3], [80, 60, 60]),
  S(9, "sat", "B", 8, "eligible", 2, [4, 4], [100, 45]), // OHP 45 × 8 @ 2: e1RM 60, the best from here on
  // CW10 · tw9 push: floor week (3 strength, no cardio)
  S(10, "mon", "C", 9, "eligible", 2, [3, 3, 3], [125, 26, 57.5]),
  S(10, "wed", "A", 9, "eligible", 2, [4, 4, 3], [85, 62.5, 65]),
  S(10, "fri", "B", 9, "eligible", 2, [4, 4], [105, 45]), // OHP flat (1)
  // CW11 · tw10 push: floor week
  S(11, "tue", "C", 10, "eligible", 2, [3, 3, 3], [130, 28, 60]),
  S(11, "thu", "A", 10, "eligible", 2, [4, 4, 3], [90, 65, 70]),
  // CW12 · tw11 push
  S(12, "mon", "B", 11, "eligible", 2, [4, 4], [110, 45]), // OHP flat (2)
  S(12, "wed", "C", 11, "eligible", 2, [3, 3, 3], [135, 30, 62.5]),
  S(12, "fri", "A", 11, "eligible", 2, [4, 4, 3], [95, 67.5, 75]),
  // CW13 · tw12 consolidate
  S(13, "mon", "B", 12, "eligible", 2, [3, 3], [115, 45]), // OHP flat (3): stall
  S(13, "wed", "C", 12, "eligible", 2, [3, 3, 3], [140, 32, 65]),
  S(13, "fri", "A", 12, "eligible", 2, [3, 3, 3], [100, 70, 80]),
];

export const CARDIO_PARTS: Part[] = [
  intervals(day(1, "sat"), 1), // 26 min
  intervals(day(2, "sat"), 2), // 26 min
  intervals(day(3, "sun"), 3), // 31 min
  easyCardio(day(5, "sat"), 30), // deload week: 30 min easy
  intervals(day(6, "sat"), 6), // 38 min
  intervals(day(9, "sun"), 8),
  intervals(day(11, "sat"), 10),
  intervals(day(12, "sat"), 11),
  intervals(day(13, "sat"), 12),
];

/** Cardio sessions per calendar week (index 0 = CW1). */
export const CARDIO_WEEKS = [1, 2, 3, 5, 6, 9, 11, 12, 13];

export const CHECKIN_PARTS: Part[] = [
  checkin(day(4, "mon"), [2, 2, 2, 2]), // 2.00
  checkin(day(4, "tue"), [1, 2, 2, 2]), // 1.75
  checkin(day(4, "wed"), [2, 1, 2, 2]), // 1.75
  checkin(day(4, "fri"), [4, 3, 3, 4]), // 3.50 · sleep is back, streak over
];

export const WALK_PARTS: Part[] = [walk(day(7, "thu"), 45)];

const FLAGS: Record<Kind, SessionFlag[]> = {
  eligible: [],
  deload: ["deload"],
  comeback: ["comeback"],
  break: ["break_resume"],
};

export function sessionId(row: Pick<StrengthRow, "cw" | "dow" | "code">): string {
  return `s_${day(row.cw, row.dow)}_${row.code}`;
}

function toPart(row: StrengthRow): Part {
  const log: Record<string, ReturnType<typeof sets>> = {};
  LIFTS[row.code].forEach(([exercise, reps], i) => {
    log[exercise] = sets(row.sets[i] ?? 0, row.loads[i] ?? 0, reps, row.rir);
  });
  const mode: SessionMode = row.kind === "comeback" ? "comeback" : "full";
  return strength({ code: row.code, date: day(row.cw, row.dow), mode, flags: FLAGS[row.kind], log });
}

export const TWELVE_WEEKS_HISTORY = hist(STRENGTH_ROWS.map(toPart), CARDIO_PARTS, CHECKIN_PARTS, WALK_PARTS);

// ---------------------------------------------------------------- checkpoints (Stockholm local)

export const T = {
  /** Wed CW4 evening: three bad check-ins logged, no session after them yet. */
  beforeTrigger: at(day(4, "wed"), "21:00"),
  /** Fri CW4 noon: Thu C session finished → reactive deload decided for tw 5. */
  afterTrigger: at(day(4, "fri"), "12:00"),
  /** Mon CW5 morning: the deload week. */
  deloadMonday: at(day(5, "mon"), "07:00"),
  /** Mon CW6 morning: deload week done. */
  afterDeload: at(day(6, "mon"), "07:00"),
  /** Mon CW8 morning: zero week CW7 complete, comeback session next. */
  comebackMorning: at(day(8, "mon"), "07:30"),
  /** Tue CW9 morning: training week 8. */
  week8: at(day(9, "tue"), "07:00"),
  /** Sun CW12 evening: OHP flat for 3 exposures, not stalled yet. */
  beforeStall: at(day(12, "sun"), "20:00"),
  /** Mon CW13 morning: consolidate week, the extended block's last week. */
  consolidateMonday: at(day(13, "mon"), "07:00"),
  /** Sun CW13 evening: the whole block logged, CW13 still current. */
  end: at(day(13, "sun"), "20:00"),
  /** Mon CW14 morning: training week 13, block complete. */
  blockDone: at(day(14, "mon"), "09:00"),
} as const;

export const IDS = {
  thursdayTrigger: sessionId({ cw: 4, dow: "thu", code: "C" }),
  comeback: sessionId({ cw: 8, dow: "mon", code: "A" }),
  afterComeback: sessionId({ cw: 8, dow: "wed", code: "B" }),
  stallSession: sessionId({ cw: 13, dow: "mon", code: "B" }),
} as const;

// ---------------------------------------------------------------- expected (index 0 = CW1 .. index 12 = CW13)

/* prettier-ignore */
export const EXPECTED = {
  status: ["target", "floor", "target", "floor", "target", "floor", "zero", "floor", "target", "floor", "floor", "target", "target"] as WeekStatus[],
  strength_done: [3, 2, 3, 2, 3, 2, 0, 2, 3, 3, 2, 3, 3],
  cardio_done: [1, 1, 1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 1],
  walking_minutes: [0, 0, 0, 0, 0, 0, 45, 0, 0, 0, 0, 0, 0],
  training_week: [1, 2, 3, 4, 5, 6, 7, 7, 8, 9, 10, 11, 12],
  phase: ["return", "return", "return", "return", "deload", "build", "build", "build", "build", "push", "push", "push", "consolidate"] as PhaseName[],
  reactive_deload: [false, false, false, false, true, false, false, false, false, false, false, false, false],
  dots: ["target", "floor", "target", "floor", "target", "floor", "floor", "target", "floor", "floor", "target", "target"] as DotState[],
  streak: { weeks_without_zero: 12, floor_weeks: 12, target_weeks: 6, zero_weeks: 1, repairs_used: 0, current_run: 6, best_run: 6 },
  /** With CW7 repaired (streak freeze, D9): the run is never broken. */
  streakRepaired: { weeks_without_zero: 13, repairs_used: 1, current_run: 13, best_run: 13 },
  block: { training_week: 12, phase: "consolidate" as PhaseName, extension_weeks: 1, deload_week: 5, reactive_deload_used: true, complete: false },
  totals: { strength_sessions: 31, cardio_sessions: 9, sessions: 40, walking_minutes: 45 },
  /** Comeback plan for A on Mon CW8: [sets, kg, reps] per prescription (same weights, one set fewer). */
  comeback: { A1: [3, 75, 8], A2: [3, 57.5, 8], A3: [2, 55, 12] } as Record<string, [number, number, number]>,
  /** Deload plan for B on Mon CW5: [sets, kg]. */
  deload: { B1: [2, 90], B2: [2, 40] } as Record<string, [number, number]>,
  /** Logged exercises whose e1RM rises on every eligible exposure: never stalled. */
  neverStalled: ["back_squat", "bench_press", "chest_supported_row", "trap_bar_deadlift", "leg_press", "incline_dumbbell_press", "seated_cable_row"],
  stalled: "overhead_press",
};

/** Working sets and kg lifted (Σ weight × reps, per_hand × 2), computed from the rows above. */
export const EXPECTED_TOTALS = (() => {
  let setCount = 0;
  let kg = 0;
  for (const row of STRENGTH_ROWS)
    LIFTS[row.code].forEach(([exercise, reps], i) => {
      const n = row.sets[i] ?? 0;
      const w = row.loads[i] ?? 0;
      setCount += n;
      kg += n * w * reps * (lib(exercise).per_hand ? 2 : 1);
    });
  return { sets: setCount, kg_lifted: Math.round(kg * 100) / 100 };
})();
