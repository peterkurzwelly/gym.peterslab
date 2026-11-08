import { describe, expect, test } from "vitest";
import { computeState } from "../../src/index";
import { History, at, ctxOf, day } from "./fixtures";

describe("weekly volume", () => {
  test("fractional sets per tracked muscle from finished and in progress sessions", () => {
    const h = new History();
    h.simple("A", day(0), ["A1", "A2"], [[60, 8], [60, 8]]);
    h.session({ code: "B", date: day(2), ended: false, exercises: [{ pid: "B2", sets: [[40, 8]] }] });
    const st = computeState(ctxOf(h, at(day(2), "18:30")));
    const v = st.volume[0]!;
    // Squat: quads + glutes primary, hamstrings secondary. Bench: chest primary, triceps + shoulders secondary. OHP: shoulders, triceps.
    expect(v.by_muscle).toMatchObject({ quads: 2, glutes: 2, hamstrings: 1, chest: 2, triceps: 1.5, shoulders: 2, back: 0, biceps: 0 });
    expect(v.by_muscle).not.toHaveProperty("lower_back"); // not tracked
    expect(v.band).toBeNull(); // return phase is not a band phase
  });

  test("warm-up sets never count; band shows in build", () => {
    const h = new History();
    for (let w = 0; w < 4; w++) h.simple("C", day(w * 7), ["C1"], [[100, 10]]);
    h.session({ code: "A", date: day(28), exercises: [{ pid: "A2", sets: [[60, 8]], warmups: [[40, 5], [50, 3]] }] });
    const v = computeState(ctxOf(h, at(day(29)))).volume[4]!;
    expect(v.band).toEqual({ min: 8, max: 10 });
    expect(v.by_muscle.chest).toBe(1);
  });

  test("WHO minutes: easy + hard × multiplier + the rest, walks included; check-in average", () => {
    const h = new History();
    h.session({ code: "CARDIO", date: day(0), cardio: { minutes: 38, hard_minutes: 16, intensity: "hard" } });
    h.session({ code: "CARDIO", date: day(1), cardio: { minutes: 30, intensity: "easy" } });
    h.walk(day(2), 40);
    h.checkin(day(0), 4);
    h.checkin(day(1), 2);
    const v = computeState(ctxOf(h, at(day(3)))).volume[0]!;
    expect(v.who_minutes).toBe(16 * 2 + 22 + 30 + 40);
    expect(v.who_target).toBe(150);
    expect(v.checkin_avg).toBe(3);
  });
});

describe("totals", () => {
  test("never reset, count both hands for per hand exercises, skip seconds and meters", () => {
    const h = new History();
    h.session({
      code: "A",
      date: day(0),
      exercises: [
        { pid: "A2", sets: [[80, 8], [80, 8]] },
        { pid: "A2", ex: "dumbbell_bench_press", sets: [[20, 10]] },
        { pid: "A6", sets: [[0, 45]] },
      ],
    });
    h.session({ code: "C", date: day(2), exercises: [{ pid: "C7", sets: [[32, 40]] }] });
    h.cardio(day(3), 26);
    h.walk(day(3), 30);
    const t = computeState(ctxOf(h, at(day(100)))).totals;
    expect(t).toEqual({
      sessions: 3,
      strength_sessions: 2,
      cardio_sessions: 1,
      sets: 5,
      cardio_minutes: 26,
      walking_minutes: 30,
      kg_lifted: 80 * 8 * 2 + 20 * 10 * 2,
    });
  });
});
