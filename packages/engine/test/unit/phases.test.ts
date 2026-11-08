import { describe, expect, test } from "vitest";
import { phaseForWeek, plannedDeloadWeeks, setsRuleFor } from "../../src/phases";
import { config, program } from "./fixtures";

describe("phaseForWeek", () => {
  const planned = plannedDeloadWeeks(program, config);

  test("program phases by training week", () => {
    const names = Array.from({ length: 14 }, (_, i) => phaseForWeek(program, config, i + 1, planned).name);
    expect(names).toEqual([
      "return", "return", "return", "return",
      "build", "build", "build",
      "deload",
      "push", "push", "push",
      "consolidate",
      "consolidate", "consolidate", // past the block: consolidate repeats
    ]);
  });

  test("a pulled forward deload moves week 8 to the phase before it", () => {
    const moved = new Set([4]);
    expect(phaseForWeek(program, config, 4, moved).name).toBe("deload");
    expect(phaseForWeek(program, config, 8, moved).name).toBe("build");
    expect(phaseForWeek(program, config, 9, moved).name).toBe("push");
  });

  test("planned week comes from engine.json", () => {
    const c = structuredClone(config);
    c.deload.planned_week = 6;
    const weeks = plannedDeloadWeeks(program, c);
    expect(phaseForWeek(program, c, 6, weeks).name).toBe("deload");
    expect(phaseForWeek(program, c, 8, weeks).name).toBe("build");
  });
});

describe("setsRuleFor", () => {
  test("week 1 has 2 sets, weeks 2 to 4 have 3, nearest rule otherwise", () => {
    const ret = program.phases.find((p) => p.name === "return")!;
    expect(setsRuleFor(ret, 1)?.main_lift).toBe(2);
    expect(setsRuleFor(ret, 3)?.main_lift).toBe(3);
    const build = program.phases.find((p) => p.name === "build")!;
    expect(setsRuleFor(build, 8)?.main_lift).toBe(4);
    expect(setsRuleFor(program.phases.find((p) => p.name === "deload")!, 8)).toBeNull();
  });
});
