import { describe, expect, it } from "vitest";
import { loadDefaults, type EngineState, type WeekState } from "@gym/engine";
import { blockRows, groupByPhase, phaseForWeek, sessionLabel } from "../../src/screens/plan/model";

const { program } = loadDefaults();

function week(p: Partial<WeekState> & Pick<WeekState, "id" | "start_date" | "training_week">): WeekState {
  return {
    end_date: "",
    calendar_index: 1,
    phase: "return",
    phase_label: "Return phase",
    is_current: false,
    is_complete: true,
    strength_done: 2,
    cardio_done: 0,
    bonus_done: 0,
    walking_minutes: 0,
    floor_reached: true,
    target_reached: false,
    is_zero: false,
    repaired: false,
    can_repair: false,
    reactive_deload: false,
    status: "floor",
    session_ids: [],
    to_floor_text: null,
    to_target_text: null,
    ...p,
  };
}

describe("phaseForWeek", () => {
  it("follows the program phases with the planned deload", () => {
    expect(phaseForWeek(program, 1, 8).name).toBe("return");
    expect(phaseForWeek(program, 5, 8).name).toBe("build");
    expect(phaseForWeek(program, 8, 8).name).toBe("deload");
    expect(phaseForWeek(program, 9, 8).name).toBe("push");
    expect(phaseForWeek(program, 12, 8).name).toBe("consolidate");
  });

  it("moves the deload when it was pulled forward, and week 8 takes the phase before it", () => {
    expect(phaseForWeek(program, 6, 6).name).toBe("deload");
    expect(phaseForWeek(program, 8, 6).name).toBe("build");
  });
});

describe("blockRows", () => {
  const weeks = [
    week({ id: "wk_2026-11-09", start_date: "2026-11-09", training_week: 1 }),
    week({ id: "wk_2026-11-16", start_date: "2026-11-16", training_week: 2, status: "zero", is_zero: true, strength_done: 0, floor_reached: false }),
    week({ id: "wk_2026-11-23", start_date: "2026-11-23", training_week: 2, is_current: true, is_complete: false, status: "in_progress" }),
  ];
  const state = { weeks, current_week: weeks[2], block: { block_weeks: 12, deload_week: 8 } } as unknown as EngineState;

  it("lists every calendar week so far, then the training weeks ahead with projected dates", () => {
    const rows = blockRows(state, program);
    expect(rows).toHaveLength(3 + 10);
    expect(rows.map((r) => r.kind).slice(0, 4)).toEqual(["done", "done", "current", "future"]);
    expect(rows[3]).toMatchObject({ training_week: 3, start_date: "2026-11-30", end_date: "2026-12-06", week: null });
    expect(rows[rows.length - 1]).toMatchObject({ training_week: 12, start_date: "2027-02-01" });
    expect(rows.find((r) => r.training_week === 8 && r.kind === "future")?.phase.name).toBe("deload");
  });

  it("groups consecutive rows by phase", () => {
    const groups = groupByPhase(blockRows(state, program));
    expect(groups.map((g) => g.phase.name)).toEqual(["return", "build", "deload", "push", "consolidate"]);
    expect(groups[0]!.rows).toHaveLength(5); // 3 calendar weeks + training weeks 3 and 4
  });
});

describe("sessionLabel", () => {
  it("names sessions plainly", () => {
    expect(sessionLabel("A", "full")).toBe("Session A");
    expect(sessionLabel("B", "short")).toBe("★ Session B");
    expect(sessionLabel("TRAVEL", "travel")).toBe("Travel version");
    expect(sessionLabel("CARDIO", "full")).toBe("Cardio");
  });
});
