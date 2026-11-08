/**
 * SPEC 6.3 double progression, every row, with the bench press example (bench_press 3 × 6 to 8, 80 kg) and the
 * ENGINE_RULES 3 rule table (rule ids, caps, D7 large jump).
 *
 * Build phase cases (target RIR 2) log A sessions in calendar week 5 after four filler weeks (leg press only), so the
 * session's training week is 5. Return phase cases (target RIR 3) log in calendar week 1.
 */
import { describe, expect, it } from "vitest";
import { computeState, planSession, summarizeSession } from "../../src/index";
import type { SetTuple } from "./helpers";
import {
  SPEC_BENCH_PROGRAM,
  at,
  day,
  fillerWeeks,
  makeCtx,
  must,
  planned,
  repsAt,
  strength,
  trackKey,
  workSets,
} from "./helpers";

const KEY = trackKey("bench_press", 6, 8);

interface Logged {
  date: string;
  sets: SetTuple[];
  pain?: boolean;
}

/** Log A sessions with bench only, then read the track, the next A plan and the decision. */
function bench(phase: "build" | "return", logs: Logged[]) {
  const parts = logs.map((l) =>
    strength({ code: "A", date: l.date, program: SPEC_BENCH_PROGRAM, log: { bench_press: { sets: l.sets, pain: l.pain ?? false } } }),
  );
  const history = phase === "build" ? [fillerWeeks(1, 4), ...parts] : parts;
  const now = phase === "build" ? at(day(5, "fri"), "08:00") : at(day(1, "fri"), "08:00");
  const ctx = makeCtx({ now, program: SPEC_BENCH_PROGRAM, history });
  const state = computeState(ctx);
  const plan = planSession(ctx, { code: "A", mode: "full" });
  const pe = planned(plan, "A2");
  const last = must(parts.at(-1)?.id);
  const decisionId = `d:${last}:${KEY}`;
  return { ctx, state, plan, pe, track: state.tracks[KEY], decision: state.decisions.find((d) => d.id === decisionId), decisionId, last };
}

/** Shared assertions for one 6.3 row. */
function expectRow(r: ReturnType<typeof bench>, rule: string, weight: number, reps: number) {
  expect(r.track?.base_weight).toBe(weight);
  expect(r.track?.base_reps).toBe(reps);
  expect(r.track?.last_rule_id).toBe(rule);
  expect(r.pe.rule_id).toBe(rule);
  expect(r.pe.decision_id).toBe(r.decisionId);
  expect(r.pe.reason.length).toBeGreaterThan(0);
  expect(workSets(r.pe).every((s) => s.weight === weight && s.reps === reps)).toBe(true);
  const d = must(r.decision, `decision ${r.decisionId}`);
  expect(d.rule_id).toBe(rule);
  expect(d.session_id).toBe(r.last);
  expect(d.exercise_id).toBe("bench_press");
  expect(d.explanation.length).toBeGreaterThan(0);
  expect(d.explanation).toBe(r.pe.reason);
}

const MON5 = day(5, "mon");
const THU5 = day(5, "thu");

describe("SPEC 6.3 · bench press example (3 × 6 to 8 @ RIR 2, 80 kg)", () => {
  it("6.3 row 1 · 8, 8, 8 at RIR ≥ target → 82.5 kg × 6 (dp.increase)", () => {
    const r = bench("build", [{ date: MON5, sets: repsAt(80, [8, 8, 8], 2) }]);
    expectRow(r, "dp.increase", 82.5, 6);
    expect(workSets(r.pe).length).toBe(4); // build: main lift 4 sets
  });

  it("6.3 row 2 · 10, 10, 9 at RIR ≥ target in the return phase → +5% rounded up = 85 kg × 6 (dp.large_jump, D7)", () => {
    // every set ≥ 9, 2 of 3 sets ≥ 10, average extra 1.67 ≤ 2 → pct_min 5% → 84 → up to 85
    const r = bench("return", [{ date: day(1, "mon"), sets: repsAt(80, [10, 10, 9], 3) }]);
    expectRow(r, "dp.large_jump", 85, 6);
  });

  it("6.3 row 3 · 8, 7, 6 → 80 kg, aim 8, 8, 8 (dp.hold_add_reps)", () => {
    const r = bench("build", [{ date: MON5, sets: repsAt(80, [8, 7, 6], 2) }]);
    expectRow(r, "dp.hold_add_reps", 80, 8);
  });

  it("6.3 row 4 · 6, 5, 4 (2 sets below rep_min) → hold 80 kg and flag below_range (dp.below_range)", () => {
    const r = bench("build", [{ date: MON5, sets: repsAt(80, [6, 5, 4], 2) }]);
    expectRow(r, "dp.below_range", 80, 8);
    expect(r.track?.below_range_streak).toBe(1);
    const flag = r.state.flags.find((f) => f.kind === "below_range" && f.exercise_id === "bench_press");
    expect(flag?.text.length).toBeGreaterThan(0);
  });

  it("6.3 row 5 · below range two sessions running, some sets in range → −5% rounded down = 75 kg × 6 (dp.reset)", () => {
    const r = bench("build", [
      { date: MON5, sets: repsAt(80, [6, 5, 4], 2) },
      { date: THU5, sets: repsAt(80, [6, 5, 5], 2) },
    ]);
    expectRow(r, "dp.reset", 75, 6);
  });

  it("6.3 row 5 · below range two sessions running, every set below → −10% rounded down = 70 kg × 6 (dp.reset)", () => {
    const r = bench("build", [
      { date: MON5, sets: repsAt(80, [5, 5, 4], 2) },
      { date: THU5, sets: repsAt(80, [5, 4, 4], 2) },
    ]);
    expectRow(r, "dp.reset", 70, 6);
  });

  it("6.3 row 6 · pain flag → no increase, same reps target, an allowed alternative suggested (dp.pain)", () => {
    // Monday 8, 8, 7 sets the base 80 × 8. Thursday 8, 8, 8 @ 2 would be dp.increase, but pain is logged.
    const r = bench("build", [
      { date: MON5, sets: repsAt(80, [8, 8, 7], 2) },
      { date: THU5, sets: repsAt(80, [8, 8, 8], 2), pain: true },
    ]);
    expectRow(r, "dp.pain", 80, 8);
    expect(r.pe.pain_last_time).toBe(true);
    expect(r.pe.alternatives.some((a) => a.allowed && a.exercise_id === "dumbbell_bench_press")).toBe(true);
  });
});

describe("ENGINE_RULES 3 · rule table details", () => {
  it("dp.hold_rir · every set at the top of the range but harder than planned → same load, reps = rep_max", () => {
    const r = bench("build", [{ date: MON5, sets: repsAt(80, [8, 8, 8], [2, 1, 1]) }]);
    expectRow(r, "dp.hold_rir", 80, 8);
  });

  it("dp.increase · rir null counts as meeting the target", () => {
    const r = bench("build", [{ date: MON5, sets: repsAt(80, [8, 8, 8], null) }]);
    expectRow(r, "dp.increase", 82.5, 6);
  });

  it("dp.large_jump · not outside the return phase: 10, 10, 9 in build is a normal +2.5 kg", () => {
    const r = bench("build", [{ date: MON5, sets: repsAt(80, [10, 10, 9], 2) }]);
    expectRow(r, "dp.increase", 82.5, 6);
  });

  it("dp.large_jump · D7 needs at least half the sets at rep_max + 2: 10, 9, 9 is a normal increase", () => {
    const r = bench("return", [{ date: day(1, "mon"), sets: repsAt(80, [10, 9, 9], 3) }]);
    expectRow(r, "dp.increase", 82.5, 6);
  });

  it("dp.large_jump · pct interpolates on the average extra reps: 11, 11, 11 → +7.5% → 86 → 87.5 kg", () => {
    // average extra 3, halfway between reps_over 2 (5%) and reps_over_for_max 4 (10%)
    const r = bench("return", [{ date: day(1, "mon"), sets: repsAt(80, [11, 11, 11], 3) }]);
    expectRow(r, "dp.large_jump", 87.5, 6);
  });

  it("cap · max_jump_pct: 40 kg × 12, 12, 12 → +10% = 44 → up 45 exceeds the cap → 44 rounded down = 42.5 kg", () => {
    const r = bench("return", [{ date: day(1, "mon"), sets: repsAt(40, [12, 12, 12], 3) }]);
    expectRow(r, "dp.large_jump", 42.5, 6);
  });

  it("evaluation uses the heaviest working weight; lighter sets count as not reaching the top", () => {
    // 80 × 8, 8 and a back-off 70 × 8: load 80, the 70 set does not reach the top at 80 → within range, hold
    const r = bench("build", [{ date: MON5, sets: [[80, 8, 2], [80, 8, 2], [70, 8, 2]] }]);
    expectRow(r, "dp.hold_add_reps", 80, 8);
  });

  it("summary line: what changed for next time and why (SPEC 4.1.9)", () => {
    const r = bench("build", [{ date: MON5, sets: repsAt(80, [8, 8, 8], 2) }]);
    const summary = summarizeSession(r.ctx, r.last);
    const change = must(summary.changes.find((c) => c.exercise_id === "bench_press"));
    expect(change.rule_id).toBe("dp.increase");
    expect(change.to).toEqual({ weight: 82.5, reps: 6 });
    expect(change.decision_id).toBe(r.decisionId);
    expect(change.explanation.length).toBeGreaterThan(0);
    expect(summary.sets_logged).toBe(3);
    expect(summary.kg_lifted).toBe(1920);
  });
});
