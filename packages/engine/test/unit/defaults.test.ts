import { describe, expect, test } from "vitest";
import { Settings } from "@gym/schema";
import { ENGINE_VERSION, defaultSettings, missingExerciseIds, validateDefaults } from "../../src/defaults";
import engineJson from "../../../../config/engine.json" with { type: "json" };
import programJson from "../../../../config/program.json" with { type: "json" };
import { config, exercises, program } from "./fixtures";

const library = { source: "test", license: "Unlicense", exercises: Object.values(exercises) };

describe("validateDefaults", () => {
  test("accepts the real configs with a complete library", () => {
    const d = validateDefaults({ engine: engineJson, program: programJson, library });
    expect(d.config.engine_version).toBe(ENGINE_VERSION);
    expect(Object.keys(d.exercises)).toHaveLength(library.exercises.length);
    expect(d.program.days.map((x) => x.code)).toEqual(["A", "B", "C", "TRAVEL"]);
  });

  test("lists every missing exercise id, alternatives included", () => {
    const partial = { ...library, exercises: library.exercises.filter((e) => e.id !== "back_squat" && e.id !== "suitcase_carry") };
    expect(() => validateDefaults({ engine: engineJson, program: programJson, library: partial })).toThrow(/back_squat, suitcase_carry/);
    expect(missingExerciseIds(program, {})).toContain("dead_bug");
  });

  test("an empty library names the problem", () => {
    expect(() => validateDefaults({ engine: engineJson, program: programJson, library: { source: "x", license: "x", exercises: [] } })).toThrow(
      /missing from data\/exercises\.json/,
    );
  });

  test("invalid config is a readable error naming the file", () => {
    const broken = { ...engineJson, e1rm: { divisor: "thirty" } };
    expect(() => validateDefaults({ engine: broken, program: programJson, library })).toThrow(/config\/engine\.json is invalid/);
  });

  test("duplicate library ids are rejected", () => {
    const dup = { ...library, exercises: [...library.exercises, exercises.bench_press] };
    expect(() => validateDefaults({ engine: engineJson, program: programJson, library: dup })).toThrow(/duplicate.*bench_press/);
  });
});

describe("defaultSettings", () => {
  test("fresh install settings validate and follow config", () => {
    const s = defaultSettings(config, program, "2026-11-08T10:00:00.000Z");
    expect(Settings.parse(s)).toEqual(s);
    expect(s.block_start_date).toBe(program.default_start_date);
    expect(s.start_pct).toBe(config.calibration.start_pct);
    expect(s.session_order).toEqual(program.rotation);
    expect(s.timezone).toBe(config.timezone_default);
    expect(s.limitations).toEqual([]);
  });
});
