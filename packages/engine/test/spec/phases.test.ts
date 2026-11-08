/**
 * SPEC 6.2 phases (every row) with ENGINE_RULES 2 and 3 semantics.
 *
 * Plans in training week N use a steady history for weeks 1..N−1 (A Mon, B Wed, C Fri, cardio Sat) and "now" on
 * Monday morning of calendar week N, so no modifier applies (no break, no zero week, no check-in).
 */
import { describe, expect, it } from "vitest";
import type { PhaseName, ProgramConfig } from "@gym/schema";
import { computeState, planCardio, planSession, summarizeSession } from "../../src/index";
import type { EngineContext, SessionPlan } from "../../src/index";
import {
  BASE_CONFIG,
  at,
  epley,
  day,
  fillerWeeks,
  floorTo,
  keyOf,
  makeCtx,
  must,
  planMuscleSets,
  planned,
  prescription,
  sets,
  someNumber,
  steadyWeeks,
  strength,
  topSets,
  weekId,
  workSets,
} from "./helpers";

/** Context on Monday 07:00 of calendar week `tw`, after steady weeks 1..tw−1. */
function ctxAtWeek(tw: number, extra: Partial<Parameters<typeof makeCtx>[0]> = {}): EngineContext {
  return makeCtx({ now: at(day(tw, "mon"), "07:00"), history: tw > 1 ? steadyWeeks(1, tw - 1) : [], ...extra });
}

const ids = (code: "A" | "B" | "C") => (code === "C" ? ["C1", "C2", "C3", "C4", "C5", "C6", "C7"] : [1, 2, 3, 4, 5, 6].map((i) => `${code}${i}`));

/* prettier-ignore */
const SETS: Record<string, Record<"A" | "B" | "C", number[]>> = {
  // A1 A2 main ★ · A3 ★ · A4 A5 A6 (program 2) | B same shape | C1 C2 C3 ★ · C4 (3) C5 C6 (2) C7 (3)
  return_w1:   { A: [2, 2, 2, 2, 2, 2], B: [2, 2, 2, 2, 2, 2], C: [2, 2, 2, 2, 2, 2, 2] }, // 2 per exercise, other_cap 2
  return:      { A: [3, 3, 3, 2, 2, 2], B: [3, 3, 3, 2, 2, 2], C: [3, 3, 3, 3, 2, 2, 3] }, // then 3, others program sets
  build:       { A: [4, 4, 3, 2, 2, 2], B: [4, 4, 3, 2, 2, 2], C: [3, 3, 3, 3, 2, 2, 3] }, // main lifts 4
  deload:      { A: [2, 2, 2, 1, 1, 1], B: [2, 2, 2, 1, 1, 1], C: [2, 2, 2, 2, 1, 1, 2] }, // ceil(build × 0.5), min 1
  push:        { A: [4, 4, 3, 2, 2, 2], B: [4, 4, 3, 2, 2, 2], C: [3, 3, 3, 3, 2, 2, 3] },
  consolidate: { A: [3, 3, 3, 2, 2, 2], B: [3, 3, 3, 2, 2, 2], C: [3, 3, 3, 2, 2, 2, 2] }, // other_cap 2 (+ top sets)
};

/* prettier-ignore */
const PHASE_ROWS: { label: string; tw: number; phase: PhaseName; sets: keyof typeof SETS; rir: [number, number] }[] = [
  { label: "return week 1", tw: 1, phase: "return", sets: "return_w1", rir: [3, 4] },
  { label: "return week 2", tw: 2, phase: "return", sets: "return", rir: [3, 4] },
  { label: "build week 5", tw: 5, phase: "build", sets: "build", rir: [2, 2] },
  { label: "deload week 8", tw: 8, phase: "deload", sets: "deload", rir: [3, 4] },
  { label: "push week 9", tw: 9, phase: "push", sets: "push", rir: [1, 2] },
  { label: "consolidate week 12", tw: 12, phase: "consolidate", sets: "consolidate", rir: [2, 3] },
];

describe("SPEC 6.2 · phases: sets and RIR per training week", () => {
  for (const row of PHASE_ROWS)
    for (const code of ["A", "B", "C"] as const)
      it(`6.2 ${row.label} · session ${code}: ${row.phase}, RIR ${row.rir[0]} to ${row.rir[1]}, sets per ENGINE_RULES 3`, () => {
        const plan = planSession(ctxAtWeek(row.tw), { code, mode: "full" });
        expect(plan.training_week).toBe(row.tw);
        expect(plan.phase).toBe(row.phase);
        expect(plan.exercises.map((e) => e.prescription_id)).toEqual(ids(code));
        expect(plan.exercises.map((e) => workSets(e).length)).toEqual(SETS[row.sets]![code]);
        for (const e of plan.exercises) {
          expect(e.target_rir, e.prescription_id).toBe(row.rir[0]);
          expect(e.rir_range, e.prescription_id).toEqual(row.rir);
          for (const s of workSets(e)) expect(s.rir).toBeGreaterThanOrEqual(row.rir[0]);
        }
      });
});

describe("SPEC 6.2 · calibration (week 1)", () => {
  const now = at(day(1, "mon"), "07:00");

  it("6.2 calibration · start_pct × remembered working weight, rounded nearest, first exposure at rep_max (calib.remembered)", () => {
    const ctx = makeCtx({
      now,
      settings: { remembered_weights: { back_squat: { weight: 105, reps: 5 }, bench_press: { weight: 100, reps: 5 } } },
    });
    const plan = planSession(ctx, { code: "A", mode: "full" });
    const squat = planned(plan, "A1");
    const bench = planned(plan, "A2");
    // 105 × 0.6 = 63 → 62.5; 100 × 0.6 = 60
    expect(workSets(squat).map((s) => [s.weight, s.reps, s.rir])).toEqual([[62.5, 8, 3], [62.5, 8, 3]]);
    expect(workSets(bench).map((s) => [s.weight, s.reps])).toEqual([[60, 8], [60, 8]]);
    expect(squat.rule_id).toBe("calib.remembered");
    expect(squat.decision_id).toBe("d:init:back_squat@5-8");
    expect(squat.reason.length).toBeGreaterThan(0);
    expect(bench.rule_id).toBe("calib.remembered");
  });

  it("6.2 calibration · increment_overrides change the rounding", () => {
    // 77 × 0.6 = 46.2 → 45 at 2.5, → 46.25 at 1.25
    const base = { remembered_weights: { bench_press: { weight: 77, reps: 8 } } };
    const plain = planned(planSession(makeCtx({ now, settings: base }), { code: "A", mode: "full" }), "A2");
    const fine = planned(
      planSession(makeCtx({ now, settings: { ...base, increment_overrides: { bench_press: 1.25 } } }), { code: "A", mode: "full" }),
      "A2",
    );
    expect(workSets(plain)[0]?.weight).toBe(45);
    expect(workSets(fine)[0]?.weight).toBe(46.25);
    expect(fine.increment_kg).toBe(1.25);
  });

  it("6.2 calibration · nothing known: weight null, ~8 reps clamped to the range, RIR ≥ 3 (calib.pick)", () => {
    const plan = planSession(makeCtx({ now }), { code: "B", mode: "full" });
    const trap = planned(plan, "B1"); // 4 to 6 → 6
    const ohp = planned(plan, "B2"); // 6 to 10 → 8
    for (const pe of [trap, ohp]) {
      expect(pe.rule_id).toBe("calib.pick");
      expect(pe.calibration).toBe(true);
      expect(workSets(pe).every((s) => s.weight === null && s.rir >= BASE_CONFIG.calibration.calibration_min_rir)).toBe(true);
      expect(pe.reason.length).toBeGreaterThan(0);
    }
    expect(workSets(trap).map((s) => s.reps)).toEqual([6, 6]);
    expect(workSets(ohp).map((s) => s.reps)).toEqual([8, 8]);
  });

  it("6.2 calibration · bodyweight exercise without remembered weight: weight 0 at rep_max (calib.bodyweight)", () => {
    const pull = planned(planSession(makeCtx({ now }), { code: "B", mode: "full" }), "B3");
    expect(pull.rule_id).toBe("calib.bodyweight");
    expect(workSets(pull).map((s) => [s.weight, s.reps])).toEqual([[0, 12], [0, 12]]);
  });

  it("6.2 calibration · the first logged set (about 8 reps at RIR ≥ 3) sets the e1RM and the next target", () => {
    const s = strength({ code: "A", date: day(1, "mon"), log: { chest_supported_row: sets(2, 50, 8, 3) } });
    const ctx = makeCtx({ now: at(day(1, "wed"), "07:00"), history: [s] });
    const state = computeState(ctx);
    expect(state.stats["chest_supported_row"]?.e1rm).toBeCloseTo(68.33, 1); // 50 × (1 + 11/30)
    const row = planned(planSession(ctx, { code: "A", mode: "full" }), "A3");
    expect(row.calibration).toBe(false);
    expect(row.rule_id).toBe("dp.hold_add_reps");
    expect(workSets(row).map((x) => [x.weight, x.reps])).toEqual([[50, 12], [50, 12]]);
  });

  it("6.2 calibration · no max tests: weeks 1 to 11 plan only work sets inside the rep range", () => {
    const plans: SessionPlan[] = [];
    for (const tw of [1, 5, 9]) for (const code of ["A", "B", "C"] as const) plans.push(planSession(ctxAtWeek(tw), { code, mode: "full" }));
    for (const plan of plans) {
      expect(plan.flags).not.toContain("consolidate_top_set");
      for (const pe of plan.exercises) {
        expect(topSets(pe)).toEqual([]);
        for (const s of pe.sets) {
          expect(s.reps).toBeGreaterThanOrEqual(pe.rep_min);
          expect(s.reps).toBeLessThanOrEqual(pe.rep_max);
        }
      }
    }
  });
});

describe("SPEC 6.2 · return phase", () => {
  it("6.2 return · e1RM rise capped at 10% per session; the uncapped value stays in the decision inputs", () => {
    // 80×6@3 → 104. Then 100×8@3 → 136.67 uncapped, stored 104 × 1.10 = 114.4.
    const s1 = strength({ code: "A", date: day(1, "mon"), log: { bench_press: sets(2, 80, 6, 3) } });
    const s2 = strength({ code: "A", date: day(1, "thu"), log: { bench_press: sets(2, 100, 8, 3) } });
    const state = computeState(makeCtx({ now: at(day(1, "fri"), "09:00"), history: [s1, s2] }));
    expect(state.stats["bench_press"]?.e1rm).toBeCloseTo(114.4, 1);
    expect(state.stats["bench_press"]?.history.map((p) => Math.round(p.e1rm * 100) / 100)).toEqual([104, 114.4]);
    const fromS2 = state.decisions.filter((d) => d.session_id === s2.id);
    expect(fromS2.some((d) => someNumber(d.inputs_snapshot, (n) => Math.abs(n - 136.67) < 0.05))).toBe(true);
  });

  it("6.2 return · the cap does not apply outside the return phase", () => {
    // Weeks 1-4 filler, then two build sessions: 80×6@2 → 101.33, 100×8@2 → 133.33 (no cap)
    const s1 = strength({ code: "A", date: day(5, "mon"), log: { bench_press: sets(2, 80, 6, 2) } });
    const s2 = strength({ code: "A", date: day(5, "thu"), log: { bench_press: sets(2, 100, 8, 2) } });
    const state = computeState(makeCtx({ now: at(day(5, "fri"), "09:00"), history: [fillerWeeks(1, 4), s1, s2] }));
    expect(state.stats["bench_press"]?.e1rm).toBeCloseTo(133.33, 1);
  });
});

describe("SPEC 6.2 · deload (week 8)", () => {
  it("6.2 deload · sets halved, same loads as the base target, RIR 3 to 4, flag deload", () => {
    const ctx = ctxAtWeek(8);
    const state = computeState(ctx);
    let compared = 0;
    for (const code of ["A", "B", "C"] as const) {
      const plan = planSession(ctx, { code, mode: "full" });
      expect(plan.phase).toBe("deload");
      expect(plan.flags).toContain("deload");
      for (const pe of plan.exercises) {
        const base = must(state.tracks[keyOf(pe)], `${keyOf(pe)} track`).base_weight;
        for (const s of workSets(pe)) expect(s.weight, `${pe.prescription_id} keeps its base load`).toBe(base);
        compared++;
      }
    }
    expect(compared).toBe(19); // every prescription of A, B and C has history
  });

  it("6.2 deload · cardio replaced by 30 min easy (cardio.deload)", () => {
    const c = planCardio(ctxAtWeek(8));
    expect(c.kind).toBe("easy");
    expect(c.rule_id).toBe("cardio.deload");
    expect(c.total_min).toBe(30);
    expect(c.hard_minutes).toBe(0);
    expect(c.intervals).toBeNull();
  });

  it("6.2 deload · deload sessions count fully toward floor and target", () => {
    const state = computeState(makeCtx({ now: at(day(9, "mon"), "07:00"), history: steadyWeeks(1, 8) }));
    const w8 = must(state.weeks[7]);
    expect(w8.phase).toBe("deload");
    expect([w8.strength_done, w8.cardio_done]).toEqual([3, 1]);
    expect(w8.floor_reached).toBe(true);
    expect(w8.target_reached).toBe(true);
    expect(w8.status).toBe("target");
  });

  it("6.2 deload · no progression decision comes out of a deload session (phase.deload_hold)", () => {
    // Week 8 logs k = 7: trap bar 95 × 6 and leg press × 12 hit the top of the range at RIR 3, so an eligible session
    // would raise those bases (dp.increase). As deload sessions they must leave every base where week 7 put it.
    const before = computeState(ctxAtWeek(8));
    const afterCtx = makeCtx({ now: at(day(9, "mon"), "07:00"), history: steadyWeeks(1, 8) });
    const after = computeState(afterCtx);
    for (const key of ["back_squat@5-8", "bench_press@5-8", "trap_bar_deadlift@4-6", "leg_press@10-12"]) {
      expect(after.tracks[key]?.base_weight, key).toBe(before.tracks[key]?.base_weight);
      expect(after.tracks[key]?.base_reps, key).toBe(before.tracks[key]?.base_reps);
    }
    const summary = summarizeSession(afterCtx, `s_${day(8, "mon")}_A`);
    expect(summary.changes.length).toBeGreaterThan(0);
    for (const c of summary.changes) expect(c.rule_id, c.exercise_id).toBe("phase.deload_hold");
  });
});

describe("SPEC 6.2 · consolidate (week 12)", () => {
  it("6.2 consolidate · one top set per main lift at RIR 1 for rep_min reps, weight from the latest e1RM rounded down", () => {
    const ctx = ctxAtWeek(12);
    const state = computeState(ctx);
    const plan = planSession(ctx, { code: "A", mode: "full" });
    expect(plan.phase).toBe("consolidate");
    expect(plan.flags).toContain("consolidate_top_set");
    for (const pid of ["A1", "A2"]) {
      const pe = planned(plan, pid);
      const top = topSets(pe);
      expect(top.length, pid).toBe(1);
      const latest = must(state.stats[pe.exercise_id]?.e1rm, `${pe.exercise_id} e1RM`);
      const expected = floorTo(latest / (1 + (pe.rep_min + 1) / BASE_CONFIG.e1rm.divisor), pe.increment_kg);
      expect(top[0]).toMatchObject({ kind: "top", rir: 1, reps: pe.rep_min, weight: expected });
      expect(workSets(pe).length).toBe(3);
    }
    expect(topSets(planned(plan, "A3"))).toEqual([]);
  });

  it("6.2 consolidate · the summary compares each top set with the first e1RM of the block (progress against week 1)", () => {
    const ctx = ctxAtWeek(12);
    const state = computeState(ctx);
    const plan = planSession(ctx, { code: "A", mode: "full" });
    const log: Record<string, { sets: [number, number, number][]; top: [number, number, number][] }> = {};
    const expected: Record<string, { top: number; first: number }> = {};
    // Week 1 (dayLog k = 0): back squat 60 kg × 6 @ 3, bench press 50 kg × 6 @ 3.
    const week1 = { back_squat: epley(60, 6, 3), bench_press: epley(50, 6, 3) };
    for (const pid of ["A1", "A2"]) {
      const pe = planned(plan, pid);
      const work = workSets(pe).map((x) => [must(x.weight), x.reps, x.rir] as [number, number, number]);
      const t = must(topSets(pe)[0]);
      log[pe.exercise_id] = { sets: work, top: [[must(t.weight), t.reps, t.rir]] };
      expected[pe.exercise_id] = { top: epley(must(t.weight), t.reps, t.rir), first: week1[pe.exercise_id as keyof typeof week1] };
      expect(state.stats[pe.exercise_id]?.first_e1rm, pe.exercise_id).toBeCloseTo(expected[pe.exercise_id]!.first, 2);
    }
    const session = strength({ code: "A", date: day(12, "mon"), log });
    const after = makeCtx({ now: at(day(12, "tue"), "07:00"), history: [steadyWeeks(1, 11), session] });
    const summary = summarizeSession(after, must(session.id));
    const lines = summary.changes.filter((c) => c.rule_id === "phase.top_set");
    expect(lines.map((c) => c.exercise_id).sort()).toEqual(["back_squat", "bench_press"]);
    const r2 = (x: number) => String(Math.round(x * 100) / 100);
    for (const c of lines) {
      const e = must(expected[c.exercise_id]);
      expect(c.explanation).toContain(`e1RM ${r2(e.top)} kg`);
      expect(c.explanation).toContain(`start of the block ${r2(e.first)} kg`);
      expect(e.top).toBeGreaterThan(e.first); // the steady block shows progress
    }
    // The top sets never count as double progression evidence: the work sets decide the tracks.
    expect(summary.changes.filter((c) => c.rule_id.startsWith("dp.")).length).toBe(2);
  });
});

describe("SPEC 6.2 · volume guardrail", () => {
  it("6.2 volume · session cap 11 fractional sets per muscle: sets come off non starred exercises, last in order first", () => {
    // Build week, A with RDL at 5 sets and an extra non starred leg press A7 × 4:
    // glutes = squat 4 + RDL 5 + leg press 4 = 13 > 11 → A7 loses 2 sets → glutes 11.
    const program = (p: ProgramConfig) => {
      prescription(p, "A4").sets = 5;
      const a = must(p.days.find((d) => d.code === "A"));
      a.prescriptions.push({
        ...structuredClone(prescription(p, "A5")),
        id: "A7",
        exercise_id: "leg_press",
        order: 7,
        sets: 4,
        rep_min: 10,
        rep_max: 12,
        alternatives: [],
      });
    };
    const plan = planSession(ctxAtWeek(5, { program }), { code: "A", mode: "full" });
    const muscles = planMuscleSets(plan);
    for (const m of BASE_CONFIG.volume.tracked_muscles) expect(muscles[m] ?? 0, m).toBeLessThanOrEqual(BASE_CONFIG.volume.session_cap);
    // ASSUMPTION: only exercises that load the capped muscle lose sets, the last one in order first.
    expect(workSets(planned(plan, "A7")).length).toBe(2);
    expect(workSets(planned(plan, "A4")).length).toBe(5);
    expect(workSets(planned(plan, "A1")).length).toBe(4); // main lifts untouched
    expect(workSets(planned(plan, "A2")).length).toBe(4);
    expect(plan.decisions.some((d) => d.rule_id === "volume.session_cap")).toBe(true);
  });

  it("6.2 volume · default program sessions stay under the session cap (no sets removed)", () => {
    for (const tw of [5, 9])
      for (const code of ["A", "B", "C"] as const) {
        const plan = planSession(ctxAtWeek(tw), { code, mode: "full" });
        const muscles = planMuscleSets(plan);
        for (const m of BASE_CONFIG.volume.tracked_muscles) expect(muscles[m] ?? 0).toBeLessThanOrEqual(BASE_CONFIG.volume.session_cap);
        expect(plan.decisions.some((d) => d.rule_id === "volume.session_cap")).toBe(false);
      }
  });

  it("6.2 volume · weekly fractional sets per muscle, band 8 to 10 reported only in build and push weeks", () => {
    const state = computeState(makeCtx({ now: at(day(6, "mon"), "07:00"), history: steadyWeeks(1, 5) }));
    const w5 = must(state.volume.find((v) => v.week_id === weekId(5)));
    const w1 = must(state.volume.find((v) => v.week_id === weekId(1)));
    expect(w5.band).toEqual({ min: 8, max: 10 });
    expect(w1.band).toBeNull();
    // Steady week: every exercise of A, B and C × 3 sets (derivation in helpers + library muscles).
    expect(w5.by_muscle).toMatchObject({ chest: 6, back: 10.5, shoulders: 12, biceps: 7.5, triceps: 7.5, quads: 12, hamstrings: 13.5, glutes: 15 });
  });

  it("6.2 volume · volume_low / volume_high flags only for completed weeks in band phases", () => {
    const returnOnly = computeState(makeCtx({ now: at(day(5, "mon"), "07:00"), history: steadyWeeks(1, 4) }));
    expect(returnOnly.flags.filter((f) => f.kind === "volume_low" || f.kind === "volume_high")).toEqual([]);
    const withBuild = computeState(makeCtx({ now: at(day(6, "mon"), "07:00"), history: steadyWeeks(1, 5) }));
    // week 5: chest 6, biceps 7.5, triceps 7.5 < 8 · back, shoulders, quads, hamstrings, glutes > 10
    expect(withBuild.flags.some((f) => f.kind === "volume_low")).toBe(true);
    expect(withBuild.flags.some((f) => f.kind === "volume_high")).toBe(true);
  });
});

describe("SPEC 6.2 · calendar weeks vs training weeks", () => {
  // Two filler sessions per week except CW2, which is empty (zero week). Only weeks before "now" are passed.
  const history = (lastWeek: number) => [fillerWeeks(1, 1), fillerWeeks(3, lastWeek)];

  it("6.2 calendar vs training · a zero week does not advance the phase", () => {
    const state = computeState(makeCtx({ now: at(day(4, "mon"), "07:00"), history: [fillerWeeks(1, 1), fillerWeeks(3, 3)] }));
    expect(state.weeks.map((w) => w.training_week)).toEqual([1, 2, 2, 3]);
    expect(state.weeks.map((w) => w.status)).toEqual(["floor", "zero", "floor", "in_progress"]);
    expect(state.weeks[1]?.is_zero).toBe(true);
    expect(state.block.training_week).toBe(3);
    expect(state.block.extension_weeks).toBe(1);
  });

  it("6.2 calendar vs training · the block extends by one week: calendar week 13 is training week 12", () => {
    const wk13 = computeState(makeCtx({ now: at(day(13, "mon"), "07:00"), history: history(12) }));
    expect(wk13.block.training_week).toBe(12);
    expect(wk13.block.phase).toBe("consolidate");
    expect(wk13.block.complete).toBe(false);
    expect(wk13.block.extension_weeks).toBe(1);

    const wk14 = computeState(makeCtx({ now: at(day(14, "mon"), "07:00"), history: history(13) }));
    expect(wk14.block.training_week).toBe(13);
    expect(wk14.block.complete).toBe(true);
    expect(wk14.nudges.some((n) => n.kind === "block_complete")).toBe(true);
  });
});
