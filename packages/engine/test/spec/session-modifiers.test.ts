/**
 * SPEC 6.4 events, session level rows: daily readiness, 30 minute mode, travel, substitution, interference guard
 * (spacing warnings). ENGINE_RULES 4 and 6.
 */
import { describe, expect, it } from "vitest";
import { computeState, planCardio, planSession, spacingWarnings, summarizeSession } from "../../src/index";
import type { EngineContext } from "../../src/index";
import {
  GUILT_WORDS,
  at,
  checkin,
  day,
  dayLog,
  fillerWeeks,
  floorTo,
  intervals,
  easyCardio,
  keyOf,
  makeCtx,
  must,
  planned,
  sets,
  steadyWeeks,
  strength,
  workSets,
} from "./helpers";

// ---------------------------------------------------------------- readiness

describe("SPEC 6.4 · daily readiness", () => {
  /** Build week 5 (steady weeks 1-4), check-in on Monday CW5, now Monday 08:00. */
  function readinessCtx(scores: readonly [number, number, number, number]): EngineContext {
    return makeCtx({ now: at(day(5, "mon"), "08:00"), history: [steadyWeeks(1, 4), checkin(day(5, "mon"), scores)] });
  }
  const BUILD_A = [4, 4, 3, 2, 2, 2];

  it("6.4 readiness · average 1.75 (sleep 1): 1 set dropped per exercise, first exercise −7.5% rounded down, session kept", () => {
    const ctx = readinessCtx([1, 2, 2, 2]);
    const state = computeState(ctx);
    expect(state.readiness).toMatchObject({
      date: day(5, "mon"),
      average: 1.75,
      lowest: { metric: "sleep", value: 1 },
      adjusted: true,
      sets_drop: 1,
      cardio_swap: true,
    });
    // 0.05 + (2.25 − 1.75) / (2.25 − 1.0) × 0.05 = 0.07 → nearest 0.025 = 0.075
    expect(state.readiness?.load_cut_pct).toBeCloseTo(0.075, 6);

    const plan = planSession(ctx, { code: "A", mode: "full" });
    expect(plan.flags).toContain("readiness");
    expect(plan.exercises.map((e) => workSets(e).length)).toEqual(BUILD_A.map((n) => Math.max(1, n - 1)));
    const a1 = planned(plan, "A1");
    const a2 = planned(plan, "A2");
    const squatBase = must(state.tracks[keyOf(a1)]?.base_weight);
    expect(workSets(a1).map((s) => s.weight)).toEqual([0, 0, 0].map(() => floorTo(squatBase * (1 - 0.075), a1.increment_kg)));
    expect(workSets(a2).every((s) => s.weight === state.tracks[keyOf(a2)]?.base_weight)).toBe(true); // only the first exercise

    const banner = must(plan.adjustments.find((a) => a.rule_id === "event.readiness"));
    expect(banner.text).toMatch(/^Sleep 1\/5/);
    expect(banner.text).not.toMatch(GUILT_WORDS);
    expect(state.readiness?.banner).toMatch(/Sleep 1\/5/);
    expect(plan.decisions.some((d) => d.id === `d:plan:${day(5, "mon")}:A:event.readiness`)).toBe(true);

    // session kept: the next session is still A, with exercises
    expect(state.next.code).toBe("A");
    expect(state.next.plan.exercises.length).toBe(6);
    expect(state.next.plan.flags).toContain("readiness");
  });

  it("6.4 readiness · never diagnostic wording: banners name the score, not a condition", () => {
    const DIAGNOSTIC = /\b(sick|ill|illness|injur\w*|overtrain\w*|overreach\w*|symptom\w*|diagnos\w*|disease|burn ?out)\b/i;
    for (const scores of [[1, 2, 2, 2], [2, 2, 3, 2], [1, 1, 1, 2], [2, 1, 2, 2], [2, 2, 1, 2], [2, 2, 2, 1]] as const) {
      const ctx = readinessCtx(scores);
      const state = computeState(ctx);
      const texts = [
        must(state.readiness?.banner),
        planCardio(ctx).reason,
        ...planSession(ctx, { code: "A", mode: "full" }).adjustments.map((a) => a.text),
        ...state.nudges.map((n) => n.text),
      ];
      for (const t of texts) {
        expect(t, scores.join(",")).not.toMatch(DIAGNOSTIC);
        expect(t, scores.join(",")).not.toMatch(GUILT_WORDS);
      }
      expect(state.readiness?.banner).toMatch(/^(Sleep|Soreness|Stress|Energy) \d\/5/);
    }
  });

  it("6.4 readiness · intervals swapped for 30 min easy cardio (cardio.readiness_swap)", () => {
    const c = planCardio(readinessCtx([1, 2, 2, 2]));
    expect([c.kind, c.rule_id, c.total_min, c.hard_minutes]).toEqual(["easy", "cardio.readiness_swap", 30, 0]);
    expect(planCardio(readinessCtx([4, 4, 4, 4])).kind).toBe("intervals");
  });

  it("6.4 readiness · at the threshold (2.25): drop 1 set, cut 5%", () => {
    const ctx = readinessCtx([2, 2, 3, 2]);
    const state = computeState(ctx);
    expect(state.readiness).toMatchObject({ average: 2.25, adjusted: true, sets_drop: 1 });
    expect(state.readiness?.load_cut_pct).toBeCloseTo(0.05, 6);
    const a1 = planned(planSession(ctx, { code: "A", mode: "full" }), "A1");
    expect(workSets(a1)[0]?.weight).toBe(floorTo(must(state.tracks[keyOf(a1)]?.base_weight) * 0.95, a1.increment_kg));
  });

  it("6.4 readiness · average 1.25: the more severe set drop wins (2 sets), cut 0.09 → 10%, never below 1 set", () => {
    const ctx = readinessCtx([1, 1, 1, 2]);
    const state = computeState(ctx);
    expect(state.readiness).toMatchObject({ average: 1.25, adjusted: true, sets_drop: 2 });
    expect(state.readiness?.load_cut_pct).toBeCloseTo(0.1, 6);
    const plan = planSession(ctx, { code: "A", mode: "full" });
    expect(plan.exercises.map((e) => workSets(e).length)).toEqual([2, 2, 1, 1, 1, 1]);
  });

  it("6.4 readiness · average above the threshold changes nothing", () => {
    const ctx = readinessCtx([2, 3, 2, 3]); // 2.5
    const state = computeState(ctx);
    expect(state.readiness?.adjusted).toBe(false);
    expect(state.readiness?.banner ?? null).toBeNull();
    const plan = planSession(ctx, { code: "A", mode: "full" });
    expect(plan.flags).not.toContain("readiness");
    expect(plan.exercises.map((e) => workSets(e).length)).toEqual(BUILD_A);
  });

  it("6.4 readiness · only today's check-in counts", () => {
    const ctx = makeCtx({ now: at(day(5, "tue"), "08:00"), history: [steadyWeeks(1, 4), checkin(day(5, "mon"), [1, 1, 1, 1])] });
    expect(planSession(ctx, { code: "A", mode: "full" }).flags).not.toContain("readiness");
  });

  it("6.4 readiness · the cut exercise yields no progression decision, the others progress (event.readiness_hold)", () => {
    // Squat (cut) and bench both hit the top of the range at RIR ≥ 2 on a readiness day.
    const s = strength({
      code: "A",
      date: day(5, "mon"),
      flags: ["readiness"],
      log: { back_squat: sets(3, 100, 8, 3), bench_press: sets(3, 70, 8, 2) },
    });
    const ctx = makeCtx({ now: at(day(5, "tue"), "08:00"), history: [steadyWeeks(1, 4), checkin(day(5, "mon"), [1, 2, 2, 2]), s] });
    const changes = summarizeSession(ctx, must(s.id)).changes;
    expect(changes.find((c) => c.exercise_id === "back_squat")?.rule_id).toBe("event.readiness_hold");
    const benchChange = must(changes.find((c) => c.exercise_id === "bench_press"));
    expect(benchChange.rule_id).toBe("dp.increase");
    expect(benchChange.to).toEqual({ weight: 72.5, reps: 5 });
  });

  it("6.4 readiness · a check-in saved after the session does not make it a readiness hold (ENGINE_RULES 4.7)", () => {
    // The session was started without a check-in, so it carries no readiness flag. A low check-in saved that evening
    // must not rewrite what happened: squat and bench both progress.
    const s = strength({ code: "A", date: day(5, "mon"), time: "07:00", log: { back_squat: sets(3, 100, 8, 3), bench_press: sets(3, 70, 8, 2) } });
    const late = checkin(day(5, "mon"), [1, 2, 2, 2]);
    late.checkins![0]!.updated_at = at(day(5, "mon"), "21:00");
    const ctx = makeCtx({ now: at(day(5, "tue"), "08:00"), history: [steadyWeeks(1, 4), late, s] });
    const changes = summarizeSession(ctx, must(s.id)).changes;
    expect(changes.map((c) => c.rule_id).sort()).toEqual(["dp.increase", "dp.increase"]);
    expect(changes.some((c) => c.rule_id === "event.readiness_hold")).toBe(false);
  });

  it("6.4 readiness · the plan's readiness flag, stored on the session at start, is what makes the hold", () => {
    const ctx = readinessCtx([1, 2, 2, 2]);
    const plan = planSession(ctx, { code: "A", mode: "full" });
    expect(plan.flags).toContain("readiness");
    const cardio = planSession(ctx, { code: "CARDIO", mode: "full" });
    expect(cardio.flags).toContain("readiness");
    // Started from that plan: flags copied into the session.
    const s = strength({ code: "A", date: day(5, "mon"), flags: plan.flags, log: { back_squat: sets(2, 90, 8, 3), bench_press: sets(2, 70, 8, 2) } });
    const after = makeCtx({ now: at(day(5, "tue"), "08:00"), history: [steadyWeeks(1, 4), s] }); // no check-in in history
    const changes = summarizeSession(after, must(s.id)).changes;
    expect(changes.find((c) => c.exercise_id === "back_squat")?.rule_id).toBe("event.readiness_hold");
    expect(changes.find((c) => c.exercise_id === "bench_press")?.rule_id.startsWith("dp.")).toBe(true);
  });
});

// ---------------------------------------------------------------- 30 minute mode and travel

describe("SPEC 6.4 · 30 minute mode", () => {
  it("6.4 30 min · only starred exercises, one set fewer (mode.short)", () => {
    const ctx = makeCtx({ now: at(day(2, "mon"), "07:00"), history: steadyWeeks(1, 1) });
    const plan = planSession(ctx, { code: "A", mode: "short" });
    expect(plan.mode).toBe("short");
    expect(plan.exercises.map((e) => e.prescription_id)).toEqual(["A1", "A2", "A3"]);
    expect(plan.exercises.every((e) => e.starred)).toBe(true);
    expect(plan.exercises.map((e) => workSets(e).length)).toEqual([2, 2, 2]); // return week 2: 3 − 1
    const c = planSession(ctx, { code: "C", mode: "short" });
    expect(c.exercises.map((e) => e.prescription_id)).toEqual(["C1", "C2", "C3"]);
  });

  it("6.4 30 min · never below min_sets (week 1: 2 − 1 = 1)", () => {
    const plan = planSession(makeCtx({ now: at(day(1, "mon"), "07:00") }), { code: "B", mode: "short" });
    expect(plan.exercises.map((e) => workSets(e).length)).toEqual([1, 1, 1]);
  });

  it("6.4 30 min · progression still applies to the logged sets", () => {
    // Build week 5, short A: bench 80 × 8, 8 @ 2 (range 5 to 8) → dp.increase → 82.5 × 5
    const s = strength({
      code: "A",
      date: day(5, "mon"),
      mode: "short",
      log: { back_squat: sets(2, 80, 6, 2), bench_press: sets(2, 80, 8, 2), chest_supported_row: sets(2, 50, 10, 2) },
    });
    const ctx = makeCtx({ now: at(day(5, "tue"), "07:00"), history: [fillerWeeks(1, 4), s] });
    const change = must(summarizeSession(ctx, must(s.id)).changes.find((c) => c.exercise_id === "bench_press"));
    expect(change.rule_id).toBe("dp.increase");
    expect(change.to).toEqual({ weight: 82.5, reps: 5 });
    const a2 = planned(planSession(ctx, { code: "A", mode: "full" }), "A2");
    expect(workSets(a2).map((x) => [x.weight, x.reps])).toEqual([[82.5, 5], [82.5, 5], [82.5, 5], [82.5, 5]]);
    expect(computeState(ctx).current_week.strength_done).toBe(1); // short counts toward the floor
  });
});

describe("SPEC 5 · travel version", () => {
  it("travel · dumbbell circuit, 3 rounds, program sets regardless of phase", () => {
    const plan = planSession(makeCtx({ now: at(day(1, "mon"), "07:00") }), { code: "TRAVEL", mode: "travel" });
    expect(plan.code).toBe("TRAVEL");
    expect(plan.mode).toBe("travel");
    expect(plan.rounds).toBe(3);
    expect(plan.exercises.map((e) => e.prescription_id)).toEqual(["T1", "T2", "T3", "T4", "T5", "T6"]);
    expect(plan.exercises.map((e) => workSets(e).length)).toEqual([3, 3, 3, 3, 3, 3]); // week 1 would be 2 for A, B, C
  });
});

// ---------------------------------------------------------------- substitution

describe("SPEC 6.4 · substitution", () => {
  const now = at(day(1, "mon"), "07:00");

  it("6.4 substitution · knee_friendly: back squat → hack squat (swap.limitation); avoided alternatives not allowed", () => {
    const plan = planSession(makeCtx({ now, settings: { limitations: ["knee_friendly"] } }), { code: "A", mode: "full" });
    const a1 = planned(plan, "A1");
    expect(a1.exercise_id).toBe("hack_squat");
    expect(a1.primary_exercise_id).toBe("back_squat");
    expect(a1.swapped).toBe("limitation");
    expect(a1.main_lift).toBe(true);
    const goblet = must(a1.alternatives.find((a) => a.exercise_id === "goblet_squat"));
    expect(goblet.allowed).toBe(false);
    expect(goblet.reason?.length ?? 0).toBeGreaterThan(0);
    expect(a1.alternatives.find((a) => a.exercise_id === "leg_press")?.allowed).toBe(true);
    expect(planned(plan, "A2").swapped).toBeNull();
  });

  it("6.4 substitution · shoulder_symmetry prefers unilateral rows: seated cable row → one-arm dumbbell row", () => {
    const ctx = makeCtx({ now, settings: { limitations: ["shoulder_symmetry"] } });
    const c3 = planned(planSession(ctx, { code: "C", mode: "full" }), "C3");
    expect([c3.exercise_id, c3.swapped]).toEqual(["one_arm_dumbbell_row", "limitation"]);
    const a3 = planned(planSession(ctx, { code: "A", mode: "full" }), "A3"); // no unilateral alternative → unchanged
    expect([a3.exercise_id, a3.swapped]).toEqual(["chest_supported_row", null]);
  });

  it("6.4 substitution · the planned exercise names its program default (primary_name), swapped or not", () => {
    const ctx = makeCtx({ now, settings: { limitations: ["knee_friendly"] } });
    const a = planSession(ctx, { code: "A", mode: "full", swaps: { A2: "dumbbell_bench_press" } });
    expect(planned(a, "A1")).toMatchObject({ name: "Hack squat", primary_exercise_id: "back_squat", primary_name: "Back squat" });
    expect(planned(a, "A2")).toMatchObject({ name: "Dumbbell bench press", primary_name: "Bench press", swapped: "session" });
    expect(planned(a, "A3")).toMatchObject({ name: "Chest supported row", primary_name: "Chest supported row", swapped: null });
  });

  it("6.4 substitution · per_side follows the alternative when it says so (one-arm row, suitcase carry), else the prescription", () => {
    const c = (swaps: Record<string, string>) => planSession(makeCtx({ now }), { code: "C", mode: "full", swaps });
    expect([planned(c({}), "C3").per_side, planned(c({ C3: "one_arm_dumbbell_row" }), "C3").per_side, planned(c({ C3: "machine_row" }), "C3").per_side]).toEqual([false, true, false]);
    expect([planned(c({}), "C7").per_side, planned(c({ C7: "suitcase_carry" }), "C7").per_side]).toEqual([false, true]);
    // The shoulder_symmetry limitation swap to the one-arm row is per side too.
    const lim = planned(planSession(makeCtx({ now, settings: { limitations: ["shoulder_symmetry"] } }), { code: "C", mode: "full" }), "C3");
    expect([lim.exercise_id, lim.per_side]).toEqual(["one_arm_dumbbell_row", true]);
    // B4 Bulgarian split squat is per side; walking lunge has no override and inherits it.
    expect(planned(planSession(makeCtx({ now }), { code: "B", mode: "full", swaps: { B4: "walking_lunge" } }), "B4").per_side).toBe(true);
  });

  it("6.4 substitution · no limitations: program defaults, every alternative allowed", () => {
    const plan = planSession(makeCtx({ now }), { code: "A", mode: "full" });
    expect(plan.exercises.every((e) => e.swapped === null && e.exercise_id === e.primary_exercise_id)).toBe(true);
    expect(plan.exercises.every((e) => e.alternatives.every((a) => a.allowed))).toBe(true);
  });

  it("6.4 substitution · alternatives carry their own rep range when the program overrides it", () => {
    const a4 = planned(planSession(makeCtx({ now }), { code: "A", mode: "full" }), "A4");
    expect(a4.alternatives.find((a) => a.exercise_id === "back_extension")).toMatchObject({ rep_min: 10, rep_max: 15 });
    const b1 = planned(planSession(makeCtx({ now }), { code: "B", mode: "full" }), "B1");
    expect(b1.alternatives.find((a) => a.exercise_id === "romanian_deadlift")).toMatchObject({ rep_min: 6, rep_max: 8 });
    expect(b1.alternatives.find((a) => a.exercise_id === "conventional_deadlift")).toMatchObject({ rep_min: 4, rep_max: 6 });
  });

  it("6.4 substitution · precedence: session swap > block swap > limitation; main lifts are never block swapped", () => {
    const ctx = makeCtx({ now, settings: { limitations: ["knee_friendly"], block_swaps: { A1: "goblet_squat", A3: "seated_cable_row" } } });
    const plain = planSession(ctx, { code: "A", mode: "full" });
    expect([planned(plain, "A1").exercise_id, planned(plain, "A1").swapped]).toEqual(["hack_squat", "limitation"]);
    expect([planned(plain, "A3").exercise_id, planned(plain, "A3").swapped]).toEqual(["seated_cable_row", "block"]);
    const session = planSession(ctx, { code: "A", mode: "full", swaps: { A1: "leg_press" } });
    expect([planned(session, "A1").exercise_id, planned(session, "A1").swapped]).toEqual(["leg_press", "session"]);
  });

  it("6.4 substitution · substitute with e1RM history: load mapped through e1RM, rounded down (calib.e1rm_map)", () => {
    // A4 RDL 60 × 9 @ 4 → e1RM 60 × (1 + 13/30) = 86, A4 base stays 60 × 10 (hold_add_reps).
    // B1 swapped to RDL (6 to 8): 86 / (1 + (8 + 3) / 30) = 62.93 → rounded down 62.5 × 8.
    // ASSUMPTION: target reps for the mapping = the first exposure target (rep_max), target RIR = phase rir_min.
    const a = strength({ code: "A", date: day(1, "mon"), log: { romanian_deadlift: sets(2, 60, 9, 4) } });
    const ctx = makeCtx({ now: at(day(1, "wed"), "07:00"), history: [a] });
    const b1 = planned(planSession(ctx, { code: "B", mode: "full", swaps: { B1: "romanian_deadlift" } }), "B1");
    expect([b1.exercise_id, b1.swapped, b1.rep_min, b1.rep_max]).toEqual(["romanian_deadlift", "session", 6, 8]);
    expect(b1.rule_id).toBe("calib.e1rm_map");
    expect(workSets(b1).map((s) => [s.weight, s.reps])).toEqual([[62.5, 8], [62.5, 8]]);
    expect(b1.decision_id).toBe("d:init:romanian_deadlift@6-8");
    expect(computeState(ctx).tracks["romanian_deadlift@8-10"]?.base_weight).toBe(60); // the A4 track is separate
  });

  it("6.4 substitution · substitute without history: conservative calibration at RIR ≥ 3 (calib.pick)", () => {
    const b1 = planned(planSession(makeCtx({ now }), { code: "B", mode: "full", swaps: { B1: "conventional_deadlift" } }), "B1");
    expect(b1.exercise_id).toBe("conventional_deadlift");
    expect(b1.rule_id).toBe("calib.pick");
    expect(b1.calibration).toBe(true);
    expect(workSets(b1).every((s) => s.weight === null && s.reps === 6 && s.rir >= 3)).toBe(true);
  });
});

// ---------------------------------------------------------------- interference guard and spacing

describe("SPEC 6.4 · interference guard and SPEC 5 spacing (warn, never block)", () => {
  const hardTue = intervals(day(1, "tue"), 1, "18:00"); // 18:00-18:26
  const easyTue = easyCardio(day(1, "tue"), 30, "18:00");

  it("6.4 interference · hard cardio within 24 h before A or B warns (spacing.hard_cardio_before_heavy)", () => {
    const ctx = makeCtx({ now: at(day(1, "wed"), "12:00"), history: [hardTue] });
    for (const code of ["A", "B"] as const)
      expect(spacingWarnings(ctx, code).map((w) => w.rule_id)).toContain("spacing.hard_cardio_before_heavy");
    expect(spacingWarnings(ctx, "C").map((w) => w.rule_id)).not.toContain("spacing.hard_cardio_before_heavy");
  });

  it("6.4 interference · never blocks: the plan is complete and carries the warning", () => {
    const plan = planSession(makeCtx({ now: at(day(1, "wed"), "12:00"), history: [hardTue] }), { code: "A", mode: "full" });
    expect(plan.exercises.length).toBe(6);
    expect(plan.warnings.map((w) => w.rule_id)).toContain("spacing.hard_cardio_before_heavy");
  });

  it("6.4 interference · no warning after 24 h or after easy cardio", () => {
    const later = makeCtx({ now: at(day(1, "thu"), "20:00"), history: [hardTue] });
    expect(spacingWarnings(later, "A").map((w) => w.rule_id)).not.toContain("spacing.hard_cardio_before_heavy");
    const easy = makeCtx({ now: at(day(1, "wed"), "12:00"), history: [easyTue] });
    expect(spacingWarnings(easy, "A").map((w) => w.rule_id)).not.toContain("spacing.hard_cardio_before_heavy");
  });

  it("6.4 interference · hard cardio when the next session in line is A or B warns; easy cardio does not", () => {
    // After A, B, C the next in line is A (heavy)
    const abc = [
      strength({ code: "A", date: day(1, "mon"), log: dayLog("A", 0) }),
      strength({ code: "B", date: day(1, "wed"), log: dayLog("B", 0) }),
      strength({ code: "C", date: day(1, "fri"), log: dayLog("C", 0) }),
    ];
    const ctx = makeCtx({ now: at(day(1, "sat"), "10:00"), history: abc });
    const hard = spacingWarnings(ctx, "CARDIO", { intensity: "hard" });
    expect(hard.map((w) => w.rule_id)).toContain("spacing.hard_cardio_before_heavy");
    expect(hard.find((w) => w.rule_id === "spacing.hard_cardio_before_heavy")?.text).toContain("A");
    expect(spacingWarnings(ctx, "CARDIO", { intensity: "easy" }).map((w) => w.rule_id)).not.toContain("spacing.hard_cardio_before_heavy");
    expect(planCardio(ctx).warnings.map((w) => w.rule_id)).toContain("spacing.hard_cardio_before_heavy");

    // After A and B the next in line is C: no warning
    const ab = makeCtx({ now: at(day(1, "thu"), "10:00"), history: abc.slice(0, 2) });
    expect(spacingWarnings(ab, "CARDIO", { intensity: "hard" }).map((w) => w.rule_id)).not.toContain("spacing.hard_cardio_before_heavy");
  });

  it("6.4 interference · intervals prefer bike or rower: both offered by default, a single choice when set, never running", () => {
    const now = at(day(1, "mon"), "07:00");
    expect(planCardio(makeCtx({ now })).modality_options).toEqual(["bike", "rower"]);
    expect(planCardio(makeCtx({ now, settings: { interval_modality: "rower" } })).modality_options).toEqual(["rower"]);
    expect(planCardio(makeCtx({ now, settings: { interval_modality: "bike" } })).modality_options).toEqual(["bike"]);
  });

  it("PROGRAM cardio · 4x4 protocol follows the training week; once the cardio target is done, extra cardio is an easy bonus", () => {
    const at1 = planCardio(makeCtx({ now: at(day(1, "mon"), "07:00") }));
    expect([at1.kind, at1.rule_id, at1.intervals, at1.counts_as]).toEqual(["intervals", "cardio.intervals", { count: 4, hard_min: 2, easy_min: 2 }, "target"]);
    expect(at1.total_min).toBe(5 + 4 * (2 + 2) + 5);
    expect(at1.hard_minutes).toBe(8);
    const at3 = planCardio(makeCtx({ now: at(day(3, "mon"), "07:00"), history: steadyWeeks(1, 2) }));
    expect(at3.intervals).toEqual({ count: 3, hard_min: 4, easy_min: 3 });
    const at5 = planCardio(makeCtx({ now: at(day(5, "mon"), "07:00"), history: steadyWeeks(1, 4) }));
    expect(at5.intervals).toEqual({ count: 4, hard_min: 4, easy_min: 3 });
    expect(at5.segments.filter((x) => x.kind === "hard").length).toBe(4);

    const bonus = planCardio(makeCtx({ now: at(day(1, "thu"), "07:00"), history: [intervals(day(1, "tue"), 1)] }));
    expect([bonus.kind, bonus.rule_id, bonus.counts_as, bonus.hard_minutes]).toEqual(["easy", "cardio.easy", "bonus", 0]);
  });

  it("SPEC 5 spacing · strength a third day in a row warns (spacing.consecutive_strength)", () => {
    const h = [
      strength({ code: "A", date: day(1, "mon"), log: dayLog("A", 0) }),
      strength({ code: "B", date: day(1, "tue"), log: dayLog("B", 0) }),
    ];
    const wed = makeCtx({ now: at(day(1, "wed"), "18:00"), history: h });
    expect(spacingWarnings(wed, "C").map((w) => w.rule_id)).toContain("spacing.consecutive_strength");
    expect(planSession(wed, { code: "C", mode: "full" }).exercises.length).toBe(7); // still never blocks
    const thu = makeCtx({ now: at(day(1, "thu"), "18:00"), history: h });
    expect(spacingWarnings(thu, "C").map((w) => w.rule_id)).not.toContain("spacing.consecutive_strength");
  });
});
