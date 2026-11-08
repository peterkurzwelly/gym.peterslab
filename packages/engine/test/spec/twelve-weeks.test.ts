/**
 * SPEC 9 phase 2 acceptance: a simulated 13 calendar week history with a zero week, several floor-only weeks, one bad
 * sleep week and one stalled lift produces the expected week states, phase extension, comeback session, deload timing
 * and flags. The hand derivation of every expected value is in fixtures/twelve-weeks.ts.
 */
import { describe, expect, it } from "vitest";
import { computeState, planCardio, planSession, summarizeSession } from "../../src/index";
import type { EngineState } from "../../src/index";
import { makeCtx, must, planned, repairedWeek, hist, upTo, workSets, monday } from "./helpers";
import { EXPECTED, EXPECTED_TOTALS, IDS, T, TWELVE_WEEKS_HISTORY } from "./fixtures/twelve-weeks";

const ctxAt = (now: string, extra = TWELVE_WEEKS_HISTORY) => makeCtx({ now, history: upTo(extra, now) });
const stateAt = (now: string) => computeState(ctxAt(now));
const flags = (s: EngineState, kind: string) => s.flags.filter((f) => f.kind === kind);

describe("SPEC 9 phase 2 · twelve-week fixture", () => {
  it("week statuses, counts, training weeks and phases for all 13 calendar weeks", () => {
    const s = stateAt(T.end);
    expect(s.weeks.length).toBe(13);
    expect(s.weeks.map((w) => w.status)).toEqual(EXPECTED.status);
    expect(s.weeks.map((w) => w.strength_done)).toEqual(EXPECTED.strength_done);
    expect(s.weeks.map((w) => w.cardio_done)).toEqual(EXPECTED.cardio_done);
    expect(s.weeks.map((w) => w.walking_minutes)).toEqual(EXPECTED.walking_minutes);
    expect(s.weeks.map((w) => w.training_week)).toEqual(EXPECTED.training_week);
    expect(s.weeks.map((w) => w.phase)).toEqual(EXPECTED.phase);
    expect(s.weeks.map((w) => w.reactive_deload)).toEqual(EXPECTED.reactive_deload);
    expect(s.weeks.map((w) => w.is_zero)).toEqual(EXPECTED.status.map((x) => x === "zero"));
    expect(s.weeks.filter((w) => w.status === "floor").length).toBe(6); // several floor-only weeks
    expect(s.current_week.calendar_index).toBe(13);
  });

  it("one-week phase extension: calendar week 13 is training week 12 (consolidate), the block is not done", () => {
    const s = stateAt(T.end);
    expect(s.block).toMatchObject(EXPECTED.block);
    expect(s.block.dots).toEqual(EXPECTED.dots);
    const mon13 = stateAt(T.consolidateMonday);
    expect([mon13.block.training_week, mon13.block.phase, mon13.block.complete]).toEqual([12, "consolidate", false]);
    expect(mon13.current_week.training_week).toBe(12);
  });

  it("block complete in calendar week 14 (training week 13) with the plan-the-next-block nudge", () => {
    const s = stateAt(T.blockDone);
    expect(s.block.training_week).toBe(13);
    expect(s.block.complete).toBe(true);
    expect(s.nudges.some((n) => n.kind === "block_complete")).toBe(true);
    expect(s.next.plan.exercises.length).toBeGreaterThan(0); // `next` still works after the block
  });

  it("streak: weeks without a zero, floor and target weeks, runs", () => {
    const s = stateAt(T.end);
    expect(s.streak).toMatchObject(EXPECTED.streak);
    expect(s.weeks[6]?.can_repair).toBe(true);
  });

  it("totals never reset: sessions, sets, walking minutes and kg lifted", () => {
    const s = stateAt(T.end);
    expect(s.totals).toMatchObject(EXPECTED.totals);
    expect(s.totals.sets).toBe(EXPECTED_TOTALS.sets);
    expect(s.totals.kg_lifted).toBeCloseTo(EXPECTED_TOTALS.kg_lifted, 1);
  });

  it("next session after the block's last A is B, not done today", () => {
    const s = stateAt(T.end);
    expect(s.next.code).toBe("B");
    expect(s.next.done_today).toBe(false);
  });
});

describe("SPEC 9 phase 2 · deload timing (reactive, from the bad sleep week)", () => {
  it("before the first session after the third bad check-in: planned deload week 8, no flag yet", () => {
    const s = stateAt(T.beforeTrigger);
    expect(s.block.deload_week).toBe(8);
    expect(s.block.reactive_deload_used).toBe(false);
    expect(flags(s, "reactive_deload")).toEqual([]);
    expect(flags(s, "readiness_trend").length).toBeGreaterThanOrEqual(1); // last 7 days average 1.83 ≤ 2.25
  });

  it("after Thursday's session: training week 5 becomes the deload (k = 4, k + 1 = 5 < 8)", () => {
    const s = stateAt(T.afterTrigger);
    expect(s.block.deload_week).toBe(5);
    expect(s.block.reactive_deload_used).toBe(true);
    const f = flags(s, "reactive_deload");
    expect(f.length).toBe(1);
    expect(f[0]?.rule_id).toBe("event.reactive_deload");
    expect(s.current_week.training_week).toBe(4);
    expect(s.current_week.phase).toBe("return"); // the deload is the next week, not this one
  });

  it("deload week: B is next, half the build sets at the base loads, RIR 3, cardio 30 min easy", () => {
    const ctx = ctxAt(T.deloadMonday);
    const s = computeState(ctx);
    expect([s.current_week.training_week, s.current_week.phase, s.current_week.reactive_deload]).toEqual([5, "deload", true]);
    expect(s.next.code).toBe("B");
    const plan = s.next.plan;
    expect(plan.phase).toBe("deload");
    expect(plan.flags).toContain("deload");
    for (const [pid, [n, kg]] of Object.entries(EXPECTED.deload)) {
      const pe = planned(plan, pid);
      expect(workSets(pe).length, pid).toBe(n);
      expect(workSets(pe).every((x) => x.weight === kg && x.rir === 3), pid).toBe(true);
    }
    const cardio = planCardio(ctx);
    expect([cardio.kind, cardio.rule_id, cardio.total_min]).toEqual(["easy", "cardio.deload", 30]);
  });

  it("deload sessions leave every track base unchanged", () => {
    const before = stateAt(T.deloadMonday);
    const after = stateAt(T.afterDeload);
    for (const [key, t] of Object.entries(before.tracks)) {
      expect(after.tracks[key]?.base_weight, key).toBe(t.base_weight);
      expect(after.tracks[key]?.base_reps, key).toBe(t.base_reps);
    }
  });

  it("training week 8 (calendar week 9) is build: the planned deload was cancelled", () => {
    const s = stateAt(T.week8);
    expect([s.current_week.training_week, s.current_week.phase]).toEqual([8, "build"]);
    expect(s.block.deload_week).toBe(5);
    expect(planSession(ctxAt(T.week8), { code: "C", mode: "full" }).flags).not.toContain("deload");
  });

  it("exactly one reactive deload in the block, no deload_criteria_met later", () => {
    const s = stateAt(T.blockDone);
    expect(flags(s, "reactive_deload").length).toBe(1);
    expect(flags(s, "deload_criteria_met")).toEqual([]);
  });
});

describe("SPEC 9 phase 2 · zero week and comeback", () => {
  it("the zero week (walk only) does not advance the training week", () => {
    const s = stateAt(T.comebackMorning);
    expect(s.weeks[6]).toMatchObject({ status: "zero", is_zero: true, training_week: 7, walking_minutes: 45 });
    expect([s.current_week.training_week, s.current_week.phase]).toEqual([7, "build"]);
    expect(s.block.extension_weeks).toBe(1);
  });

  it("comeback session: A next, one set fewer and the same weights (comeback.overrides_short_break)", () => {
    // Rule change (ENGINE_RULES 4.5): the 9 day gap also meets the short break rule, but the comeback overrides it.
    // Before, both applied: loads × 0.85 and a break_resume nudge.
    const s = stateAt(T.comebackMorning);
    expect(s.next.code).toBe("A");
    const plan = s.next.plan;
    expect(plan.flags).toContain("comeback");
    expect(plan.flags).not.toContain("break_resume");
    expect(plan.training_week).toBe(7);
    for (const [pid, [n, kg, reps]] of Object.entries(EXPECTED.comeback)) {
      const pe = planned(plan, pid);
      expect(workSets(pe).length, pid).toBe(n);
      expect(workSets(pe).map((x) => [x.weight, x.reps]), pid).toEqual(Array.from({ length: n }, () => [kg, reps]));
    }
    expect(s.nudges.map((n) => n.kind)).toContain("comeback");
    expect(s.nudges.map((n) => n.kind)).not.toContain("break_resume");
    expect(s.nudges.find((n) => n.kind === "comeback")?.text).toBe("Coming back is easy on purpose: one set less, same weights.");
  });

  it("the comeback session yields no progression decision; the B after it progresses normally (no break window)", () => {
    // Rule change (ENGINE_RULES 4.5, comeback.overrides_short_break): the comeback starts no 85% window, so Wednesday's
    // B is an ordinary build session. Before, it was a break resume session and held too.
    const ctx = ctxAt(T.week8);
    const comeback = summarizeSession(ctx, IDS.comeback);
    expect(comeback.changes.length).toBeGreaterThan(0);
    for (const c of comeback.changes) expect(c.rule_id, c.exercise_id).toBe("event.comeback_hold");
    const b = summarizeSession(ctx, IDS.afterComeback);
    expect(b.changes.map((c) => [c.exercise_id, c.rule_id, c.to])).toEqual([
      ["trap_bar_deadlift", "dp.hold_add_reps", { weight: 97.5, reps: 6 }],
      ["overhead_press", "dp.hold_add_reps", { weight: 42.5, reps: 10 }],
    ]);
    const before = stateAt(T.comebackMorning);
    const after = stateAt(T.week8);
    const bTracks = new Set(["trap_bar_deadlift@4-6", "overhead_press@6-10"]);
    for (const [key, t] of Object.entries(before.tracks)) {
      if (bTracks.has(key)) continue;
      expect(after.tracks[key]?.base_weight, key).toBe(t.base_weight);
      expect(after.tracks[key]?.base_reps, key).toBe(t.base_reps);
    }
    expect(after.tracks["trap_bar_deadlift@4-6"]?.base_weight).toBe(97.5);
  });

  it("repairing the zero week freezes the streak but still extends the block and keeps the comeback (D9)", () => {
    const repaired = hist(TWELVE_WEEKS_HISTORY, repairedWeek(monday(7)));
    const s = computeState(makeCtx({ now: T.end, history: upTo(repaired, T.end) }));
    expect(s.weeks[6]).toMatchObject({ repaired: true, is_zero: true, status: "zero" });
    expect(s.streak).toMatchObject(EXPECTED.streakRepaired);
    expect(s.weeks.map((w) => w.training_week)).toEqual(EXPECTED.training_week);
    expect(s.block.extension_weeks).toBe(1);
    const mon8 = computeState(makeCtx({ now: T.comebackMorning, history: upTo(repaired, T.comebackMorning) }));
    expect(mon8.next.plan.flags).toContain("comeback");
  });
});

describe("SPEC 9 phase 2 · stall and flags", () => {
  it("no stall while the flat overhead press window still beats the earlier best", () => {
    const s = stateAt(T.beforeStall);
    expect(flags(s, "stall")).toEqual([]);
    expect(s.stats[EXPECTED.stalled]?.stalled).toBe(false);
  });

  it("overhead press stalls after its third flat exposure; nothing else does", () => {
    const ctx = ctxAt(T.blockDone);
    const s = computeState(ctx);
    const stall = flags(s, "stall");
    expect(stall.length).toBeGreaterThanOrEqual(1);
    expect(new Set(stall.map((f) => f.exercise_id))).toEqual(new Set([EXPECTED.stalled]));
    expect(stall.every((f) => f.rule_id === "event.stall" && f.text.length > 0)).toBe(true);
    expect(s.stats[EXPECTED.stalled]?.stalled).toBe(true);
    for (const id of EXPECTED.neverStalled) expect(s.stats[id]?.stalled, id).toBe(false);
    expect(planned(planSession(ctx, { code: "B", mode: "full" }), "B2").stalled).toBe(true);
  });

  it("the stalled lift's own decisions stay holds (45 kg × 8 within 6 to 10)", () => {
    const change = must(summarizeSession(ctxAt(T.blockDone), IDS.stallSession).changes.find((c) => c.exercise_id === "overhead_press"));
    expect(change.rule_id).toBe("dp.hold_add_reps");
    expect(change.to).toEqual({ weight: 45, reps: 10 });
  });

  it("no unexpected flags: no below range, no pain, no deload_criteria_met", () => {
    const s = stateAt(T.blockDone);
    for (const kind of ["below_range", "pain", "deload_criteria_met"]) expect(flags(s, kind), kind).toEqual([]);
  });
});
