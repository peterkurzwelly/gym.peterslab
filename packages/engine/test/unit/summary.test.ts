import { describe, expect, test } from "vitest";
import { planSession, summarizeSession } from "../../src/index";
import { History, at, ctxOf, day, withProgram } from "./fixtures";

describe("summarizeSession", () => {
  test("lists the change per exercise with from, to and a summary line", () => {
    const h = new History();
    const s = h.session({
      code: "A",
      date: day(0),
      exercises: [
        { pid: "A2", sets: [[80, 8, 2], [80, 8, 2], [80, 8, 2]] },
        { pid: "A3", sets: [[50, 10, 2], [50, 9, 2]] },
      ],
    });
    const ctx = withProgram(ctxOf(h, at(day(0), "20:00")), (p) => {
      const a2 = p.days[0]!.prescriptions.find((x) => x.id === "A2")!;
      a2.rep_min = 6;
      p.phases.find((x) => x.name === "return")!.rir_min = 2;
    });
    const sum = summarizeSession(ctx, s.id);
    expect(sum).toMatchObject({ session_id: s.id, code: "A", mode: "full", sets_logged: 5, kg_lifted: 80 * 8 * 3 + 50 * 19 });
    expect(sum.changes[0]).toMatchObject({
      exercise_id: "bench_press",
      rule_id: "dp.increase",
      decision_id: `d:${s.id}:bench_press@6-8`,
      to: { weight: 82.5, reps: 6 },
      explanation: "Bench press +2.5 kg: all sets hit 8 reps at RIR 2.",
    });
    expect(sum.changes[1]).toMatchObject({ rule_id: "dp.hold_add_reps", explanation: "Chest supported row: same weight, aim for 12 reps on every set." });
    expect(sum.decisions.map((d) => d.id)).toContain(`d:${s.id}:bench_press@6-8`);
    expect(sum.week.id).toBe(`wk_${day(0)}`);
    expect(sum.prs).toEqual([]);
  });

  test("PRs compare the session e1RM with the previous best", () => {
    const h = new History();
    h.simple("A", day(0), ["A2"], [[80, 6, 3]]);
    const s = h.simple("A", day(2), ["A2"], [[82.5, 7, 3]]);
    const sum = summarizeSession(ctxOf(h, at(day(2), "21:00")), s.id);
    expect(sum.prs).toEqual([{ exercise_id: "bench_press", name: "Bench press", e1rm: 110, previous_best: 104 }]);
  });

  test("hold sessions report the hold rule with unchanged targets", () => {
    const h = new History();
    h.simple("A", day(0), ["A2"], [[80, 8, 3], [80, 8, 3]]);
    h.simple("B", day(2), ["B2"], [[40, 8, 3], [40, 8, 3]]);
    const back = h.simple("B", day(16), ["B2"], [[40, 10, 3]]);
    const sum = summarizeSession(ctxOf(h, at(day(16), "21:00")), back.id);
    const c = sum.changes[0]!;
    expect(c.rule_id).toBe("event.comeback_hold");
    expect(c.from).not.toBeNull();
    expect(c.from).toEqual(c.to);
    expect(c.explanation).toBe("Overhead press: first session back: same targets next time.");
    expect(sum.decisions.some((d) => d.id === `d:event:event.comeback_hold:${back.id}`)).toBe(true);
  });

  test("a hold session on a track with no base yet keeps the lifted load at the same reps: no new calibration", () => {
    const h = new History();
    h.simple("A", day(0), ["A2"], [[80, 8, 3], [80, 8, 3]]);
    const back = h.simple("B", day(16), ["B2"], [[40, 8, 3], [37.5, 8, 3]]);
    const ctx = ctxOf(h, at(day(16), "21:00"));
    const c = summarizeSession(ctx, back.id).changes[0]!;
    expect(c.rule_id).toBe("event.comeback_hold");
    expect(c.from).toEqual({ weight: null, reps: 8 });
    expect(c.to).toEqual({ weight: 40, reps: 8 });
    const next = planSession(ctx, { code: "B", mode: "full" }).exercises.find((e) => e.prescription_id === "B2")!;
    expect(next).toMatchObject({ calibration: false, rule_id: "event.comeback_hold", decision_id: `d:event:event.comeback_hold:${back.id}` });
    expect(next.sets.every((x) => x.weight === 40 && x.reps === 8)).toBe(true);
  });

  test("a session not yet marked finished is summarized as finished now", () => {
    const h = new History();
    const s = h.session({ code: "A", date: day(0), time: "18:00", ended: false, exercises: [{ pid: "A1", sets: [[60, 8, 3], [60, 8, 3]] }] });
    const sum = summarizeSession(ctxOf(h, at(day(0), "18:50")), s.id);
    expect(sum.duration_min).toBe(50);
    expect(sum.changes[0]!.rule_id).toBe("dp.increase");
  });

  test("consolidate top set is compared with the first e1RM of the block", () => {
    const h = new History();
    h.simple("A", day(0), ["A1"], [[100, 5, 3]]); // first e1RM 126.67
    const s = h.session({ code: "A", date: day(2), exercises: [{ pid: "A1", sets: [[100, 6, 3]], top: [[110, 5, 1]] }] });
    const ctx = withProgram(ctxOf(h, at(day(2), "21:00")), (p) => {
      p.phases.find((x) => x.name === "return")!.top_set = { main_lifts: true, rir: 1 };
    });
    const sum = summarizeSession(ctx, s.id);
    const top = sum.changes.find((c) => c.rule_id === "phase.top_set")!;
    // 110 × (1 + 6/30) = 132
    expect(top).toMatchObject({ exercise_id: "back_squat", to: { weight: 110, reps: 5 }, explanation: "Back squat top set: e1RM 132 kg, start of the block 126.67 kg." });
    expect(sum.changes.at(-1)!.rule_id).toBe("phase.top_set");
    expect(sum.decisions.some((d) => d.id === `d:event:phase.top_set:${s.id}`)).toBe(true);
  });

  test("unknown session throws", () => {
    expect(() => summarizeSession(ctxOf(new History(), at(day(0))), "nope")).toThrow(/not found/);
  });
});
