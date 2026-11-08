import { describe, expect, test } from "vitest";
import { planCardio, planSession } from "../../src/index";
import { History, at, ctxOf, day, withConfig } from "./fixtures";

function weeksOf(weeks: number): History {
  const h = new History();
  for (let w = 0; w < weeks; w++) h.simple("C", day(w * 7), ["C1"], [[100, 10, 3]]);
  return h;
}

describe("planCardio", () => {
  test("weeks 1 to 2: 4 × 2 min hard / 2 min easy, ~26 min, segments in order", () => {
    const c = planCardio(ctxOf(new History(), at(day(0), "08:00")));
    expect(c).toMatchObject({ kind: "intervals", rule_id: "cardio.intervals", total_min: 26, hard_minutes: 8, warmup_min: 5, cooldown_min: 5, counts_as: "target" });
    expect(c.intervals).toEqual({ count: 4, hard_min: 2, easy_min: 2 });
    expect(c.segments.map((s) => s.label)).toEqual([
      "Warm-up", "Hard 1/4", "Easy 1/4", "Hard 2/4", "Easy 2/4", "Hard 3/4", "Easy 3/4", "Hard 4/4", "Easy 4/4", "Cool-down",
    ]);
    expect(c.segments.reduce((a, s) => a + s.seconds, 0)).toBe(26 * 60);
    expect(c.reason).toBe("Week 1: 4 × 2 min hard, 2 min easy between.");
  });

  test("protocol follows the training week (3 to 4, then 5 to 12, then the last one repeats)", () => {
    expect(planCardio(ctxOf(weeksOf(2), at(day(14), "08:00"))).total_min).toBe(31);
    expect(planCardio(ctxOf(weeksOf(4), at(day(28), "08:00"))).total_min).toBe(38);
    expect(planCardio(ctxOf(weeksOf(13), at(day(13 * 7), "08:00"))).total_min).toBe(38);
  });

  test("deload week: easy for deload_easy_min", () => {
    const ctx = withConfig(ctxOf(new History(), at(day(0), "08:00")), (c) => {
      c.deload.planned_week = 1;
    });
    expect(planCardio(ctx)).toMatchObject({ kind: "easy", rule_id: "cardio.deload", total_min: 30, hard_minutes: 0, intervals: null });
  });

  test("low readiness today swaps intervals for easy", () => {
    const h = new History();
    h.checkin(day(0), 2);
    const c = planCardio(ctxOf(h, at(day(0), "08:00")));
    expect(c).toMatchObject({ kind: "easy", rule_id: "cardio.readiness_swap", total_min: 30, reason: "Sleep 2/5: easy 30 min instead of intervals." });
  });

  test("target cardio done: an easy bonus session", () => {
    const h = new History();
    h.cardio(day(0));
    const c = planCardio(ctxOf(h, at(day(1), "08:00")));
    expect(c).toMatchObject({ kind: "easy", rule_id: "cardio.easy", counts_as: "bonus" });
  });

  test("modality options from settings", () => {
    expect(planCardio(ctxOf(new History(), at(day(0)))).modality_options).toEqual(["bike", "rower"]);
    expect(planCardio(ctxOf(new History(), at(day(0)), { interval_modality: "rower" })).modality_options).toEqual(["rower"]);
  });

  test("hard cardio warns when the next session in line is a heavy day", () => {
    const c = planCardio(ctxOf(new History(), at(day(0))));
    expect(c.warnings).toEqual([{ rule_id: "spacing.hard_cardio_before_heavy", text: "Next up is A. Keep hard cardio a day away, or go easy today." }]);
    const h = new History();
    h.simple("A", day(0), ["A1"], [[60, 8]]);
    h.simple("B", day(2), ["B1"], [[60, 5]]);
    expect(planCardio(ctxOf(h, at(day(3)))).warnings).toEqual([]); // next is C
  });

  test("planSession for CARDIO wraps the cardio plan", () => {
    const plan = planSession(ctxOf(new History(), at(day(0))), { code: "CARDIO", mode: "full" });
    expect(plan).toMatchObject({ code: "CARDIO", exercises: [], est_minutes: 26 });
    expect(plan.decisions[0]!.rule_id).toBe("cardio.intervals");
  });
});
