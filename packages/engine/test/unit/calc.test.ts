import { describe, expect, test } from "vitest";
import { e1rm, fractionalSets, lerpClamped, round2, roundLoad, roundToIncrement, weightFromE1rm } from "../../src/calc";
import { fitId, progressionId } from "../../src/decisions";
import { config, exercises } from "./fixtures";

describe("e1rm", () => {
  test("Epley with RIR", () => {
    expect(e1rm(100, 5, 3, 30)).toBe(126.67);
    expect(e1rm(80, 8, 2, 30)).toBe(106.67);
    expect(e1rm(100, 5, null, 30)).toBe(116.67);
  });
  test("default divisor comes from engine.json", () => {
    expect(e1rm(90, 10, 0)).toBe(round2(90 * (1 + 10 / config.e1rm.divisor)));
  });
  test("inverse maps back", () => {
    expect(round2(weightFromE1rm(e1rm(100, 5, 3, 30), 5, 3, 30))).toBe(100);
  });
});

describe("roundToIncrement", () => {
  test("nearest, down, up", () => {
    expect(roundToIncrement(84, 2.5)).toBe(85);
    expect(roundToIncrement(83.7, 2.5)).toBe(82.5);
    expect(roundToIncrement(84, 2.5, "down")).toBe(82.5);
    expect(roundToIncrement(81, 2.5, "up")).toBe(82.5);
    expect(roundToIncrement(23, 2, "down")).toBe(22);
    expect(roundToIncrement(57, 5)).toBe(55);
  });
  test("no float noise", () => {
    expect(roundToIncrement(82.5, 2.5, "up")).toBe(82.5);
    expect(roundToIncrement(0.1 + 0.2, 0.1)).toBe(0.3);
    expect(roundToIncrement(75 * 1.1, 2.5, "down")).toBe(82.5);
    expect(roundToIncrement(80 * 0.95, 2.5, "down")).toBe(75);
    expect(roundToIncrement(1.25 * 3, 1.25)).toBe(3.75);
  });
  test("loads never go negative", () => {
    expect(roundLoad(-3, 2.5)).toBe(0);
  });
});

describe("fractional sets and interpolation", () => {
  test("primary 1.0, secondary 0.5", () => {
    expect(fractionalSets(exercises.bench_press!, config)).toEqual({ chest: 1, triceps: 0.5, shoulders: 0.5 });
  });
  test("lerp clamps both ends, works for descending x", () => {
    expect(lerpClamped(2.25, 2.25, 0.05, 1, 0.1)).toBe(0.05);
    expect(lerpClamped(0.5, 2.25, 0.05, 1, 0.1)).toBe(0.1);
    expect(round2(lerpClamped(1.625, 2.25, 0.05, 1, 0.1) * 1000)).toBe(75);
  });
});

describe("decision ids", () => {
  test("ids over 64 chars are shortened deterministically", () => {
    const sid = "01JC0000000000000000000000";
    const short = progressionId(sid, "bench_press@5-8");
    expect(short).toBe(`d:${sid}:bench_press@5-8`);
    const long = progressionId(sid, "a_very_long_custom_exercise_identifier@10-12");
    expect(long.length).toBeLessThanOrEqual(64);
    expect(long).toBe(progressionId(sid, "a_very_long_custom_exercise_identifier@10-12"));
    expect(long).not.toBe(progressionId(sid, "a_very_long_custom_exercise_identifier@10-15"));
    expect(fitId("d:x")).toBe("d:x");
  });
});
