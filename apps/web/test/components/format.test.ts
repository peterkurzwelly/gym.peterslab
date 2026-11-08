import { describe, expect, it } from "vitest";
import { exerciseSummary, lastTimeText } from "../../src/components/ExerciseCard";
import { changeDelta, changeDeltaFor, changeNextLine, isStartingLoad, loadText } from "../../src/components/SummaryView";
import { weekDoneText } from "../../src/components/WeekCard";
import { backSquat, benchTopSet, farmersCarry, goals, plank, pullUp, splitSquat, summaryA, weekTarget } from "../../src/components/__fixtures__";
import { fmtAmount, fmtApproxMin, fmtClock, fmtKg, fmtKgDelta, fmtLoad, fmtLocalDate, fmtMinutes, fmtRange, fmtRangeAmount, fmtRelativeDate } from "../../src/lib/format";

describe("format", () => {
  it("kg without trailing zeros", () => {
    expect(fmtKg(82.5)).toBe("82.5");
    expect(fmtKg(80)).toBe("80");
    expect(fmtKg(80.0000001)).toBe("80");
    expect(fmtKg(81.25)).toBe("81.25");
    expect(fmtKgDelta(2.5)).toBe("+2.5");
    expect(fmtKgDelta(-5)).toBe("−5");
  });

  it("loads per measure", () => {
    expect(fmtLoad(0, { bodyweight: true })).toBe("BW");
    expect(fmtLoad(5, { bodyweight: true })).toBe("BW+5");
    expect(fmtLoad(22.5, { per_hand: true })).toBe("22.5/hand");
    expect(fmtAmount(30, { measure: "seconds" })).toBe("30 s");
    expect(fmtAmount(40, { measure: "meters" })).toBe("40 m");
    expect(fmtAmount(8, { per_side: true, name: "Bulgarian split squat" })).toBe("8/leg");
    expect(fmtAmount(10, { per_side: true, name: "One-arm dumbbell row" })).toBe("10/arm");
  });

  it("en dash only inside numeric ranges", () => {
    expect(fmtRange(6, 8)).toBe("6–8");
    expect(fmtRange(8, 8)).toBe("8");
    expect(fmtRangeAmount(30, 45, { measure: "seconds" })).toBe("30–45 s");
  });

  it("times and dates", () => {
    expect(fmtApproxMin(55)).toBe("~55 min");
    expect(fmtMinutes(48)).toBe("48 min");
    expect(fmtMinutes(65)).toBe("1 h 5 min");
    expect(fmtClock(65)).toBe("1:05");
    expect(fmtClock(3725)).toBe("1:02:05");
    expect(fmtClock(-3)).toBe("0:00");
    expect(fmtLocalDate("2026-11-09")).toBe("Mon 9 Nov");
    expect(fmtRelativeDate("2026-11-10", "2026-11-11")).toBe("Yesterday");
    expect(fmtRelativeDate("2026-11-11", "2026-11-11")).toBe("Today");
  });
});

describe("component text helpers", () => {
  it("exercise summary", () => {
    expect(exerciseSummary(backSquat)).toBe("2 × 5–8 @ RIR 3");
    expect(exerciseSummary(plank)).toBe("2 × 30–45 s @ RIR 3");
    expect(exerciseSummary(splitSquat)).toBe("2 × 8–10/leg @ RIR 3");
    expect(exerciseSummary(benchTopSet)).toBe("3 × 5–8 @ RIR 2 + top set");
  });

  it("last time line", () => {
    expect(lastTimeText(pullUp.last_time!, pullUp)).toBe("BW+5 × 8, 8, 7");
    expect(lastTimeText(plank.last_time!, plank)).toBe("30 s, 30 s");
    expect(lastTimeText(splitSquat.last_time!, splitSquat)).toBe("12/hand × 10/leg, 10/leg @ 3");
    expect(lastTimeText({ session_id: "x", date: "2026-11-09", sets: [{ weight: 24, reps: 40, rir: null }] }, farmersCarry)).toBe("24/hand × 40 m");
  });

  it("week done counts up to each target", () => {
    expect(weekDoneText(weekTarget, goals)).toBe("4 of 4 done");
    expect(weekDoneText(weekTarget)).toBe("5 sessions done");
  });

  it("summary deltas", () => {
    expect(summaryA.changes.map(changeDelta)).toEqual(["+2.5 kg", "+5 kg", "same"]);
  });

  it("summary next lines respect bodyweight and timed work", () => {
    const plankShape = { bodyweight: true, measure: "seconds" as const };
    expect(changeNextLine({ weight: 0, reps: 45 }, plankShape)).toBe("Next: 45 s");
    expect(changeNextLine({ weight: 5, reps: 6 }, { bodyweight: true })).toBe("Next: BW+5 × 6");
    expect(changeNextLine({ weight: 62.5, reps: 8 })).toBe("Next: 62.5 kg × 8");
    expect(changeNextLine({ weight: 10, reps: 12 }, { per_hand: true })).toBe("Next: 10 kg/hand × 12");
    expect(changeNextLine({ weight: 0, reps: 45 })).toBe("Next: 45");
    const base = { exercise_id: "plank", name: "Plank", rule_id: "dp.increase", decision_id: "d1", explanation: "" };
    expect(changeDeltaFor({ ...base, from: { weight: 0, reps: 30 }, to: { weight: 0, reps: 45 } }, plankShape)).toBe("aim 45 s");
    expect(changeDeltaFor({ ...base, from: null, to: { weight: 0, reps: 30 } }, plankShape)).toBe("aim 30 s");
    expect(changeDeltaFor({ ...base, from: { weight: null, reps: 8 }, to: { weight: 25, reps: 8 } })).toBe("25 kg");
    expect(changeDeltaFor({ ...base, from: { weight: null, reps: 12 }, to: { weight: 10, reps: 12 } }, { per_hand: true })).toBe("10 kg/hand");
  });

  it("after calibration the line names the starting weight, never 'aim n' or '0 kg'", () => {
    const base = { exercise_id: "back_squat", name: "Back squat", rule_id: "dp.increase", decision_id: "d1", explanation: "" };
    const calib = { ...base, from: { weight: null, reps: 8 }, to: { weight: 25, reps: 5 } };
    expect(isStartingLoad(calib)).toBe(true);
    expect(changeDeltaFor(calib)).toBe("25 kg");
    expect(changeNextLine(calib.to, {}, { start: true })).toBe("Start at 25 kg × 5 next time");
    expect(changeNextLine({ weight: 2.5, reps: 6 }, { bodyweight: true }, { start: true })).toBe("Start at BW+2.5 × 6 next time");
    expect(changeDeltaFor({ ...base, from: { weight: null, reps: 6 }, to: { weight: 2.5, reps: 6 } }, { bodyweight: true })).toBe("BW+2.5");
    expect(isStartingLoad({ from: { weight: 60, reps: 8 }, to: { weight: 62.5, reps: 5 } })).toBe(false);
    // Bodyweight at 0: no load at all.
    expect(loadText(0, { bodyweight: true })).toBeNull();
    expect(changeNextLine({ weight: 0, reps: 8 }, { bodyweight: true })).toBe("Next: 8");
  });
});
