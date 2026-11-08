import { describe, expect, it } from "vitest";
import { loadDefaults, type EngineContext, type EngineState, type Flag, type WeekState } from "@gym/engine";
import type { Decision } from "@gym/schema";
import { buildChartData, defaultReviewWeek, e1rmTrend, groupFlags, movedUp, volumeLine, volumeSummary, type E1rmSeries } from "../../src/screens/progress/model";

const defaults = loadDefaults();
const ctx = { ...defaults, settings: {}, history: {}, now: "2026-12-20T08:00:00.000Z" } as unknown as EngineContext;

const flag = (kind: Flag["kind"], date: string, text = kind): Flag => ({ kind, rule_id: `event.${kind}`, text, date, exercise_id: null });

function decision(id: string, rule_id: string, session_id: string, exercise_id: string, output: Record<string, unknown>, load?: number): Decision {
  return {
    id,
    date: "2026-12-14T07:00:00.000Z",
    rule_id,
    engine_version: "1",
    session_id,
    exercise_id,
    inputs_snapshot: load == null ? {} : { load },
    output,
    explanation: "All sets hit top of range at RIR 2: +2.5 kg.",
    updated_at: "2026-12-14T07:00:00.000Z",
    deleted_at: null,
  };
}

describe("flags", () => {
  it("folds volume flags into one quiet line and sorts the rest newest first", () => {
    const flags = [flag("volume_low", "2026-12-13"), flag("stall", "2026-12-10"), flag("volume_high", "2026-12-13"), flag("volume_low", "2026-12-13"), flag("pain", "2026-12-12")];
    const g = groupFlags(flags);
    expect(g.items.map((f) => f.kind)).toEqual(["pain", "stall"]);
    expect(g.volume).toHaveLength(3);
    expect(volumeLine(g.volume)).toBe("Volume outside the band: 2 low, 1 high. Worth a look, nothing urgent.");
    expect(volumeLine([])).toBeNull();
  });
});

describe("movedUp", () => {
  const week = { session_ids: ["s1", "s2"] } as WeekState;
  const state = {
    decisions: [
      decision("d1", "dp.increase", "s1", "face_pull", { weight: 22.5, summary: "Face pull +2.5 kg: all sets hit 15 reps at RIR 2." }, 20),
      decision("d2", "dp.hold_add_reps", "s1", "lateral_raise", { weight: 8 }, 8),
      decision("d3", "dp.large_jump", "s2", "back_squat", { weight: 85 }, 80),
      decision("d4", "dp.increase", "old", "bench_press", { weight: 60 }, 57.5),
      decision("d5", "dp.increase", "s2", "face_pull", { weight: 25 }, 22.5),
    ],
  } as unknown as EngineState;

  it("lists load increases from this week's sessions, main lifts first, one line per exercise", () => {
    const ups = movedUp(state, ctx, week, ["back_squat", "bench_press"]);
    expect(ups.map((u) => [u.exercise_id, u.delta])).toEqual([
      ["back_squat", 5],
      ["face_pull", 2.5],
    ]);
    expect(ups[1]!.decision_id).toBe("d5");
    expect(ups[0]!.name).toBe(defaults.exercises.back_squat!.name);
  });

  it("is empty when nothing moved up", () => {
    expect(movedUp(state, ctx, { session_ids: ["none"] } as WeekState)).toEqual([]);
  });
});

describe("headline numbers", () => {
  it("averages the e1RM change over lifts with two points or more", () => {
    const s = (first: number, latest: number, n: number): E1rmSeries => ({
      exercise_id: "x",
      name: "x",
      first,
      latest,
      points: Array.from({ length: n }, (_, i) => ({ date: "", label: "", e1rm: i === 0 ? first : latest })),
    });
    expect(e1rmTrend([s(100, 110, 3), s(50, 52, 2), s(80, 80, 1)])).toEqual({ pct: (0.1 + 0.04) / 2, lifts: 2 });
    expect(e1rmTrend([s(80, 80, 1)])).toEqual({ pct: null, lifts: 0 });
  });

  it("summarises sets per muscle against the band", () => {
    const state = {
      current_week: { id: "wk" },
      volume: [{ week_id: "wk", band: { min: 8, max: 10 }, by_muscle: { chest: 9, back: 11, shoulders: 3, biceps: 8, triceps: 10, quads: 0, hamstrings: 7.5, glutes: 8.5 } }],
    } as unknown as EngineState;
    expect(volumeSummary(state, ctx)).toMatchObject({ in_band: 4, below: 3, above: 1, muscles: 8 });
  });
});

describe("buildChartData", () => {
  it("splits WHO minutes into cardio and walking per week and keeps paused weeks", () => {
    const w = (id: string, start: string, tw: number, status: WeekState["status"], walking: number, current = false) =>
      ({ id, start_date: start, training_week: tw, status, walking_minutes: walking, is_current: current }) as WeekState;
    const state = {
      today: "2026-11-25",
      weeks: [w("w1", "2026-11-09", 1, "target", 30), w("w2", "2026-11-16", 2, "zero", 0), w("w3", "2026-11-23", 2, "in_progress", 10, true)],
      volume: [
        { week_id: "w1", who_minutes: 64, who_target: 150, checkin_avg: 3.75, by_muscle: { chest: 4 }, band: null },
        { week_id: "w2", who_minutes: 0, who_target: 150, checkin_avg: null, by_muscle: {}, band: null },
        { week_id: "w3", who_minutes: 10, who_target: 150, checkin_avg: 4, by_muscle: {}, band: null },
      ],
      stats: { back_squat: { history: [{ date: "2026-11-09", session_id: "s1", e1rm: 60 }, { date: "2026-11-11", session_id: "s2", e1rm: 64.44 }] } },
      totals: { sessions: 3, walking_minutes: 40 },
    } as unknown as EngineState;
    const data = buildChartData(state, ctx, [{ prescription_id: "A1", exercise_id: "back_squat", name: "Back squat" }]);
    expect(data.cardio.map((r) => [r.label, r.cardio, r.walking, r.total])).toEqual([
      ["9 Nov", 34, 30, 64],
      ["16 Nov", 0, 0, 0],
      ["23 Nov", 0, 10, 10],
    ]);
    expect(data.cardio[1]!.is_zero).toBe(true);
    expect(data.checkin.map((r) => r.avg)).toEqual([3.75, null, 4]);
    expect(data.e1rm[0]).toMatchObject({ first: 60, latest: 64.4 });
    expect(data.volume.band).toEqual({ min: 8, max: 10 });
    expect(data.has_history).toBe(true);
  });
});

describe("defaultReviewWeek", () => {
  const state = (weeks: number, sessions: number) => ({ weeks: Array.from({ length: weeks }), current_week: { session_ids: Array.from({ length: sessions }) } }) as unknown as EngineState;
  it("opens last week on a quiet Monday, else this week", () => {
    expect(defaultReviewWeek(state(3, 0), 1)).toBe("last");
    expect(defaultReviewWeek(state(3, 1), 1)).toBe("this");
    expect(defaultReviewWeek(state(1, 0), 1)).toBe("this");
    expect(defaultReviewWeek(state(3, 0), 0)).toBe("this");
  });
});
