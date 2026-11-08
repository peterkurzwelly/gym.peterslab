import { describe, expect, test } from "vitest";
import type { EngineContext } from "../../src/types";
import { analyze } from "../../src/analysis";
import { computeState, planSession } from "../../src/index";
import { History, at, ctxOf, day, withConfig, withProgram } from "./fixtures";
import type { SetSpec } from "./fixtures";

/** Bench press as 3 × 6 to 8 with target RIR 2 in the return phase (the SPEC 6.3 example). */
function benchCtx(h: History, now: string): EngineContext {
  return withProgram(ctxOf(h, now), (p) => {
    const a2 = p.days[0]!.prescriptions.find((x) => x.id === "A2")!;
    a2.rep_min = 6;
    a2.rep_max = 8;
    p.phases.find((x) => x.name === "return")!.rir_min = 2;
  });
}

function bench(sessions: SetSpec[][], opts: { pain?: boolean } = {}) {
  const h = new History();
  sessions.forEach((sets, i) => h.session({ code: "A", date: day(i * 2), exercises: [{ pid: "A2", sets, pain: opts.pain }] }));
  const ctx = benchCtx(h, at(day(sessions.length * 2)));
  const an = analyze(ctx);
  const track = an.rp.tracks.get("bench_press@6-8")!;
  const decision = an.rp.decisionById.get(track.last_decision_id!)!;
  return { h, ctx, an, track, decision };
}

describe("double progression: SPEC 6.3 bench press examples", () => {
  test("8, 8, 8 at RIR ≥ target → 82.5 × 6", () => {
    const { track, decision } = bench([[[80, 8, 2], [80, 8, 3], [80, 8, 2]]]);
    expect([track.base_weight, track.base_reps]).toEqual([82.5, 6]);
    expect(decision.rule_id).toBe("dp.increase");
    expect(decision.explanation).toBe("All sets hit top of range at RIR 2: +2.5 kg.");
  });

  test("10, 10, 9 in the return phase → larger jump to 85 × 6", () => {
    const { track, decision } = bench([[[80, 10, 2], [80, 10, 2], [80, 9, 2]]]);
    expect([track.base_weight, track.base_reps]).toEqual([85, 6]);
    expect(decision.rule_id).toBe("dp.large_jump");
    expect(decision.explanation).toBe("Beat range by 2+ reps in return phase: larger jump to 85 kg.");
  });

  test("8, 7, 6 → same load, aim 8", () => {
    const { track, decision } = bench([[[80, 8, 2], [80, 7, 2], [80, 6, 2]]]);
    expect([track.base_weight, track.base_reps]).toEqual([80, 8]);
    expect(decision.rule_id).toBe("dp.hold_add_reps");
    expect(decision.explanation).toBe("Within range: same load, add reps.");
  });

  test("6, 5, 4 → hold and flag below range", () => {
    const { track, decision, ctx } = bench([[[80, 6, 2], [80, 5, 2], [80, 4, 2]]]);
    expect([track.base_weight, track.base_reps]).toEqual([80, 8]);
    expect(decision.rule_id).toBe("dp.below_range");
    expect(decision.explanation).toBe("Below range: hold load, check fatigue, rest and technique.");
    expect(computeState(ctx).flags.some((f) => f.kind === "below_range" && f.exercise_id === "bench_press")).toBe(true);
  });

  test("below range two sessions running → −5% when some sets were in range", () => {
    const { track, decision } = bench([
      [[80, 6, 2], [80, 5, 2], [80, 4, 2]],
      [[80, 6, 2], [80, 5, 2], [80, 4, 2]],
    ]);
    expect([track.base_weight, track.base_reps]).toEqual([75, 6]);
    expect(decision.rule_id).toBe("dp.reset");
    expect(decision.explanation).toBe("Missed range twice: reset load −5% to 75 kg.");
    expect(track.below_range_streak).toBe(0);
  });

  test("every set below range both times → −10%, rounded down", () => {
    const { track } = bench([
      [[80, 5, 2], [80, 5, 2], [80, 4, 2]],
      [[80, 5, 2], [80, 4, 2], [80, 4, 2]],
    ]);
    expect(track.base_weight).toBe(70);
  });

  test("pain flag → no increase, swap suggested, pain shown next time", () => {
    const { track, decision, ctx } = bench([[[80, 8, 2], [80, 8, 2], [80, 8, 2]]], { pain: true });
    expect(track.base_weight).toBe(80);
    expect(decision.rule_id).toBe("dp.pain");
    expect(decision.explanation).toBe("Pain logged: no load increase, swap suggested.");
    const plan = planSession(ctx, { code: "A", mode: "full" });
    expect(plan.exercises.find((e) => e.prescription_id === "A2")!.pain_last_time).toBe(true);
  });

  test("top of range but RIR below target → same load at top reps", () => {
    const { track, decision } = bench([[[80, 8, 1], [80, 8, 2], [80, 8, 2]]]);
    expect([track.base_weight, track.base_reps, decision.rule_id]).toEqual([80, 8, "dp.hold_rir"]);
  });

  test("RIR not logged counts as meeting the target", () => {
    const { decision } = bench([[[80, 8, null], [80, 8, null], [80, 8, null]]]);
    expect(decision.rule_id).toBe("dp.increase");
  });

  test("a set at a lower weight does not count as reaching the top", () => {
    const { track, decision } = bench([[[80, 8, 2], [80, 8, 2], [75, 8, 2]]]);
    expect([track.base_weight, decision.rule_id]).toEqual([80, "dp.hold_add_reps"]);
  });

  test("large jump: average extra ≥ reps_over_for_max gives pct_max, capped by max_jump_pct", () => {
    const { track } = bench([[[80, 12, 2], [80, 12, 2], [80, 12, 2]]]);
    // +10% = 88 rounds up to 90, cap 80 × 1.10 = 88 rounded down = 87.5
    expect(track.base_weight).toBe(87.5);
  });

  test("thresholds come from engine.json", () => {
    const h = new History();
    h.session({ code: "A", date: day(0), exercises: [{ pid: "A2", sets: [[80, 12, 2], [80, 12, 2], [80, 12, 2]] }] });
    const ctx = withConfig(benchCtx(h, at(day(1))), (c) => {
      c.progression.max_jump_pct = 0.05;
    });
    expect(analyze(ctx).rp.tracks.get("bench_press@6-8")!.base_weight).toBe(82.5);
    const strict = withConfig(benchCtx(h, at(day(1))), (c) => {
      c.progression.large_jump.all_sets_min_over = 5;
    });
    expect(analyze(strict).rp.tracks.get("bench_press@6-8")!.last_rule_id).toBe("dp.increase");
  });

  test("no large jumps outside phases that allow them", () => {
    const h = new History();
    h.session({ code: "A", date: day(0), exercises: [{ pid: "A2", sets: [[80, 10, 2], [80, 10, 2], [80, 9, 2]] }] });
    const ctx = withProgram(benchCtx(h, at(day(1))), (p) => {
      p.phases.find((x) => x.name === "return")!.large_jumps = false;
    });
    const t = analyze(ctx).rp.tracks.get("bench_press@6-8")!;
    expect([t.base_weight, t.last_rule_id]).toEqual([82.5, "dp.increase"]);
  });

  test("lower body barbell steps by step_kg (5)", () => {
    const h = new History();
    h.simple("A", day(0), ["A1"], [[100, 8, 3], [100, 8, 3]]);
    expect(analyze(ctxOf(h, at(day(1)))).rp.tracks.get("back_squat@5-8")!.base_weight).toBe(105);
  });

  test("increment override rounds dumbbells to the available step", () => {
    const h = new History();
    h.simple("C", day(0), ["C2"], [[24, 12, 3], [24, 12, 3]]);
    const t = analyze(ctxOf(h, at(day(1)), { increment_overrides: { incline_dumbbell_press: 2.5 } })).rp.tracks.get("incline_dumbbell_press@8-12")!;
    // 24 + 2 = 26 rounded up to the 2.5 grid
    expect(t.base_weight).toBe(27.5);
  });
});

describe("bodyweight", () => {
  test("pull-ups at bodyweight progress by adding load", () => {
    const h = new History();
    h.simple("B", day(0), ["B3"], [[0, 12, 3], [0, 12, 3]]);
    const an = analyze(ctxOf(h, at(day(1))));
    const t = an.rp.tracks.get("pull_up@6-12")!;
    expect([t.last_rule_id, t.base_weight, t.base_reps]).toEqual(["dp.increase", 2.5, 6]);
    // No e1RM from bodyweight only sets.
    expect(an.rp.stats.has("pull_up")).toBe(false);
  });
});

describe("reps_only and none", () => {
  test("plank in seconds: top, add reps, below range", () => {
    const run = (sets: SetSpec[]) => {
      const h = new History();
      h.simple("A", day(0), ["A6"], sets);
      return analyze(ctxOf(h, at(day(1)))).rp.tracks.get("plank@30-45")!;
    };
    expect(run([[0, 45], [0, 50]]).last_rule_id).toBe("ro.top");
    const add = run([[0, 40], [0, 35]]);
    expect([add.last_rule_id, add.base_reps, add.base_weight]).toEqual(["ro.add_reps", 45, 0]);
    expect(run([[0, 20], [0, 25]]).last_rule_id).toBe("ro.below_range");
  });

  test("none tracks log only", () => {
    const h = new History();
    h.simple("C", day(0), ["C7"], [[32, 40], [32, 35]]);
    const ctx = withProgram(ctxOf(h, at(day(1))), (p) => {
      p.days[2]!.prescriptions.find((x) => x.id === "C7")!.progression_rule = "none";
    });
    const an = analyze(ctx);
    const t = an.rp.tracks.get("farmers_carry@30-40")!;
    expect([t.last_rule_id, t.base_weight, t.base_reps]).toEqual(["none.log", 32, 40]);
    expect(an.rp.decisionById.get(t.last_decision_id!)!.explanation).toBe("Log only.");
  });

  test("meters progress by double progression with load", () => {
    const h = new History();
    h.simple("C", day(0), ["C7"], [[24, 40], [24, 40]]);
    const t = analyze(ctxOf(h, at(day(1)))).rp.tracks.get("farmers_carry@30-40")!;
    expect([t.last_rule_id, t.base_weight, t.base_reps]).toEqual(["dp.increase", 26, 30]);
  });
});

describe("first exposure", () => {
  test("remembered weight × start_pct, rounded to the increment", () => {
    const h = new History();
    const plan = planSession(ctxOf(h, at(day(0), "08:00"), { remembered_weights: { bench_press: { weight: 100, reps: 5 } } }), { code: "A", mode: "full" });
    const b = plan.exercises.find((e) => e.exercise_id === "bench_press")!;
    expect(b.sets.map((s) => [s.weight, s.reps, s.rir])).toEqual([[60, 8, 3], [60, 8, 3]]);
    expect(b.rule_id).toBe("calib.remembered");
    expect(b.reason).toBe("Week 1: 60% of your remembered 100 kg × 5. It should feel light.");
    expect(b.decision_id).toBe("d:init:bench_press@5-8");
    const p2 = planSession(ctxOf(h, at(day(0), "08:00"), { remembered_weights: { bench_press: { weight: 100, reps: 5 } }, start_pct: 0.55 }), { code: "A", mode: "full" });
    expect(p2.exercises.find((e) => e.exercise_id === "bench_press")!.sets[0]!.weight).toBe(55);
  });

  test("no history: pick a weight, calibration on", () => {
    const plan = planSession(ctxOf(new History(), at(day(0), "08:00")), { code: "B", mode: "full" });
    const ohp = plan.exercises.find((e) => e.exercise_id === "overhead_press")!;
    expect(ohp.calibration).toBe(true);
    expect(ohp.sets[0]).toMatchObject({ weight: null, reps: 8, rir: 3 });
    expect(ohp.reason).toBe("No history yet: pick a weight you could lift about 8 times with 3 or more reps left.");
    const trap = plan.exercises.find((e) => e.exercise_id === "trap_bar_deadlift")!;
    expect(trap.sets[0]!.reps).toBe(6); // calibration reps clamped to the range
  });

  test("bodyweight exercises start at 0 added load", () => {
    const plan = planSession(ctxOf(new History(), at(day(0), "08:00")), { code: "B", mode: "full" });
    const pu = plan.exercises.find((e) => e.exercise_id === "pull_up")!;
    expect(pu.sets[0]).toMatchObject({ weight: 0, reps: 12 });
    expect(pu.rule_id).toBe("calib.bodyweight");
    expect(pu.bodyweight).toBe(true);
  });

  test("e1RM history from another track maps the load", () => {
    const h = new History();
    h.simple("A", day(0), ["A4"], [[60, 10, 3], [60, 10, 3]]); // e1RM 60 × (1 + 13/30) = 86
    const plan = planSession(ctxOf(h, at(day(2))), { code: "B", mode: "full", swaps: { B1: "romanian_deadlift" } });
    const rdl = plan.exercises.find((e) => e.prescription_id === "B1")!;
    expect([rdl.rep_min, rdl.rep_max]).toEqual([6, 8]);
    expect(rdl.rule_id).toBe("calib.e1rm_map");
    // 86 / (1 + (8 + 3) / 30) = 62.9 → rounded down to 62.5
    expect(rdl.sets[0]!.weight).toBe(62.5);
    expect(rdl.swapped).toBe("session");
  });
});

describe("e1RM stats and stall", () => {
  test("return phase caps the stored e1RM rise per session; uncapped kept in the decision", () => {
    const h = new History();
    h.simple("A", day(0), ["A1"], [[100, 5, 3]]);
    h.simple("A", day(2), ["A1"], [[125, 8, 3]]);
    const an = analyze(ctxOf(h, at(day(3))));
    const st = an.rp.stats.get("back_squat")!;
    expect(st.history.map((p) => p.e1rm)).toEqual([126.67, 139.34]);
    const d = an.rp.decisionById.get(an.rp.tracks.get("back_squat@5-8")!.last_decision_id!)!;
    expect(d.inputs_snapshot.e1rm_raw).toBe(170.83);
    expect(d.inputs_snapshot.e1rm).toBe(139.34);
  });

  test("stall after 3 exposures without a new best e1RM", () => {
    const h = new History();
    for (let i = 0; i < 4; i++) h.simple("A", day(i * 2), ["A2"], [[80, 5, 3]]);
    const st = computeState(ctxOf(h, at(day(8))));
    expect(st.stats.bench_press).toMatchObject({ exposures: 4, exposures_since_best: 3, stalled: true });
    expect(st.flags.find((f) => f.kind === "stall")?.text).toBe("Bench press: no e1RM gain in 3 sessions. Try a variation or a new rep range.");
    const planA = planSession(ctxOf(h, at(day(8))), { code: "A", mode: "full" });
    expect(planA.exercises.find((e) => e.exercise_id === "bench_press")!.stalled).toBe(true);
    const three = new History();
    for (let i = 0; i < 3; i++) three.simple("A", day(i * 2), ["A2"], [[80, 5, 3]]);
    expect(computeState(ctxOf(three, at(day(8)))).stats.bench_press!.stalled).toBe(false);
  });
});

describe("holds: no progression decision", () => {
  test("deload sessions keep the base (phase.deload_hold)", () => {
    const h = new History();
    const s = h.simple("A", day(0), ["A2"], [[80, 8, 3], [80, 8, 3]]);
    const ctx = withConfig(ctxOf(h, at(day(1))), (c) => {
      c.deload.planned_week = 1;
    });
    const an = analyze(ctx);
    expect(an.rp.tracks.get("bench_press@5-8")!.exposures).toBe(0);
    expect(an.rp.decisionById.has(`d:${s.id}:bench_press@5-8`)).toBe(false);
    expect(an.rp.decisionById.get(`d:event:phase.deload_hold:${s.id}`)?.rule_id).toBe("phase.deload_hold");
  });

  test("first strength session after a zero week (event.comeback_hold)", () => {
    const h = new History();
    h.simple("A", day(0), ["A2"], [[80, 8, 3], [80, 8, 3]]);
    const back = h.simple("B", day(15), ["B2"], [[40, 10, 3], [40, 10, 3]]);
    h.simple("C", day(17), ["C2"], [[20, 12, 3], [20, 12, 3]]);
    const an = analyze(ctxOf(h, at(day(18))));
    expect(an.rp.infos.get(back.id)!.comeback).toBe(true);
    expect(an.rp.tracks.get("overhead_press@6-10")!.exposures).toBe(0);
    expect(an.rp.decisionById.has(`d:event:event.comeback_hold:${back.id}`)).toBe(true);
    expect(an.rp.tracks.get("incline_dumbbell_press@8-12")!.exposures).toBe(1);
  });

  test("short break: every session in the window holds (event.break_hold)", () => {
    const h = new History();
    h.simple("A", day(0), ["A2"], [[80, 8, 3], [80, 8, 3]]);
    const first = h.simple("B", day(9), ["B2"], [[40, 10, 3]]);
    const second = h.simple("C", day(12), ["C2"], [[20, 12, 3]]);
    const after = h.simple("A", day(16), ["A2"], [[82.5, 8, 3], [82.5, 8, 3]]);
    const an = analyze(ctxOf(h, at(day(17))));
    expect(an.rp.infos.get(first.id)!.breakResume).toBe(true);
    expect(an.rp.infos.get(second.id)!.breakResume).toBe(true);
    expect(an.rp.infos.get(after.id)!.breakResume).toBe(false);
    expect(an.rp.decisionById.get(`d:event:event.break_short:${first.id}`)!.explanation).toBe("Back after 9 days: 85% loads for 7 days.");
    expect(an.rp.tracks.get("bench_press@5-8")!.exposures).toBe(2);
  });

  test("long break: the first session back holds, later ones progress", () => {
    const h = new History();
    h.simple("A", day(0), ["A2"], [[80, 8, 3], [80, 8, 3]]);
    const back = h.simple("A", day(20), ["A2"], [[80, 8, 3], [80, 8, 3]]);
    h.simple("A", day(22), ["A2"], [[80, 8, 3], [80, 8, 3]]);
    const an = analyze(ctxOf(h, at(day(23))));
    expect(an.rp.infos.get(back.id)!.longBreakFirst).toBe(true);
    expect(an.rp.decisionById.has(`d:${back.id}:bench_press@5-8`)).toBe(false);
    expect(an.rp.tracks.get("bench_press@5-8")!.exposures).toBe(2);
  });

  test("readiness: only the exercises whose load was cut hold", () => {
    const h = new History();
    h.simple("A", day(0), ["A1", "A2"], [[100, 8, 3], [100, 8, 3]]);
    h.checkin(day(2), 2, 2, 2, 1);
    // The hold comes from the session's own readiness flag (ENGINE_RULES 4.7 rule change), written when it started.
    const s = h.simple("A", day(2), ["A1", "A2"], [[95, 8, 3], [95, 8, 3]], { flags: ["readiness"] });
    const an = analyze(ctxOf(h, at(day(3))));
    expect([...an.rp.infos.get(s.id)!.readinessCut]).toEqual(["back_squat"]);
    expect(an.rp.tracks.get("back_squat@5-8")!.exposures).toBe(1);
    expect(an.rp.tracks.get("bench_press@5-8")!.exposures).toBe(2);
    expect(an.rp.decisionById.has(`d:event:event.readiness_hold:${s.id}`)).toBe(true);
  });

  test("readiness: a check-in saved after the session never turns it into a hold", () => {
    const h = new History();
    h.simple("A", day(0), ["A1", "A2"], [[100, 8, 3], [100, 8, 3]]);
    // Session logged at 18:00 without a readiness flag; a low check-in for the same day is saved afterwards.
    const s = h.simple("A", day(2), ["A1", "A2"], [[100, 8, 3], [100, 8, 3]]);
    h.checkin(day(2), 1, 1, 1, 1).updated_at = at(day(2), "21:00");
    const an = analyze(ctxOf(h, at(day(3))));
    expect(an.rp.infos.get(s.id)!.readinessCut.size).toBe(0);
    expect(an.rp.tracks.get("back_squat@5-8")!.exposures).toBe(2);
    expect(an.rp.decisionById.has(`d:event:event.readiness_hold:${s.id}`)).toBe(false);
  });

  test("readiness: plan flags written into the session drive the hold, check-in or not", () => {
    const h = new History();
    h.simple("A", day(0), ["A1", "A2"], [[100, 8, 3], [100, 8, 3]]);
    h.checkin(day(2), 2, 2, 2, 1);
    const plan = planSession(ctxOf(h, at(day(2), "17:55")), { code: "A", mode: "full" });
    expect(plan.flags).toContain("readiness");
    const s = h.simple("A", day(2), ["A1", "A2"], [[95, 8, 3], [100, 8, 3]], { flags: plan.flags });
    h.checkins = []; // even if the check-in is deleted later, the session keeps its record
    const an = analyze(ctxOf(h, at(day(3))));
    expect([...an.rp.infos.get(s.id)!.readinessCut]).toEqual(["back_squat"]);
  });

  test("comeback: a cardio session between the zero week and the first strength session does not cancel it", () => {
    const h = new History();
    h.simple("A", day(0), ["A2"], [[80, 8, 3], [80, 8, 3]]);
    // Week 2 (days 7..13) empty: zero. Cardio on day 14 (Mon week 3), strength B on day 15.
    const cardio = h.cardio(day(14));
    const back = h.simple("B", day(15), ["B2"], [[40, 10, 3], [40, 10, 3]]);
    const an = analyze(ctxOf(h, at(day(16))));
    expect(an.rp.infos.get(cardio.id)!.comeback).toBe(false);
    expect(an.rp.infos.get(back.id)!.comeback).toBe(true);
    expect(an.rp.decisionById.has(`d:event:event.comeback_hold:${back.id}`)).toBe(true);
    expect(an.rp.lastStrengthOrTravel?.id).toBe(back.id);
  });

  test("comeback: a travel session ends it like a strength session", () => {
    const h = new History();
    h.simple("A", day(0), ["A2"], [[80, 8, 3], [80, 8, 3]]);
    const travel = h.simple("TRAVEL", day(15), ["T1"], [[20, 12, 3]]);
    const after = h.simple("B", day(17), ["B2"], [[40, 10, 3]]);
    const an = analyze(ctxOf(h, at(day(18))));
    expect(an.rp.infos.get(travel.id)!.comeback).toBe(true);
    expect(an.rp.infos.get(after.id)!.comeback).toBe(false);
  });

  test("comeback.overrides_short_break: the comeback starts no break window, later sessions progress", () => {
    const h = new History();
    h.simple("A", day(4), ["A2"], [[80, 8, 3], [80, 8, 3]]); // Fri week 1
    // Week 2 empty (zero). Mon week 3 (day 14) = 10 days: short break range and a comeback.
    const back = h.simple("A", day(14), ["A2"], [[80, 8, 3]]);
    const next = h.simple("A", day(16), ["A2"], [[80, 8, 3], [80, 8, 3]]);
    const an = analyze(ctxOf(h, at(day(17))));
    expect(an.rp.infos.get(back.id)).toMatchObject({ comeback: true, breakResume: false, holdRule: "event.comeback_hold" });
    expect(an.rp.infos.get(next.id)).toMatchObject({ comeback: false, breakResume: false, holdRule: null });
    expect(an.rp.decisionById.has(`d:event:event.break_short:${back.id}`)).toBe(false);
    expect(an.rp.breakWindowEnd).toBeNull();
    expect(an.rp.tracks.get("bench_press@5-8")!.exposures).toBe(2);

    // Override off: the old behavior, the window runs from the comeback and the next session holds too.
    const off = analyze(
      withConfig(ctxOf(h, at(day(17))), (c) => {
        c.comeback.overrides_short_break = false;
      }),
    );
    expect(off.rp.infos.get(back.id)).toMatchObject({ comeback: true, breakResume: true });
    expect(off.rp.infos.get(next.id)).toMatchObject({ breakResume: true, holdRule: "event.break_hold" });
    expect(off.rp.tracks.get("bench_press@5-8")!.exposures).toBe(1);
  });

  test("comeback after a long break: the long break still applies on top", () => {
    const h = new History();
    h.simple("A", day(0), ["A2"], [[80, 8, 3], [80, 8, 3]]);
    const back = h.simple("A", day(21), ["A2"], [[80, 8, 3]]); // 21 days, weeks 2 and 3 zero
    const an = analyze(ctxOf(h, at(day(22))));
    expect(an.rp.infos.get(back.id)).toMatchObject({ comeback: true, longBreakFirst: true, holdRule: "event.comeback_hold" });
    // Planned that morning (the 18:00 session is not in history yet): fewer sets and 85% loads.
    const plan = planSession(ctxOf(h, at(day(21), "08:00")), { code: "A", mode: "full" });
    expect(plan.flags).toEqual(expect.arrayContaining(["comeback", "long_break_restart"]));
  });

  test("unfinished sessions never feed progression", () => {
    const h = new History();
    h.session({ code: "A", date: day(0), ended: false, exercises: [{ pid: "A2", sets: [[80, 8, 3]] }] });
    const an = analyze(ctxOf(h, at(day(0), "18:30")));
    expect(an.rp.tracks.size).toBe(0);
  });
});

describe("reactive deload", () => {
  test("three low check-ins in a row pull the deload forward and cancel week 8", () => {
    const h = new History();
    h.simple("A", day(0), ["A2"], [[80, 6, 3]]);
    h.checkin(day(7), 2);
    h.checkin(day(8), 2);
    h.checkin(day(9), 2);
    const s = h.simple("B", day(9), ["B2"], [[40, 8, 3]]);
    const st = computeState(ctxOf(h, at(day(15))));
    expect(st.block).toMatchObject({ training_week: 3, phase: "deload", deload_week: 3, reactive_deload_used: true });
    expect(st.current_week.reactive_deload).toBe(true);
    expect(st.flags.some((f) => f.kind === "reactive_deload")).toBe(true);
    expect(st.decisions.find((d) => d.id === `d:event:event.reactive_deload:${s.id}`)?.output).toMatchObject({ deload_week: 3, cancelled_week: 8 });
    const an = analyze(ctxOf(h, at(day(15))));
    expect([...an.rp.deloadWeeks]).toEqual([3]);
  });

  test("e1RM down ≥ 5% on two main lifts across two sessions", () => {
    const h = new History();
    h.simple("A", day(0), ["A1", "A2"], [[100, 6, 3], [100, 6, 3]]);
    h.simple("A", day(2), ["A1", "A2"], [[100, 6, 3], [100, 6, 3]]);
    h.simple("A", day(4), ["A1", "A2"], [[90, 6, 3], [90, 6, 3]]);
    expect(analyze(ctxOf(h, at(day(8)))).rp.reactiveWeeks).toEqual([2]);
  });

  test("below range twice running on two exercises", () => {
    const h = new History();
    h.simple("A", day(0), ["A1", "A2"], [[100, 3, 3], [100, 3, 3]]);
    h.simple("A", day(2), ["A1", "A2"], [[100, 3, 3], [100, 3, 3]]);
    expect(analyze(ctxOf(h, at(day(8)))).rp.reactiveWeeks).toEqual([2]);
  });

  test("when the next week is already at or past the planned deload: flag only", () => {
    const h = new History();
    h.simple("A", day(0), ["A2"], [[80, 6, 3]]);
    for (const d of [7, 8, 9]) h.checkin(day(d), 1);
    h.simple("B", day(9), ["B2"], [[40, 8, 3]]);
    const ctx = withConfig(ctxOf(h, at(day(15))), (c) => {
      c.deload.planned_week = 3;
    });
    const st = computeState(ctx);
    expect(st.block.reactive_deload_used).toBe(false);
    expect(st.block.deload_week).toBe(3);
    expect(st.flags.some((f) => f.kind === "deload_criteria_met")).toBe(true);
  });

  test("max_per_block = 0 disables it", () => {
    const h = new History();
    for (const d of [0, 2]) h.simple("A", day(d), ["A1", "A2"], [[100, 3, 3], [100, 3, 3]]);
    const ctx = withConfig(ctxOf(h, at(day(8))), (c) => {
      c.reactive_deload.max_per_block = 0;
    });
    expect(analyze(ctx).rp.reactiveWeeks).toEqual([]);
  });
});

describe("determinism", () => {
  test("same input, same decisions and ids", () => {
    const h = new History();
    h.simple("A", day(0), ["A1", "A2", "A3"], [[80, 8, 3], [80, 8, 3]]);
    h.simple("B", day(2), ["B1", "B2"], [[100, 6, 3], [40, 10, 3]]);
    const a = analyze(ctxOf(h, at(day(3)))).rp.decisions;
    const b = analyze(ctxOf(h, at(day(3)))).rp.decisions;
    expect(a).toEqual(b);
    expect(a.map((d) => d.id)).toContain(`d:${h.sessions[0]!.id}:back_squat@5-8`);
  });
});
