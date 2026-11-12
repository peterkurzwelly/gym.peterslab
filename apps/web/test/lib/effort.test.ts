/** Effort in plain words: "leave 3 in the tank" on targets, "3 left" on logged sets. */
import { describe, expect, it } from "vitest";
import { backSquat, benchTopSet, plank, splitSquat } from "../../src/components/__fixtures__";
import { effortTag, effortText, phaseLine, targetLine } from "../../src/lib/effort";

describe("effort", () => {
  it("effortText says how many reps to leave", () => {
    expect(effortText(3)).toBe("leave 3 in the tank");
    expect(effortText(1)).toBe("leave 1 in the tank");
    expect(effortText(0)).toBe("all out");
  });

  it("effortTag is the short form next to a logged set", () => {
    expect(effortTag(3)).toBe("3 left");
    expect(effortTag(1)).toBe("1 left");
    expect(effortTag(0)).toBe("max");
  });

  it("targetLine reads sets, range and effort, per measure", () => {
    expect(targetLine(backSquat)).toBe("2 sets · 5–8 reps · leave 3 in the tank");
    expect(targetLine(plank)).toBe("2 sets · 30–45 s · leave 3 in the tank");
    expect(targetLine(splitSquat)).toBe("2 sets · 8–10/leg reps · leave 3 in the tank");
    expect(targetLine(benchTopSet)).toBe("3 sets · 5–8 reps · leave 2 in the tank · plus one top set");
    expect(targetLine({ ...backSquat, sets: backSquat.sets.slice(0, 1) })).toBe("1 set · 5–8 reps · leave 3 in the tank");
  });

  it("every phase has a line without gym shorthand", () => {
    for (const phase of ["return", "build", "deload", "push", "consolidate"] as const) {
      const line = phaseLine(phase);
      expect(line.length).toBeGreaterThan(10);
      expect(line).not.toMatch(/\bRIR\b|deload|e1RM|\bfloor\b/i);
    }
  });
});
