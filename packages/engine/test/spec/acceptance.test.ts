/**
 * SPEC 9 phase 1 acceptance criteria that the engine owns:
 *   9.2 week card floor / target state after any combination of full, short, travel and cardio sessions,
 *   9.4 every target has an explanation from the decision log,
 *   9.6 changing a threshold in engine.json changes behavior,
 * plus determinism (same input, same output).
 */
import { describe, expect, it } from "vitest";
import { Decision } from "@gym/schema";
import type { DayCode, Settings } from "@gym/schema";
import { computeState, defaultSettings, planCardio, planSession, summarizeSession } from "../../src/index";
import type { EngineContext, EngineState, PlanOptions, SessionPlan, WeekStatus } from "../../src/index";
import type { Part, StrengthCode } from "./helpers";
import {
  BASE_CONFIG,
  BASE_PROGRAM,
  GUILT_WORDS,
  SPEC_BENCH_PROGRAM,
  at,
  checkin,
  configWith,
  day,
  dayLog,
  easyCardio,
  fillerWeeks,
  intervals,
  makeCtx,
  must,
  planMuscleSets,
  planned,
  repsAt,
  sets,
  steadyWeeks,
  strength,
  upTo,
  walk,
  workSets,
  type Dow,
} from "./helpers";
import { IDS, T, TWELVE_WEEKS_HISTORY } from "./fixtures/twelve-weeks";

// ---------------------------------------------------------------- 9.2 week card

const starred = (code: StrengthCode) =>
  must(BASE_PROGRAM.days.find((d) => d.code === code)).prescriptions.filter((p) => p.starred).map((p) => p.exercise_id);

const full = (code: "A" | "B" | "C", dow: Dow) => strength({ code, date: day(1, dow), log: dayLog(code, 0) });
const short = (code: "A" | "B" | "C", dow: Dow) =>
  strength({ code, date: day(1, dow), mode: "short", log: dayLog(code, 0, { sets: 2, only: starred(code) }) });
const travel = (dow: Dow) => strength({ code: "TRAVEL", date: day(1, dow), log: dayLog("TRAVEL", 0) });
const hard = (dow: Dow) => intervals(day(1, dow), 1);
const easy = (dow: Dow) => easyCardio(day(1, dow), 30, "12:00");

interface Combo {
  name: string;
  parts: Part[];
  strength: number;
  cardio: number;
  bonus: number;
  floor: boolean;
  target: boolean;
  current: WeekStatus; // evaluated Sunday 21:00 of that week
  completed: WeekStatus; // evaluated the Monday after
  walking?: number;
}

/* prettier-ignore */
const COMBOS: Combo[] = [
  { name: "nothing", parts: [], strength: 0, cardio: 0, bonus: 0, floor: false, target: false, current: "in_progress", completed: "zero" },
  { name: "1 full", parts: [full("A", "mon")], strength: 1, cardio: 0, bonus: 0, floor: false, target: false, current: "in_progress", completed: "below_floor" },
  { name: "2 full", parts: [full("A", "mon"), full("B", "wed")], strength: 2, cardio: 0, bonus: 0, floor: true, target: false, current: "floor", completed: "floor" },
  { name: "1 full + 1 short", parts: [full("A", "mon"), short("B", "thu")], strength: 2, cardio: 0, bonus: 0, floor: true, target: false, current: "floor", completed: "floor" },
  { name: "2 short", parts: [short("A", "tue"), short("B", "fri")], strength: 2, cardio: 0, bonus: 0, floor: true, target: false, current: "floor", completed: "floor" },
  { name: "3 full, no cardio", parts: [full("A", "mon"), full("B", "wed"), full("C", "fri")], strength: 3, cardio: 0, bonus: 0, floor: true, target: false, current: "floor", completed: "floor" },
  { name: "3 full + cardio", parts: [full("A", "mon"), full("B", "wed"), full("C", "fri"), hard("sat")], strength: 3, cardio: 1, bonus: 0, floor: true, target: true, current: "target", completed: "target" },
  { name: "2 full + cardio", parts: [full("A", "mon"), full("B", "thu"), hard("sat")], strength: 2, cardio: 1, bonus: 0, floor: true, target: false, current: "floor", completed: "floor" },
  { name: "travel + short", parts: [travel("mon"), short("A", "thu")], strength: 2, cardio: 0, bonus: 0, floor: true, target: false, current: "floor", completed: "floor" },
  { name: "cardio only", parts: [hard("sat")], strength: 0, cardio: 1, bonus: 0, floor: false, target: false, current: "in_progress", completed: "below_floor" },
  { name: "walks only", parts: [walk(day(1, "tue"), 40), walk(day(1, "thu"), 40), walk(day(1, "sat"), 40)], strength: 0, cardio: 0, bonus: 0, floor: false, target: false, current: "in_progress", completed: "zero", walking: 120 },
  { name: "4 strength + 2 cardio (bonus)", parts: [full("A", "mon"), full("B", "tue"), short("C", "thu"), full("A", "sat"), hard("wed"), easy("sun")], strength: 4, cardio: 2, bonus: 2, floor: true, target: true, current: "target", completed: "target" },
  { name: "2 full + travel + cardio", parts: [full("A", "mon"), full("B", "wed"), travel("fri"), hard("sat")], strength: 3, cardio: 1, bonus: 0, floor: true, target: true, current: "target", completed: "target" },
  { name: "short + easy cardio", parts: [short("A", "mon"), easy("wed")], strength: 1, cardio: 1, bonus: 0, floor: false, target: false, current: "in_progress", completed: "below_floor" },
  { name: "3 full + hard and easy cardio", parts: [full("A", "mon"), full("B", "wed"), full("C", "fri"), hard("tue"), easy("sat")], strength: 3, cardio: 2, bonus: 1, floor: true, target: true, current: "target", completed: "target" },
  { name: "comeback mode counts", parts: [strength({ code: "A", date: day(1, "mon"), mode: "comeback", log: dayLog("A", 0, { sets: 1 }) }), full("B", "wed")], strength: 2, cardio: 0, bonus: 0, floor: true, target: false, current: "floor", completed: "floor" },
  { name: "warm-up only session does not count", parts: [strength({ code: "A", date: day(1, "mon"), log: { back_squat: { sets: [], warmups: [[40, 10, null], [50, 5, null]] } } })], strength: 0, cardio: 0, bonus: 0, floor: false, target: false, current: "in_progress", completed: "zero" },
  { name: "deleted session is ignored", parts: [strength({ code: "A", date: day(1, "mon"), deleted: true, log: dayLog("A", 0) }), full("B", "wed")], strength: 1, cardio: 0, bonus: 0, floor: false, target: false, current: "in_progress", completed: "below_floor" },
];

describe("SPEC 9.2 · week card floor and target state", () => {
  for (const c of COMBOS)
    it(`9.2 week card · ${c.name}`, () => {
      const current = computeState(makeCtx({ now: at(day(1, "sun"), "21:00"), history: c.parts }));
      const w = current.current_week;
      expect(w.id).toBe("wk_2026-11-09");
      expect([w.strength_done, w.cardio_done, w.bonus_done]).toEqual([c.strength, c.cardio, c.bonus]);
      expect([w.floor_reached, w.target_reached]).toEqual([c.floor, c.target]);
      expect(w.status).toBe(c.current);
      expect(w.is_complete).toBe(false);
      expect(w.walking_minutes).toBe(c.walking ?? 0);

      const after = computeState(makeCtx({ now: at(day(2, "mon"), "09:00"), history: c.parts }));
      const done = must(after.weeks[0]);
      expect(done.is_complete).toBe(true);
      expect(done.status).toBe(c.completed);
      expect(done.is_zero).toBe(c.completed === "zero");
      expect([done.strength_done, done.cardio_done, done.floor_reached, done.target_reached]).toEqual([c.strength, c.cardio, c.floor, c.target]);
    });

  it("9.2 week card · targets come from config: floor 2 strength, target 3 strength + 1 cardio", () => {
    expect(BASE_CONFIG.week).toMatchObject({ strength_floor: 2, strength_target: 3, cardio_target: 1 });
  });
});

// ---------------------------------------------------------------- 9.4 explanations

function expectExplained(plan: SessionPlan, config = BASE_CONFIG) {
  const ids = plan.decisions.map((d) => d.id);
  expect(new Set(ids).size, `${plan.code}: decision ids unique`).toBe(ids.length);
  for (const d of plan.decisions) {
    expect(() => Decision.parse(d), d.id).not.toThrow();
    expect(d.engine_version).toBe(config.engine_version);
    expect(d.explanation.length, d.id).toBeGreaterThan(0);
    expect(d.explanation, d.id).not.toMatch(GUILT_WORDS);
  }
  for (const pe of plan.exercises) {
    const label = `${plan.code} ${pe.prescription_id}`;
    expect(pe.reason.length, label).toBeGreaterThan(0);
    expect(pe.rule_id.length, label).toBeGreaterThan(0);
    const d = must(plan.decisions.find((x) => x.id === pe.decision_id), `${label}: decision ${pe.decision_id} in plan.decisions`);
    expect(d.rule_id, label).toBe(pe.rule_id);
    expect(d.explanation, label).toBe(pe.reason);
  }
  for (const a of plan.adjustments) {
    expect(a.rule_id.length).toBeGreaterThan(0);
    expect(a.text.length).toBeGreaterThan(0);
    expect(a.text).not.toMatch(GUILT_WORDS);
  }
}

function expectStateExplained(state: EngineState) {
  const ids = state.decisions.map((d) => d.id);
  expect(new Set(ids).size, "state decision ids unique").toBe(ids.length);
  for (const d of state.decisions) expect(() => Decision.parse(d), d.id).not.toThrow();
  for (const pe of state.next.plan.exercises) expect(ids, `next ${pe.prescription_id}`).toContain(pe.decision_id);
  expect(state.next.reason.length).toBeGreaterThan(0);
  expect(state.cardio.reason.length).toBeGreaterThan(0);
  expect(state.cardio.rule_id.length).toBeGreaterThan(0);
  for (const n of [...state.nudges, ...state.flags, ...state.warnings]) {
    expect(n.rule_id.length).toBeGreaterThan(0);
    expect(n.text.length).toBeGreaterThan(0);
    expect(n.text).not.toMatch(GUILT_WORDS);
  }
}

const EXPLAIN_CASES: { name: string; ctx: () => EngineContext; plans: PlanOptions[] }[] = [
  {
    name: "week 1, nothing known and remembered weights",
    ctx: () => makeCtx({ now: at(day(1, "mon"), "07:00"), settings: { remembered_weights: { back_squat: { weight: 100, reps: 5 } } } }),
    plans: [{ code: "A", mode: "full" }, { code: "B", mode: "full" }, { code: "C", mode: "full" }, { code: "A", mode: "short" }, { code: "TRAVEL", mode: "travel" }],
  },
  {
    name: "build week with a low readiness check-in",
    ctx: () => makeCtx({ now: at(day(5, "mon"), "08:00"), history: [steadyWeeks(1, 4), checkin(day(5, "mon"), [1, 2, 2, 2])] }),
    plans: [{ code: "A", mode: "full" }, { code: "B", mode: "full" }, { code: "C", mode: "short" }],
  },
  {
    name: "deload week",
    ctx: () => makeCtx({ now: at(day(8, "mon"), "07:00"), history: steadyWeeks(1, 7) }),
    plans: [{ code: "A", mode: "full" }, { code: "B", mode: "full" }, { code: "C", mode: "full" }],
  },
  {
    name: "consolidate week with top sets",
    ctx: () => makeCtx({ now: at(day(12, "mon"), "07:00"), history: steadyWeeks(1, 11) }),
    plans: [{ code: "A", mode: "full" }, { code: "B", mode: "full" }],
  },
  {
    name: "limitations, swaps and e1RM mapping",
    ctx: () =>
      makeCtx({
        now: at(day(1, "wed"), "07:00"),
        settings: { limitations: ["knee_friendly", "shoulder_symmetry"] },
        history: [strength({ code: "A", date: day(1, "mon"), log: { romanian_deadlift: sets(2, 60, 9, 4) } })],
      }),
    plans: [{ code: "A", mode: "full" }, { code: "C", mode: "full" }, { code: "B", mode: "full", swaps: { B1: "romanian_deadlift" } }],
  },
  {
    name: "comeback after a zero week with a short break",
    ctx: () => makeCtx({ now: at(day(4, "mon"), "07:00"), history: steadyWeeks(1, 2) }),
    plans: [{ code: "A", mode: "full" }, { code: "B", mode: "short" }],
  },
  {
    name: "progression decisions from logged sessions",
    ctx: () =>
      makeCtx({
        now: at(day(5, "fri"), "08:00"),
        program: SPEC_BENCH_PROGRAM,
        history: [fillerWeeks(1, 4), strength({ code: "A", date: day(5, "mon"), program: SPEC_BENCH_PROGRAM, log: { bench_press: repsAt(80, [8, 8, 8], 2) } })],
      }),
    plans: [{ code: "A", mode: "full" }],
  },
];

describe("SPEC 9.4 · every target has a reason, a rule_id and a decision in the log", () => {
  for (const c of EXPLAIN_CASES)
    it(`9.4 explanations · ${c.name}`, () => {
      const ctx = c.ctx();
      for (const opts of c.plans) expectExplained(planSession(ctx, opts));
      expectStateExplained(computeState(ctx));
      const cardio = planCardio(ctx);
      expect(cardio.reason.length).toBeGreaterThan(0);
      expect(cardio.rule_id.length).toBeGreaterThan(0);
    });

  it("9.4 explanations · the whole twelve-week fixture", () => {
    const ctx = makeCtx({ now: T.end, history: upTo(TWELVE_WEEKS_HISTORY, T.end) });
    const state = computeState(ctx);
    expectStateExplained(state);
    for (const code of ["A", "B", "C"] as const) expectExplained(planSession(ctx, { code, mode: "full" }));
    for (const d of state.decisions) expect(d.explanation, d.id).not.toMatch(GUILT_WORDS);
  });

  it("9.4 explanations · decision ids are deterministic (ENGINE_RULES 0)", () => {
    const ctx = makeCtx({ now: at(day(1, "mon"), "07:00") });
    const plan = planSession(ctx, { code: "A", mode: "full" });
    for (const pe of plan.exercises) expect(pe.decision_id).toBe(`d:init:${pe.exercise_id}@${pe.rep_min}-${pe.rep_max}`);
  });
});

// ---------------------------------------------------------------- 9.6 config driven

describe("SPEC 9.6 · changing a threshold in engine.json changes behavior", () => {
  it("9.6 config · progression.below_range_min_sets: 3 turns 6, 5, 4 from below_range into hold_add_reps", () => {
    const run = (min: number) => {
      const config = configWith((c) => {
        c.progression.below_range_min_sets = min;
      });
      const s = strength({ code: "A", date: day(5, "mon"), program: SPEC_BENCH_PROGRAM, log: { bench_press: repsAt(80, [6, 5, 4], 2) } });
      const state = computeState(makeCtx({ now: at(day(5, "fri"), "08:00"), config, program: SPEC_BENCH_PROGRAM, history: [fillerWeeks(1, 4), s] }));
      return state.tracks["bench_press@6-8"]?.last_rule_id;
    };
    expect(run(2)).toBe("dp.below_range");
    expect(run(3)).toBe("dp.hold_add_reps");
  });

  it("9.6 config · calibration.start_pct flows through defaultSettings into week 1 loads", () => {
    const now = at(day(1, "mon"), "07:00");
    const run = (pct: number) => {
      const config = configWith((c) => {
        c.calibration.start_pct = pct;
      });
      const s: Settings = { ...defaultSettings(config, BASE_PROGRAM, now), remembered_weights: { bench_press: { weight: 100, reps: 5 } } };
      const plan = planSession(makeCtx({ now, config, settings: s }), { code: "A", mode: "full" });
      return workSets(planned(plan, "A2"))[0]?.weight;
    };
    expect(run(0.6)).toBe(60);
    expect(run(0.65)).toBe(65);
  });

  it("9.6 config · readiness.threshold: 1.5 means an average of 1.75 no longer adjusts the session", () => {
    const run = (threshold: number) => {
      const config = configWith((c) => {
        c.readiness.threshold = threshold;
      });
      const ctx = makeCtx({ now: at(day(5, "mon"), "08:00"), config, history: [steadyWeeks(1, 4), checkin(day(5, "mon"), [1, 2, 2, 2])] });
      return computeState(ctx).readiness?.adjusted;
    };
    expect(run(2.25)).toBe(true);
    expect(run(1.5)).toBe(false);
  });

  it("9.6 config · never_miss_twice.hours: 72 h means no nudge after 49 h", () => {
    const history = [strength({ code: "A", date: day(1, "mon"), log: dayLog("A", 0) })];
    const run = (hours: number) => {
      const config = configWith((c) => {
        c.never_miss_twice.hours = hours;
      });
      return computeState(makeCtx({ now: at(day(1, "wed"), "20:00"), config, history })).nudges.some((n) => n.kind === "never_miss_twice");
    };
    expect(run(48)).toBe(true);
    expect(run(72)).toBe(false);
  });

  it("9.6 config · week.strength_floor: 1 makes a single session reach the floor", () => {
    const history = [full("A", "mon")];
    const run = (floor: number) => {
      const config = configWith((c) => {
        c.week.strength_floor = floor;
      });
      return computeState(makeCtx({ now: at(day(1, "sun"), "21:00"), config, history })).current_week.status;
    };
    expect(run(2)).toBe("in_progress");
    expect(run(1)).toBe("floor");
  });

  it("9.6 config · e1rm.divisor: 40 changes the stored e1RM (80 × 8 @ 2 → 100 instead of 106.67)", () => {
    const history = [strength({ code: "A", date: day(1, "mon"), log: { bench_press: sets(2, 80, 8, 2) } })];
    const run = (divisor: number) => {
      const config = configWith((c) => {
        c.e1rm.divisor = divisor;
      });
      return computeState(makeCtx({ now: at(day(1, "wed"), "09:00"), config, history })).stats["bench_press"]?.e1rm;
    };
    expect(run(30)).toBeCloseTo(106.67, 1);
    expect(run(40)).toBeCloseTo(100, 1);
  });

  it("9.6 config · volume.session_cap: 5 takes a set off the Romanian deadlift (glutes 6 → 5)", () => {
    const run = (cap: number) => {
      const config = configWith((c) => {
        c.volume.session_cap = cap;
      });
      const plan = planSession(makeCtx({ now: at(day(5, "mon"), "07:00"), config, history: steadyWeeks(1, 4) }), { code: "A", mode: "full" });
      return { plan, glutes: planMuscleSets(plan, config).glutes ?? 0 };
    };
    const normal = run(11);
    expect(workSets(planned(normal.plan, "A4")).length).toBe(2);
    const capped = run(5);
    expect(capped.glutes).toBeLessThanOrEqual(5);
    expect(workSets(planned(capped.plan, "A4")).length).toBe(1);
    expect(workSets(planned(capped.plan, "A1")).length).toBe(4);
    expect(workSets(planned(capped.plan, "A2")).length).toBe(4);
    // ASSUMPTION: exercises that do not load the capped muscle keep their sets.
    expect(workSets(planned(capped.plan, "A5")).length).toBe(2);
    expect(workSets(planned(capped.plan, "A6")).length).toBe(2);
  });

  it("9.6 config · stall.exposures: 2 flags a stall one session earlier", () => {
    const ohp = (date: string) => strength({ code: "B", date, log: { overhead_press: sets(2, 40, 8, 3) } });
    const history = [ohp(day(1, "mon")), ohp(day(1, "thu")), ohp(day(2, "mon"))];
    const run = (n: number) => {
      const config = configWith((c) => {
        c.stall.exposures = n;
      });
      return computeState(makeCtx({ now: at(day(2, "tue"), "08:00"), config, history })).stats["overhead_press"]?.stalled;
    };
    expect(run(3)).toBe(false);
    expect(run(2)).toBe(true);
  });

  it("9.6 config · short_version.set_reduction: 2 takes two sets off in the 30 min version", () => {
    const run = (n: number) => {
      const config = configWith((c) => {
        c.short_version.set_reduction = n;
      });
      const plan = planSession(makeCtx({ now: at(day(2, "mon"), "07:00"), config, history: steadyWeeks(1, 1) }), { code: "A", mode: "short" });
      return plan.exercises.map((e) => workSets(e).length);
    };
    expect(run(1)).toEqual([2, 2, 2]);
    expect(run(2)).toEqual([1, 1, 1]);
  });

  it("9.6 config · reactive_deload.checkin_days: 2 bad days are enough when configured", () => {
    const run = (days: number) => {
      const config = configWith((c) => {
        c.reactive_deload.checkin_days = days;
      });
      const history = [
        steadyWeeks(1, 2),
        checkin(day(3, "tue"), [1, 2, 2, 2]),
        checkin(day(3, "wed"), [2, 2, 1, 2]),
        strength({ code: "B", date: day(3, "thu"), log: dayLog("B", 2) }),
      ];
      return computeState(makeCtx({ now: at(day(4, "mon"), "07:00"), config, history })).block.deload_week;
    };
    expect(run(3)).toBe(8);
    expect(run(2)).toBe(4);
  });
});

// ---------------------------------------------------------------- determinism

describe("ENGINE_RULES 0 · determinism", () => {
  const ctx = () => makeCtx({ now: T.end, history: upTo(TWELVE_WEEKS_HISTORY, T.end) });

  it("same context twice → deep equal state, plans, cardio and summaries", () => {
    const a = ctx();
    const b = ctx();
    expect(computeState(a)).toEqual(computeState(a));
    expect(computeState(a)).toEqual(computeState(b));
    for (const code of ["A", "B", "C", "TRAVEL"] as DayCode[]) {
      const opts: PlanOptions = { code, mode: code === "TRAVEL" ? "travel" : "full" };
      expect(planSession(a, opts)).toEqual(planSession(b, opts));
    }
    expect(planCardio(a)).toEqual(planCardio(b));
    expect(summarizeSession(a, IDS.stallSession)).toEqual(summarizeSession(b, IDS.stallSession));
  });

  it("the engine does not mutate its input", () => {
    const a = ctx();
    const snapshot = structuredClone(a);
    computeState(a);
    planSession(a, { code: "A", mode: "full" });
    planCardio(a);
    expect(a).toEqual(snapshot);
  });

  it("the clock is ctx.now only: later real time, same output", () => {
    const a = ctx();
    const first = JSON.stringify(computeState(a));
    const second = JSON.stringify(computeState(structuredClone(a)));
    expect(second).toBe(first);
  });
});
