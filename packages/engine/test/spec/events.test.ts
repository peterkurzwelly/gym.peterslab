/**
 * SPEC 6.4 events, week level rows: stall, reactive deload, missed session, never miss twice, zero week, breaks.
 * Session level rows (readiness, 30 min mode, substitution, interference guard) are in session-modifiers.test.ts.
 */
import { describe, expect, it } from "vitest";
import type { EngineConfig } from "@gym/schema";
import { computeState, planCardio, planSession, summarizeSession } from "../../src/index";
import type { EngineState } from "../../src/index";
import {
  at,
  checkin,
  day,
  dayLog,
  fillerWeeks,
  floorTo,
  intervals,
  keyOf,
  makeCtx,
  monday,
  must,
  planned,
  plusHours,
  repairedWeek,
  sets,
  steadyWeeks,
  strength,
  workSets,
} from "./helpers";

const flagsOf = (s: EngineState, kind: string) => s.flags.filter((f) => f.kind === kind);
const nudge = (s: EngineState, kind: string) => s.nudges.find((n) => n.kind === kind);

// ---------------------------------------------------------------- stall

describe("SPEC 6.4 · stall", () => {
  // OHP 40 × 8 @ 3 every B session: e1RM flat at 54.67.
  const ohp = (date: string) => strength({ code: "B", date, log: { overhead_press: sets(2, 40, 8, 3) } });
  const four = [ohp(day(1, "mon")), ohp(day(1, "thu")), ohp(day(2, "mon")), ohp(day(2, "thu"))];

  it("6.4 stall · no stall after 3 exposures (nothing before them to compare with)", () => {
    const state = computeState(makeCtx({ now: at(day(2, "tue"), "08:00"), history: four.slice(0, 3) }));
    expect(flagsOf(state, "stall")).toEqual([]);
    expect(state.stats["overhead_press"]?.stalled).toBe(false);
  });

  it("6.4 stall · e1RM not improved over the last 3 exposures → stall flag, stalled on stats and the plan (event.stall)", () => {
    const ctx = makeCtx({ now: at(day(2, "fri"), "08:00"), history: four });
    const state = computeState(ctx);
    const flag = must(flagsOf(state, "stall").find((f) => f.exercise_id === "overhead_press"));
    expect(flag.rule_id).toBe("event.stall");
    expect(flag.text.length).toBeGreaterThan(0);
    expect(state.stats["overhead_press"]?.stalled).toBe(true);
    expect(state.stats["overhead_press"]?.exposures_since_best).toBeGreaterThanOrEqual(3);
    expect(planned(planSession(ctx, { code: "B", mode: "full" }), "B2").stalled).toBe(true);
  });

  it("6.4 stall · any e1RM gain inside the window clears it", () => {
    const gain = strength({ code: "B", date: day(2, "thu"), log: { overhead_press: sets(2, 42.5, 8, 3) } });
    const state = computeState(makeCtx({ now: at(day(2, "fri"), "08:00"), history: [...four.slice(0, 3), gain] }));
    expect(flagsOf(state, "stall")).toEqual([]);
  });
});

// ---------------------------------------------------------------- reactive deload

describe("SPEC 6.4 · reactive deload", () => {
  function expectDeloadWeek(state: EngineState, tw: number) {
    expect(state.block.deload_week).toBe(tw);
    expect(state.block.reactive_deload_used).toBe(true);
    const flags = flagsOf(state, "reactive_deload");
    expect(flags.length).toBe(1);
    expect(flags[0]?.rule_id).toBe("event.reactive_deload");
  }

  it("6.4 reactive deload · trigger 1: e1RM down ≥ 5% on 2 main lifts across 2 sessions → next training week is the deload", () => {
    // CW2 Mon/Thu: squat 100×5@2 (123.33), bench 80×5@2 (98.67). CW3 Mon: squat 90×5@2 (111 ≤ 117.17), bench 72.5×5@2 (89.42 ≤ 93.73).
    // Triggered in training week 3 → week 4 is the deload.
    const a = (date: string, squat: number, benchKg: number) =>
      strength({ code: "A", date, log: { back_squat: sets(3, squat, 5, 2), bench_press: sets(3, benchKg, 5, 2) } });
    const history = [
      fillerWeeks(1, 1),
      a(day(2, "mon"), 100, 80),
      a(day(2, "thu"), 100, 80),
      a(day(3, "mon"), 90, 72.5),
      strength({ code: "C", date: day(3, "thu"), id: "f_cw3", log: { leg_press: sets(2, 110, 10, 3) } }),
    ];
    const ctx = makeCtx({ now: at(day(4, "mon"), "07:00"), history });
    const state = computeState(ctx);
    expectDeloadWeek(state, 4);
    expect(state.current_week.training_week).toBe(4);
    expect(state.current_week.phase).toBe("deload");
    expect(state.current_week.reactive_deload).toBe(true);

    const plan = planSession(ctx, { code: "A", mode: "full" });
    expect(plan.phase).toBe("deload");
    expect(plan.flags).toContain("deload");
    expect(plan.exercises.map((e) => workSets(e).length)).toEqual([2, 2, 2, 1, 1, 1]);
    expect(planned(plan, "A1").target_rir).toBe(3);
    const cardio = planCardio(ctx);
    expect([cardio.kind, cardio.rule_id, cardio.total_min]).toEqual(["easy", "cardio.deload", 30]);

    // The planned week 8 deload is cancelled: training week 8 takes the phase before it (build).
    const later = computeState(makeCtx({ now: at(day(8, "mon"), "07:00"), history: [...history, fillerWeeks(4, 7)] }));
    expect(later.block.training_week).toBe(8);
    expect(later.current_week.phase).toBe("build");
    expect(later.block.deload_week).toBe(4);
  });

  it("6.4 reactive deload · trigger 2: rep targets missed 2 sessions running on 2 exercises", () => {
    // squat 80 × 4,4,3 and bench 70 × 4,4,3 (range 5 to 8) twice in CW2 → triggered in training week 2 → week 3 deload
    const a = (date: string) =>
      strength({ code: "A", date, log: { back_squat: [[80, 4, 2], [80, 4, 2], [80, 3, 2]], bench_press: [[70, 4, 2], [70, 4, 2], [70, 3, 2]] } });
    const state = computeState(makeCtx({ now: at(day(3, "mon"), "07:00"), history: [fillerWeeks(1, 1), a(day(2, "mon")), a(day(2, "thu"))] }));
    expectDeloadWeek(state, 3);
    expect(state.current_week.phase).toBe("deload");
  });

  it("6.4 reactive deload · trigger 2 needs 2 exercises: one exercise below range twice is a reset, not a deload", () => {
    const a = (date: string) =>
      strength({ code: "A", date, log: { back_squat: sets(3, 80, 6, 2), bench_press: [[70, 4, 2], [70, 4, 2], [70, 3, 2]] } });
    const state = computeState(makeCtx({ now: at(day(3, "mon"), "07:00"), history: [fillerWeeks(1, 1), a(day(2, "mon")), a(day(2, "thu"))] }));
    expect(state.block.deload_week).toBe(8);
    expect(state.block.reactive_deload_used).toBe(false);
    expect(state.tracks["bench_press@5-8"]?.last_rule_id).toBe("dp.reset");
  });

  const badWeek = (cw: number) => [
    checkin(day(cw, "mon"), [2, 2, 2, 2]), // 2.00
    checkin(day(cw, "tue"), [1, 2, 2, 2]), // 1.75
    checkin(day(cw, "wed"), [2, 2, 1, 2]), // 1.75
  ];

  it("6.4 reactive deload · trigger 3: check-in average ≤ 2 for 3 consecutive days", () => {
    const history = [steadyWeeks(1, 2), badWeek(3), strength({ code: "B", date: day(3, "thu"), log: dayLog("B", 2) })];
    const state = computeState(makeCtx({ now: at(day(4, "mon"), "07:00"), history }));
    expectDeloadWeek(state, 4);
    expect(state.current_week.phase).toBe("deload");
  });

  it("6.4 reactive deload · trigger 3 needs all three days ≤ 2.0", () => {
    const history = [
      steadyWeeks(1, 2),
      checkin(day(3, "mon"), [3, 3, 3, 3]),
      checkin(day(3, "tue"), [1, 2, 2, 2]),
      checkin(day(3, "wed"), [2, 2, 1, 2]),
      strength({ code: "B", date: day(3, "thu"), log: dayLog("B", 2) }),
    ];
    const state = computeState(makeCtx({ now: at(day(4, "mon"), "07:00"), history }));
    expect(state.block.deload_week).toBe(8);
    expect(state.current_week.phase).toBe("return");
    expect(flagsOf(state, "reactive_deload")).toEqual([]);
  });

  it("6.4 reactive deload · once per block: a second trigger does not pull another deload", () => {
    // ASSUMPTION: a second trigger in the same block emits no second reactive_deload flag (ENGINE_RULES is silent on its flag).
    const history = [
      steadyWeeks(1, 2),
      badWeek(3),
      strength({ code: "B", date: day(3, "thu"), log: dayLog("B", 2) }), // trigger → tw 4 deload
      strength({ code: "A", date: day(4, "mon"), log: dayLog("A", 3) }),
      strength({ code: "C", date: day(4, "thu"), log: dayLog("C", 3) }),
      badWeek(5),
      strength({ code: "A", date: day(5, "mon"), log: dayLog("A", 4) }),
      strength({ code: "B", date: day(5, "thu"), log: dayLog("B", 4) }), // criteria met again in tw 5
    ];
    const state = computeState(makeCtx({ now: at(day(6, "mon"), "07:00"), history }));
    expect(state.block.deload_week).toBe(4);
    expect(state.current_week.training_week).toBe(6);
    expect(state.current_week.phase).toBe("build");
    expect(flagsOf(state, "reactive_deload").length).toBe(1);
  });

  it("6.4 reactive deload · after week 8 it only flags (deload_criteria_met)", () => {
    const history = [steadyWeeks(1, 8), badWeek(9), strength({ code: "B", date: day(9, "thu"), log: dayLog("B", 8) })];
    const state = computeState(makeCtx({ now: at(day(10, "mon"), "07:00"), history }));
    expect(state.block.deload_week).toBe(8);
    expect(state.block.reactive_deload_used).toBe(false);
    expect(state.current_week.training_week).toBe(10);
    expect(state.current_week.phase).toBe("push");
    expect(flagsOf(state, "deload_criteria_met").length).toBeGreaterThanOrEqual(1);
    expect(flagsOf(state, "reactive_deload")).toEqual([]);
  });

  it("6.4 reactive deload · triggered in week 7 (k + 1 = planned week): only flags, week 8 deload stays", () => {
    const history = [steadyWeeks(1, 6), badWeek(7), strength({ code: "B", date: day(7, "thu"), log: dayLog("B", 6) })];
    const state = computeState(makeCtx({ now: at(day(8, "mon"), "07:00"), history }));
    expect(state.block.deload_week).toBe(8);
    expect(state.block.reactive_deload_used).toBe(false);
    expect(state.current_week.phase).toBe("deload");
    expect(flagsOf(state, "deload_criteria_met").length).toBeGreaterThanOrEqual(1);
    expect(flagsOf(state, "reactive_deload")).toEqual([]);
  });
});

// ---------------------------------------------------------------- missed session, never stack, never miss twice

describe("SPEC 6.4 · missed session and never stack", () => {
  it("6.4 missed session · no history → first in rotation", () => {
    const state = computeState(makeCtx({ now: at(day(1, "mon"), "07:00") }));
    expect(state.next.code).toBe("A");
    expect(state.next.reason.length).toBeGreaterThan(0);
    expect(state.next.done_today).toBe(false);
  });

  it("6.4 missed session · the rotation follows settings.session_order", () => {
    const state = computeState(makeCtx({ now: at(day(1, "mon"), "07:00"), settings: { session_order: ["C", "A", "B"] } }));
    expect(state.next.code).toBe("C");
  });

  it("6.4 missed session · days without training change nothing: the next session in line stays next", () => {
    const a = strength({ code: "A", date: day(1, "mon"), log: dayLog("A", 0) });
    for (const now of [at(day(1, "wed"), "07:00"), at(day(1, "sun"), "12:00")]) {
      const state = computeState(makeCtx({ now, history: [a] }));
      expect(state.next.code).toBe("B");
      expect(state.next.plan.code).toBe("B");
    }
  });

  it("6.4 missed session · travel does not advance the rotation", () => {
    const history = [
      strength({ code: "A", date: day(1, "mon"), log: dayLog("A", 0) }),
      strength({ code: "TRAVEL", date: day(1, "wed"), log: dayLog("TRAVEL", 0) }),
    ];
    const state = computeState(makeCtx({ now: at(day(1, "thu"), "07:00"), history }));
    expect(state.next.code).toBe("B");
    expect(state.current_week.strength_done).toBe(2); // travel counts toward the floor
  });

  it("6.4 never stack · a strength session already done today → done_today, next stays next (plan.never_stack)", () => {
    const a = strength({ code: "A", date: day(1, "mon"), time: "07:00", log: dayLog("A", 0) });
    const state = computeState(makeCtx({ now: at(day(1, "mon"), "12:00"), history: [a] }));
    expect(state.next.done_today).toBe(true);
    expect(state.next.code).toBe("B");
    expect(state.next.reason.length).toBeGreaterThan(0);
    expect(nudge(state, "never_miss_twice")).toBeUndefined();
    // cardio on the same day is fine
    expect(state.cardio.counts_as).toBe("target");
  });
});

describe("SPEC 6.4 · never miss twice", () => {
  const history = [steadyWeeks(1, 1), strength({ code: "A", date: day(2, "mon"), time: "18:00", log: dayLog("A", 1) })];

  it("6.4 never miss twice · ≥ 48 h after the last strength session, floor not reached → nudge with the short version of next", () => {
    const state = computeState(makeCtx({ now: at(day(2, "wed"), "19:00"), history }));
    const n = must(nudge(state, "never_miss_twice"));
    expect(n.rule_id).toBe("event.never_miss_twice");
    expect(n.action).toEqual({ mode: "short", code: "B" });
    expect(n.text.length).toBeGreaterThan(0);
  });

  it("6.4 never miss twice · not before 48 h", () => {
    const state = computeState(makeCtx({ now: at(day(2, "wed"), "17:00"), history }));
    expect(nudge(state, "never_miss_twice")).toBeUndefined();
  });

  it("6.4 never miss twice · not once the week's floor is reached", () => {
    const h = [...history, strength({ code: "B", date: day(2, "tue"), log: dayLog("B", 1) })];
    const state = computeState(makeCtx({ now: at(day(2, "fri"), "19:00"), history: h }));
    expect(state.current_week.floor_reached).toBe(true);
    expect(nudge(state, "never_miss_twice")).toBeUndefined();
  });

  it("6.4 never miss twice · counts from block start when there is no session yet", () => {
    // ASSUMPTION: block start = 00:00 local on settings.block_start_date.
    expect(nudge(computeState(makeCtx({ now: at(day(1, "tue"), "23:00") })), "never_miss_twice")).toBeUndefined();
    const n = nudge(computeState(makeCtx({ now: at(day(1, "wed"), "01:00") })), "never_miss_twice");
    expect(n?.action).toEqual({ mode: "short", code: "A" });
  });
});

// ---------------------------------------------------------------- zero week

describe("SPEC 6.4 · zero week", () => {
  // Steady CW1-2 (last session Sat 11-21 cardio, Fri 11-20 strength), CW3 empty, now Mon CW4.
  // A zero week always means a gap of ≥ 8 days, which is a short break by default; the isolated case widens
  // break.short_days_min to 12 so only the comeback rule applies.
  const isolated = (c: EngineConfig) => {
    c.break.short_days_min = 12;
  };
  const history = () => steadyWeeks(1, 2);
  const now = at(day(4, "mon"), "07:00");

  it("6.4 zero week · phase does not advance and the next strength session is a comeback: one set fewer, same loads", () => {
    const ctx = makeCtx({ now, history: history(), config: isolated });
    const state = computeState(ctx);
    expect(state.weeks[2]?.status).toBe("zero");
    expect(state.current_week.training_week).toBe(3);
    const plan = state.next.plan;
    expect(state.next.code).toBe("A");
    expect(plan.flags).toContain("comeback");
    expect(plan.flags).not.toContain("break_resume");
    expect(plan.training_week).toBe(3);
    // return week 3 sets 3,3,3,2,2,2 → 2,2,2,1,1,1
    expect(plan.exercises.map((e) => workSets(e).length)).toEqual([2, 2, 2, 1, 1, 1]);
    for (const pid of ["A1", "A2", "A3"]) {
      const pe = planned(plan, pid);
      const base = must(state.tracks[keyOf(pe)]?.base_weight, `${pid} base`);
      expect(workSets(pe).every((s) => s.weight === base)).toBe(true);
    }
    const n = must(nudge(state, "comeback"));
    expect(n.rule_id).toBe("event.comeback");
    expect(n.text.length).toBeGreaterThan(0);
  });

  it("6.4 zero week · the comeback session yields no progression decision (event.comeback_hold)", () => {
    const before = computeState(makeCtx({ now, history: history(), config: isolated }));
    // 70 × 8, 8 @ 4 on squat would be dp.increase if the session were eligible
    const comeback = strength({
      code: "A",
      date: day(4, "mon"),
      mode: "comeback",
      flags: ["comeback"],
      log: { back_squat: sets(2, 70, 8, 4), bench_press: sets(2, 60, 8, 4) },
    });
    const ctx = makeCtx({ now: at(day(4, "tue"), "07:00"), history: [history(), comeback], config: isolated });
    const after = computeState(ctx);
    for (const key of ["back_squat@5-8", "bench_press@5-8"]) {
      expect(after.tracks[key]?.base_weight, key).toBe(before.tracks[key]?.base_weight);
      expect(after.tracks[key]?.base_reps, key).toBe(before.tracks[key]?.base_reps);
    }
    const changes = summarizeSession(ctx, must(comeback.id)).changes;
    expect(changes.map((c) => c.exercise_id).sort()).toEqual(["back_squat", "bench_press"]);
    for (const c of changes) expect(c.rule_id).toBe("event.comeback_hold");
    expect(after.next.plan.flags).not.toContain("comeback"); // only the first session back
  });

  it("6.4 zero week + short break (default config) · both apply: one set fewer and loads × 0.85 rounded down", () => {
    const ctx = makeCtx({ now, history: history() });
    const state = computeState(ctx);
    const plan = planSession(ctx, { code: "A", mode: "full" });
    expect(plan.flags).toEqual(expect.arrayContaining(["comeback", "break_resume"]));
    expect(plan.exercises.map((e) => workSets(e).length)).toEqual([2, 2, 2, 1, 1, 1]);
    for (const pid of ["A1", "A2", "A3"]) {
      const pe = planned(plan, pid);
      const base = must(state.tracks[keyOf(pe)]?.base_weight, `${pid} base`);
      expect(workSets(pe)[0]?.weight, pid).toBe(floorTo(base * 0.85, pe.increment_kg));
    }
  });

  it("6.4 zero week · copy stays true: \"same weights\" only when no break lowers the loads", () => {
    const sameText = "Coming back is easy on purpose: one set less, same weights.";
    const isolatedState = computeState(makeCtx({ now, history: history(), config: isolated }));
    expect(must(nudge(isolatedState, "comeback")).text).toBe(sameText);
    expect(isolatedState.next.plan.adjustments.map((a) => a.text)).toContain(sameText);

    // Default config: the zero week also made a short break, loads drop to 85%, so the copy must not say "same weights".
    const state = computeState(makeCtx({ now, history: history() }));
    const lines = [must(nudge(state, "comeback")).text, ...state.next.plan.adjustments.map((a) => a.text)];
    for (const line of lines) expect(line).not.toMatch(/same weights/);
    expect(must(state.next.plan.adjustments.find((a) => a.rule_id === "event.comeback")).text).toMatch(/one set less/);
    expect(must(state.next.plan.adjustments.find((a) => a.rule_id === "event.break_short")).text).toMatch(/85%/);
    // Loaded exercises explain the lower load with the break decision.
    expect(planned(state.next.plan, "A1").rule_id).toBe("event.break_short");
  });

  it("6.4 zero week · ENGINE_RULES 4.5: a qualifying cardio session first ends the comeback (the break window still applies)", () => {
    const ctx = makeCtx({ now: at(day(4, "tue"), "07:00"), history: [history(), intervals(day(4, "mon"), 3)] });
    const state = computeState(ctx);
    expect(state.weeks[2]?.status).toBe("zero");
    expect(nudge(state, "comeback")).toBeUndefined();
    const plan = planSession(ctx, { code: "A", mode: "full" });
    expect(plan.flags).not.toContain("comeback");
    expect(plan.flags).toContain("break_resume"); // the cardio was the first session back: 85% window from Monday
    expect(plan.exercises.map((e) => workSets(e).length)).toEqual([3, 3, 3, 2, 2, 2]);
  });

  it("6.4 zero week · block starts with a zero week: the comeback session calibrates without progressing, no second weight pick", () => {
    // CW1 empty (zero), first session Monday CW2: a comeback in training week 1 with nothing known yet.
    const first = computeState(makeCtx({ now: at(day(2, "mon"), "07:00") }));
    expect(first.weeks[0]?.status).toBe("zero");
    expect(first.next.plan.flags).toContain("comeback");
    expect(first.next.plan.training_week).toBe(1);
    const a1 = planned(first.next.plan, "A1");
    expect([a1.rule_id, a1.calibration, workSets(a1).length]).toEqual(["calib.pick", true, 1]); // week 1: 2 sets, minus 1

    const comeback = strength({ code: "A", date: day(2, "mon"), mode: "comeback", log: { back_squat: sets(1, 60, 8, 3), bench_press: sets(1, 45, 8, 4) } });
    const ctx = makeCtx({ now: at(day(2, "wed"), "07:00"), history: [comeback] });
    const state = computeState(ctx);
    // No progression decision came out of it ...
    for (const c of summarizeSession(ctx, must(comeback.id)).changes) expect(c.rule_id).toBe("event.comeback_hold");
    expect(state.tracks["back_squat@5-8"]?.exposures).toBe(0);
    // ... but the picked weights stand: same load and reps target next time, no new "pick a weight".
    const plan = planSession(ctx, { code: "A", mode: "full" });
    expect(plan.flags).not.toContain("comeback");
    for (const [pid, w] of [["A1", 60], ["A2", 45]] as const) {
      const pe = planned(plan, pid);
      expect(pe.calibration, pid).toBe(false);
      expect(pe.rule_id, pid).toBe("event.comeback_hold");
      expect(workSets(pe).map((x) => [x.weight, x.reps]), pid).toEqual([[w, 8], [w, 8]]);
    }
    // The next normal session progresses from there.
    const normal = strength({ code: "A", date: day(2, "wed"), log: { back_squat: sets(2, 60, 8, 3) } });
    const after = makeCtx({ now: at(day(2, "thu"), "07:00"), history: [comeback, normal] });
    expect(summarizeSession(after, must(normal.id)).changes[0]).toMatchObject({ rule_id: "dp.increase", from: { weight: 60, reps: 8 } });
  });

  it("6.4 zero week · repair is a streak freeze, one per 4 weeks, and never advances the phase (D9)", () => {
    // CW2 and CW4 zero. Without repairs both can be repaired; repairing CW2 blocks CW4 (same 4 week window).
    const h = [fillerWeeks(1, 1), fillerWeeks(3, 3), fillerWeeks(5, 5)];
    const now6 = at(day(6, "mon"), "07:00");
    const plain = computeState(makeCtx({ now: now6, history: h }));
    expect(plain.weeks.map((w) => w.training_week)).toEqual([1, 2, 2, 3, 3, 4]);
    expect([plain.weeks[1]?.can_repair, plain.weeks[3]?.can_repair]).toEqual([true, true]);
    expect(plain.streak.weeks_without_zero).toBe(3);

    const repaired = computeState(makeCtx({ now: now6, history: [...h, repairedWeek(monday(2))] }));
    expect(repaired.weeks[1]?.repaired).toBe(true);
    expect(repaired.weeks[1]?.is_zero).toBe(true);
    expect(repaired.weeks[3]?.can_repair).toBe(false);
    expect(repaired.weeks.map((w) => w.training_week)).toEqual([1, 2, 2, 3, 3, 4]);
    expect(repaired.streak.weeks_without_zero).toBe(4);
    expect(repaired.streak.repairs_used).toBe(1);
  });
});

// ---------------------------------------------------------------- breaks

describe("SPEC 6.4 · breaks", () => {
  // Strength only (no cardio), last session Fri CW3 = 2026-11-27.
  const history = () => steadyWeeks(1, 3, { cardio: false });

  it("6.4 break 7 to 14 days · 7 days after the last session: loads × 0.85 rounded down, flag break_resume", () => {
    const ctx = makeCtx({ now: at(day(4, "fri"), "07:00"), history: history() });
    const state = computeState(ctx);
    const plan = planSession(ctx, { code: "A", mode: "full" });
    expect(plan.flags).toContain("break_resume");
    expect(plan.training_week).toBe(4);
    expect(plan.exercises.map((e) => workSets(e).length)).toEqual([3, 3, 3, 2, 2, 2]); // sets unchanged
    for (const pid of ["A1", "A2", "A3"]) {
      const pe = planned(plan, pid);
      const base = must(state.tracks[keyOf(pe)]?.base_weight);
      expect(workSets(pe)[0]?.weight, pid).toBe(floorTo(base * 0.85, pe.increment_kg));
    }
    expect(nudge(state, "break_resume")?.rule_id).toBe("event.break_short");
  });

  it("6.4 break 7 to 14 days · 6 days is not a break", () => {
    const ctx = makeCtx({ now: at(day(4, "thu"), "07:00"), history: history() });
    const state = computeState(ctx);
    const plan = planSession(ctx, { code: "A", mode: "full" });
    expect(plan.flags).not.toContain("break_resume");
    const a1 = planned(plan, "A1");
    expect(workSets(a1)[0]?.weight).toBe(state.tracks[keyOf(a1)]?.base_weight);
  });

  it("6.4 break 7 to 14 days · applies for one week from the first session back, without progression (event.break_hold)", () => {
    const back = strength({ code: "A", date: day(4, "fri"), log: dayLog("A", 3) });
    const h = [history(), back];
    const inside = makeCtx({ now: at(day(5, "mon"), "07:00"), history: h }); // day 4 of the window
    expect(planSession(inside, { code: "B", mode: "full" }).flags).toContain("break_resume");
    const changes = summarizeSession(inside, must(back.id)).changes;
    expect(changes.length).toBeGreaterThan(0);
    for (const c of changes) expect(c.rule_id).toBe("event.break_hold");

    const b = strength({ code: "B", date: day(5, "mon"), log: dayLog("B", 3) });
    const outside = makeCtx({ now: at(day(5, "sat"), "07:00"), history: [...h, b] }); // day 9
    expect(planSession(outside, { code: "C", mode: "full" }).flags).not.toContain("break_resume");
  });

  it("6.4 break · 14 days is still a short break, 15 days is a long break", () => {
    // Last session Fri 11-27. CW4 is a zero week, so the comeback applies too.
    const d14 = makeCtx({ now: at(day(5, "fri"), "07:00"), history: history() });
    const p14 = planSession(d14, { code: "A", mode: "full" });
    expect(p14.flags).toContain("break_resume");
    expect(p14.flags).not.toContain("long_break_restart");
    expect(p14.training_week).toBe(4);

    const d15 = makeCtx({ now: at(day(5, "sat"), "07:00"), history: history() });
    const p15 = planSession(d15, { code: "A", mode: "full" });
    expect(p15.flags).toContain("long_break_restart");
    expect(p15.training_week).toBe(2);
  });

  it("6.4 break > 14 days · restart the return phase at week 2, loads × 0.85 for the first session back", () => {
    // Last session Fri CW5 (12-11). CW6 and CW7 zero. Mon CW8 = 17 days → long break, applied prospectively.
    const h = steadyWeeks(1, 5, { cardio: false });
    const ctx = makeCtx({ now: at(day(8, "mon"), "07:00"), history: h });
    const state = computeState(ctx);
    expect(state.block.training_week).toBe(2);
    expect(state.current_week.training_week).toBe(2);
    expect(state.current_week.phase).toBe("return");
    expect(nudge(state, "long_break")?.rule_id).toBe("event.break_long");
    const plan = planSession(ctx, { code: "A", mode: "full" });
    expect(plan.training_week).toBe(2);
    expect(plan.phase).toBe("return");
    expect(plan.flags).toEqual(expect.arrayContaining(["long_break_restart", "comeback"]));
    const a1 = planned(plan, "A1");
    expect(workSets(a1).length).toBe(2); // return week 2: 3 sets, comeback − 1
    expect(workSets(a1)[0]?.weight).toBe(floorTo(must(state.tracks[keyOf(a1)]?.base_weight) * 0.85, a1.increment_kg));
  });

  it("6.4 break > 14 days · later sessions progress normally and counting continues from week 2", () => {
    const h = steadyWeeks(1, 5, { cardio: false });
    const first = strength({ code: "A", date: day(8, "mon"), log: dayLog("A", 5) });
    const ctxWed = makeCtx({ now: at(day(8, "wed"), "07:00"), history: [h, first] });
    const stateWed = computeState(ctxWed);
    const planB = planSession(ctxWed, { code: "B", mode: "full" });
    expect(planB.flags).not.toContain("long_break_restart");
    expect(planB.flags).not.toContain("comeback");
    expect(planB.training_week).toBe(2);
    const b1 = planned(planB, "B1");
    expect(workSets(b1)[0]?.weight).toBe(stateWed.tracks[keyOf(b1)]?.base_weight);
    const changes = summarizeSession(ctxWed, must(first.id)).changes;
    expect(changes.length).toBeGreaterThan(0);
    for (const c of changes) expect(c.rule_id.startsWith("dp."), c.exercise_id).toBe(false);

    const second = strength({ code: "B", date: day(8, "wed"), log: dayLog("B", 5) });
    const next = computeState(makeCtx({ now: at(day(9, "mon"), "07:00"), history: [h, first, second] }));
    expect(next.weeks.map((w) => w.training_week)).toEqual([1, 2, 3, 4, 5, 6, 6, 2, 3]);
    expect(next.current_week.training_week).toBe(3);
  });

  it("6.4 never miss twice · measured in hours since the last strength session (47 h no, 49 h yes)", () => {
    const h = [strength({ code: "A", date: day(1, "mon"), time: "18:00", log: dayLog("A", 0) })];
    const last = at(day(1, "mon"), "18:50");
    expect(nudge(computeState(makeCtx({ now: plusHours(last, 47), history: h })), "never_miss_twice")).toBeUndefined();
    expect(nudge(computeState(makeCtx({ now: plusHours(last, 49), history: h })), "never_miss_twice")).toBeDefined();
  });
});
