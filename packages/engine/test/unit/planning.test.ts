import { describe, expect, test } from "vitest";
import type { SessionPlan } from "../../src/types";
import { computeState, planSession } from "../../src/index";
import { History, at, ctxOf, day, withConfig, withProgram } from "./fixtures";
import type { SetSpec } from "./fixtures";

const byPid = (plan: SessionPlan, pid: string) => plan.exercises.find((e) => e.prescription_id === pid)!;
/** Strength session with different sets per prescription. */
const per = (h: History, code: "A" | "B" | "C", date: string, m: Record<string, SetSpec[]>) =>
  h.session({ code, date, exercises: Object.entries(m).map(([pid, sets]) => ({ pid, sets })) });
const setCount = (plan: SessionPlan) => Object.fromEntries(plan.exercises.map((e) => [e.prescription_id, e.sets.filter((s) => s.kind === "work").length]));

/** One session per calendar week so week `weeks + 1` is training week weeks + 1. */
function weeksOf(weeks: number): History {
  const h = new History();
  for (let w = 0; w < weeks; w++) h.simple("C", day(w * 7), ["C1"], [[100, 10, 3]]);
  return h;
}

function expectDecisionsComplete(plan: SessionPlan) {
  for (const e of plan.exercises) {
    const d = plan.decisions.find((x) => x.id === e.decision_id);
    expect(d, `${e.exercise_id} decision`).toBeDefined();
    expect(d!.explanation).toBe(e.reason);
    expect(d!.rule_id).toBe(e.rule_id);
    expect(e.reason).not.toMatch(/ - | – | — /);
  }
}

describe("swaps", () => {
  test("session > block > limitation > default", () => {
    const h = new History();
    const now = at(day(0), "08:00");
    const lim = { limitations: ["shoulder_symmetry"] };
    expect(byPid(planSession(ctxOf(h, now, lim), { code: "C", mode: "full" }), "C3")).toMatchObject({ exercise_id: "one_arm_dumbbell_row", swapped: "limitation" });
    const block = { ...lim, block_swaps: { C3: "machine_row" } };
    expect(byPid(planSession(ctxOf(h, now, block), { code: "C", mode: "full" }), "C3")).toMatchObject({ exercise_id: "machine_row", swapped: "block" });
    const session = planSession(ctxOf(h, now, block), { code: "C", mode: "full", swaps: { C3: "seated_cable_row" } });
    expect(byPid(session, "C3")).toMatchObject({ exercise_id: "seated_cable_row", swapped: null, primary_exercise_id: "seated_cable_row" });
    expect(byPid(planSession(ctxOf(h, now), { code: "C", mode: "full" }), "C3")).toMatchObject({ exercise_id: "seated_cable_row", swapped: null });
  });

  test("main lifts are never block swapped, session swaps are fine", () => {
    const ctx = ctxOf(new History(), at(day(0), "08:00"), { block_swaps: { A1: "leg_press" } });
    expect(byPid(planSession(ctx, { code: "A", mode: "full" }), "A1").exercise_id).toBe("back_squat");
    expect(byPid(planSession(ctx, { code: "A", mode: "full", swaps: { A1: "hack_squat" } }), "A1").exercise_id).toBe("hack_squat");
  });

  test("unknown swap ids are ignored", () => {
    const plan = planSession(ctxOf(new History(), at(day(0), "08:00")), { code: "A", mode: "full", swaps: { A2: "no_such_exercise" } });
    expect(byPid(plan, "A2").exercise_id).toBe("bench_press");
  });

  test("knee friendly: avoid tags swap to a preferred alternative and mark alternatives", () => {
    const plan = planSession(ctxOf(new History(), at(day(0), "08:00"), { limitations: ["knee_friendly"] }), { code: "A", mode: "full" });
    const sq = byPid(plan, "A1");
    expect(sq).toMatchObject({ exercise_id: "hack_squat", swapped: "limitation", primary_exercise_id: "back_squat" });
    const alts = Object.fromEntries(sq.alternatives.map((a) => [a.exercise_id, a]));
    expect(alts.back_squat).toMatchObject({ allowed: false, reason: "Knee friendly: avoids deep knee flexion." });
    expect(alts.goblet_squat!.allowed).toBe(false);
    expect(alts.leg_press!.allowed).toBe(true);
    const b = planSession(ctxOf(new History(), at(day(0), "08:00"), { limitations: ["knee_friendly"] }), { code: "B", mode: "full" });
    expect(byPid(b, "B4").exercise_id).toBe("step_up");
  });

  test("alternative rep range overrides travel with the swap", () => {
    const plan = planSession(ctxOf(new History(), at(day(0), "08:00")), { code: "A", mode: "full", swaps: { A4: "back_extension" } });
    expect(byPid(plan, "A4")).toMatchObject({ rep_min: 10, rep_max: 15, bodyweight: true });
    expect(byPid(plan, "A4").alternatives.map((a) => a.exercise_id)).toEqual(["romanian_deadlift"]);
  });
});

describe("phase sets, RIR and modes", () => {
  test("week 1: 2 sets everywhere; weeks 2 to 4: 3 on starred, program sets otherwise", () => {
    const w1 = planSession(ctxOf(new History(), at(day(0), "08:00")), { code: "A", mode: "full" });
    expect(setCount(w1)).toEqual({ A1: 2, A2: 2, A3: 2, A4: 2, A5: 2, A6: 2 });
    expect(byPid(w1, "A1")).toMatchObject({ target_rir: 3, rir_range: [3, 4] });
    const w2 = planSession(ctxOf(weeksOf(1), at(day(7), "08:00")), { code: "C", mode: "full" });
    expect(setCount(w2)).toEqual({ C1: 3, C2: 3, C3: 3, C4: 3, C5: 2, C6: 2, C7: 3 });
  });

  test("build phase: main lifts 4 sets, RIR 2", () => {
    const plan = planSession(ctxOf(weeksOf(4), at(day(28), "08:00")), { code: "A", mode: "full" });
    expect(plan.phase).toBe("build");
    expect(plan.training_week).toBe(5);
    expect(setCount(plan)).toMatchObject({ A1: 4, A2: 4, A3: 3, A4: 2 });
    // No history yet: calibration keeps RIR at least calibration_min_rir; the range is the phase's.
    expect(byPid(plan, "A1")).toMatchObject({ target_rir: 3, rir_range: [2, 2], calibration: true });
    const c = planSession(ctxOf(weeksOf(4), at(day(28), "08:00")), { code: "C", mode: "full" });
    expect(byPid(c, "C1")).toMatchObject({ target_rir: 2, calibration: false });
  });

  test("deload: half the build sets (ceil), same loads, RIR from the deload phase", () => {
    const h = new History();
    per(h, "A", day(5), { A1: [[100, 8, 3], [100, 8, 3]], A2: [[80, 8, 3], [80, 8, 3]] });
    const ctx = withConfig(ctxOf(h, at(day(8), "08:00")), (c) => {
      c.deload.planned_week = 2;
    });
    const plan = planSession(ctx, { code: "A", mode: "full" });
    expect(plan.phase).toBe("deload");
    expect(plan.flags).toContain("deload");
    expect(setCount(plan)).toEqual({ A1: 2, A2: 2, A3: 2, A4: 1, A5: 1, A6: 1 });
    expect(byPid(plan, "A1").sets[0]).toMatchObject({ weight: 105, reps: 5, rir: 3 });
    expect(byPid(plan, "A1")).toMatchObject({ rule_id: "phase.deload", reason: "Deload week: half the sets, same weights, RIR 3 to 4." });
    expect(plan.adjustments[0]!.rule_id).toBe("phase.deload");
    expectDecisionsComplete(plan);
  });

  test("short version: starred only, one set less", () => {
    const plan = planSession(ctxOf(weeksOf(1), at(day(7), "08:00")), { code: "A", mode: "short" });
    expect(setCount(plan)).toEqual({ A1: 2, A2: 2, A3: 2 });
    expect(plan.est_minutes).toBe(30);
    expect(plan.decisions.find((d) => d.rule_id === "mode.short")?.explanation).toBe("★ 30 min version: starred exercises only, one set less.");
    const w1 = planSession(ctxOf(new History(), at(day(0), "08:00")), { code: "B", mode: "short" });
    expect(setCount(w1)).toEqual({ B1: 1, B2: 1, B3: 1 });
  });

  test("travel: the travel circuit with its rounds, own tracks", () => {
    const plan = planSession(ctxOf(weeksOf(4), at(day(28), "08:00")), { code: "TRAVEL", mode: "full" });
    expect(plan).toMatchObject({ code: "TRAVEL", mode: "travel", rounds: 3 });
    expect(Object.values(setCount(plan))).toEqual([3, 3, 3, 3, 3, 3]);
    expect(byPid(plan, "T6")).toMatchObject({ exercise_id: "push_up", progression_rule: "reps_only" });
    expect(plan.decisions.some((d) => d.rule_id === "mode.travel")).toBe(true);
  });

  test("measures, per hand and per side are carried through", () => {
    const plan = planSession(ctxOf(new History(), at(day(0), "08:00")), { code: "C", mode: "full" });
    expect(byPid(plan, "C7")).toMatchObject({ measure: "meters", per_hand: true, rep_min: 30, rep_max: 40 });
    expect(byPid(plan, "C2")).toMatchObject({ per_hand: true, increment_kg: 2 });
    const b = planSession(ctxOf(new History(), at(day(0), "08:00")), { code: "B", mode: "full" });
    expect(byPid(b, "B4").per_side).toBe(true);
    const a = planSession(ctxOf(new History(), at(day(0), "08:00")), { code: "A", mode: "full" });
    expect(byPid(a, "A6")).toMatchObject({ measure: "seconds", progression_rule: "reps_only" });
  });

  test("rest overrides by exercise id", () => {
    const plan = planSession(ctxOf(new History(), at(day(0), "08:00"), { rest_overrides: { bench_press: 240 } }), { code: "A", mode: "full" });
    expect(byPid(plan, "A2").rest_s).toBe(240);
    expect(byPid(plan, "A1").rest_s).toBe(180);
  });
});

describe("comeback, breaks and readiness", () => {
  test("comeback after a zero week: one set less, same weights", () => {
    const h = new History();
    h.simple("A", day(6), ["A1"], [[100, 6, 3], [100, 6, 3]]);
    // A zero week always means a gap of 8+ days, so the short break applies too (both apply).
    const both = planSession(ctxOf(h, at(day(14), "08:00")), { code: "A", mode: "full" });
    expect(both.flags).toEqual(expect.arrayContaining(["comeback", "break_resume"]));
    expect(byPid(both, "A1").sets).toHaveLength(2); // training week 2: 3 sets, minus 1
    expect(byPid(both, "A1").sets[0]!.weight).toBe(85);
    expect(both.adjustments.map((a) => a.text)).toContain("Coming back is easy on purpose: one set less, lighter weights to ease in.");
    // Without break rules the weights stay the same.
    const noBreak = withConfig(ctxOf(h, at(day(14), "08:00")), (c) => {
      c.break.short_days_min = 30;
      c.break.short_days_max = 30;
    });
    const plan = planSession(noBreak, { code: "A", mode: "full" });
    expect(plan.flags).toEqual(["comeback"]);
    expect(byPid(plan, "A1").sets.map((x) => x.weight)).toEqual([100, 100]);
    expect(plan.adjustments.map((a) => a.text)).toContain("Coming back is easy on purpose: one set less, same weights.");
  });

  test("short break: 85% loads rounded down for the window", () => {
    const h = new History();
    per(h, "A", day(0), { A1: [[100, 6, 3], [100, 6, 3]], A2: [[80, 6, 3], [80, 6, 3]] });
    const plan = planSession(ctxOf(h, at(day(9), "08:00")), { code: "A", mode: "full" });
    expect(plan.flags).toContain("break_resume");
    expect(byPid(plan, "A1").sets[0]!.weight).toBe(85);
    expect(byPid(plan, "A2").sets[0]!.weight).toBe(67.5); // 68 rounded down
    expect(byPid(plan, "A2")).toMatchObject({ rule_id: "event.break_short", reason: "Back after 9 days: weights at 85% this week." });
    expectDecisionsComplete(plan);
    // A session inside the window keeps the window going.
    h.simple("B", day(9), ["B1"], [[90, 5, 3]]);
    h.simple("C", day(12), ["C1"], [[100, 10, 3]]);
    expect(planSession(ctxOf(h, at(day(12), "08:00")), { code: "A", mode: "full" }).flags).toContain("break_resume");
    // Window was day 9..15; on day 16 the last session is 4 days back.
    expect(planSession(ctxOf(h, at(day(16), "08:00")), { code: "A", mode: "full" }).flags).not.toContain("break_resume");
  });

  test("long break: 85% loads for the first session back", () => {
    const h = new History();
    h.simple("A", day(0), ["A1"], [[100, 6, 3]]);
    const plan = planSession(ctxOf(h, at(day(20), "08:00")), { code: "A", mode: "full" });
    expect(plan.flags).toContain("long_break_restart");
    expect(byPid(plan, "A1").sets[0]!.weight).toBe(85);
    expect(byPid(plan, "A1").rule_id).toBe("event.break_long");
  });

  test("readiness: sets dropped, first exercise load cut, banner names the lowest score", () => {
    const h = new History();
    per(h, "A", day(0), { A1: [[100, 8, 3], [100, 8, 3]], A2: [[80, 8, 3], [80, 8, 3]] });
    h.checkin(day(9), 2, 2, 2, 1); // average 1.75 → −7.5%, 1 set
    const plan = planSession(ctxOf(h, at(day(9), "08:00")), { code: "A", mode: "full" });
    expect(plan.flags).toContain("readiness");
    const sq = byPid(plan, "A1");
    // base 105 (break 85% → 89.25 → 87.5), then −7.5% → 80.9 → 80
    expect(sq.sets).toHaveLength(2);
    expect(sq.sets[0]!.weight).toBe(80);
    expect(byPid(plan, "A2").sets[0]!.weight).toBe(70); // break only: 82.5 × 0.85 = 70.1 → 70
    expect(plan.adjustments.find((a) => a.rule_id === "event.readiness")!.text).toBe("Energy 1/5: Back squat −7.5%, 1 set dropped per exercise.");
  });

  test("readiness severity: average ≤ 1.5 drops 2 sets and cuts 10%, min 1 set", () => {
    const h = new History();
    h.simple("A", day(0), ["A1"], [[100, 8, 3]]);
    h.simple("B", day(1), ["B1"], [[100, 5, 3]]);
    h.checkin(day(2), 1, 2, 1, 1); // 1.25
    const plan = planSession(ctxOf(h, at(day(2), "08:00")), { code: "A", mode: "full" });
    expect(byPid(plan, "A1").sets).toHaveLength(1); // 2 − 2 floored at min 1
    expect(byPid(plan, "A1").sets[0]!.weight).toBe(92.5); // 105 × 0.9 = 94.5 → 92.5
    expect(plan.adjustments.find((a) => a.rule_id === "event.readiness")!.text).toBe("Sleep 1/5: Back squat −10%, 2 sets dropped per exercise.");
  });

  test("readiness above threshold changes nothing", () => {
    const h = new History();
    h.checkin(day(0), 3, 3, 2, 2);
    const plan = planSession(ctxOf(h, at(day(0), "09:00")), { code: "A", mode: "full" });
    expect(plan.flags).not.toContain("readiness");
  });
});

describe("top set, volume cap, last time and frozen targets", () => {
  test("consolidate top set on main lifts from the latest e1RM", () => {
    const h = new History();
    h.simple("A", day(0), ["A1"], [[100, 5, 3]]); // e1RM 126.67
    const ctx = withProgram(ctxOf(h, at(day(2), "08:00")), (p) => {
      p.phases.find((x) => x.name === "return")!.top_set = { main_lifts: true, rir: 1 };
    });
    const plan = planSession(ctx, { code: "A", mode: "full" });
    const top = byPid(plan, "A1").sets.find((s) => s.kind === "top")!;
    // 126.67 / (1 + (5 + 1) / 30) = 105.6 → 105
    expect(top).toMatchObject({ weight: 105, reps: 5, rir: 1, index: 2 });
    expect(plan.flags).toContain("consolidate_top_set");
    expect(byPid(plan, "A2").sets.some((s) => s.kind === "top")).toBe(false); // no e1RM yet
  });

  test("session volume cap trims non starred exercises first", () => {
    const ctx = withConfig(ctxOf(new History(), at(day(0), "08:00")), (c) => {
      c.volume.session_cap = 3;
    });
    const plan = planSession(ctx, { code: "A", mode: "full" });
    // glutes: squat 2 + RDL 2 = 4 > 3 → one RDL set removed
    expect(setCount(plan)).toMatchObject({ A1: 2, A4: 1 });
    expect(plan.adjustments.find((a) => a.rule_id === "volume.session_cap")!.text).toBe("Session cap: 1 set trimmed from Romanian deadlift so no muscle passes 3 sets.");
  });

  test("last time comes from the track", () => {
    const h = new History();
    const s = h.simple("A", day(0), ["A2"], [[80, 8, 3], [80, 7, 2]]);
    const plan = planSession(ctxOf(h, at(day(2))), { code: "A", mode: "full" });
    expect(byPid(plan, "A2").last_time).toEqual({ session_id: s.id, date: day(0), sets: [{ weight: 80, reps: 8, rir: 3 }, { weight: 80, reps: 7, rir: 2 }] });
    expect(byPid(plan, "A1").last_time).toBeNull();
  });

  test("resumed session: targets frozen while sets are logged", () => {
    const h = new History();
    h.simple("A", day(0), ["A1", "A2"], [[100, 6, 3], [80, 6, 3]]);
    const s = h.session({ code: "B", date: day(9), time: "18:00", ended: false, exercises: [] });
    const now = at(day(9), "18:05");
    const before = planSession(ctxOf(h, now), { code: "B", mode: "full", sessionId: s.id });
    h.setLogs.push({ ...h.setLogs[0]!, id: "x1", session_id: s.id, exercise_id: "trap_bar_deadlift", prescription_id: "B1", completed_at: at(day(9), "18:10") });
    const after = planSession(ctxOf(h, at(day(9), "18:12")), { code: "B", mode: "full", sessionId: s.id });
    expect(after.exercises).toEqual(before.exercises);
    expect(before.flags).toContain("break_resume");
  });

  test("every planned exercise carries a decision present in the plan", () => {
    const h = new History();
    h.simple("A", day(0), ["A1", "A2", "A3", "A4", "A5", "A6"], [[60, 8, 3], [60, 8, 3]]);
    for (const code of ["A", "B", "C", "TRAVEL"] as const) expectDecisionsComplete(planSession(ctxOf(h, at(day(2))), { code, mode: "full" }));
  });

  test("custom session order drives the next session", () => {
    const h = new History();
    h.simple("A", day(0), ["A1"], [[60, 8]]);
    expect(computeState(ctxOf(h, at(day(2)))).next.code).toBe("B");
    expect(computeState(ctxOf(h, at(day(2)), { session_order: ["A", "C", "B"] })).next.code).toBe("C");
  });
});
