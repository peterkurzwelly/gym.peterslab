/**
 * SPEC 6.1 core calculations and ENGINE_RULES 0 / 1 ground rules, black box through the public API.
 */
import { describe, expect, it } from "vitest";
import { Settings } from "@gym/schema";
import {
  computeState,
  daysBetween,
  defaultSettings,
  e1rm,
  localDate,
  roundToIncrement,
  weekStart,
} from "../../src/index";
import {
  BASE_CONFIG,
  BASE_PROGRAM,
  TZ,
  at,
  day,
  makeCtx,
  plusMinutes,
  sets,
  strength,
  weekId,
} from "./helpers";

describe("SPEC 6.1 · core calculations", () => {
  it("6.1 e1RM · Epley with RIR: weight × (1 + (reps + rir) / 30)", () => {
    expect(e1rm(80, 8, 2)).toBeCloseTo(106.67, 1);
    expect(e1rm(100, 5, 0)).toBeCloseTo(116.67, 1);
    expect(e1rm(60, 10, 3)).toBeCloseTo(86, 1);
    expect(e1rm(100, 10, 0, 40)).toBeCloseTo(125, 1);
  });

  it("6.1 e1RM · rir null counts as 0", () => {
    expect(e1rm(100, 5, null)).toBeCloseTo(e1rm(100, 5, 0), 6);
  });

  it("6.1 e1RM · best working set per session per exercise", () => {
    // 80×8@3 = 109.33, 85×5@3 = 107.67, 75×10@2 = 105.00 → best 109.33
    const s = strength({ code: "A", date: day(1, "mon"), log: { bench_press: [[80, 8, 3], [85, 5, 3], [75, 10, 2]] } });
    const state = computeState(makeCtx({ now: at(day(1, "wed"), "09:00"), history: [s] }));
    const stats = state.stats["bench_press"];
    expect(stats?.e1rm).toBeCloseTo(109.33, 1);
    expect(stats?.best_e1rm).toBeCloseTo(109.33, 1);
    expect(stats?.first_e1rm).toBeCloseTo(109.33, 1);
    expect(stats?.history.map((p) => p.session_id)).toEqual([s.id]);
  });

  it("6.1 e1RM · top sets count as working sets; warm-ups do not", () => {
    // work 80×5@3 = 101.33, top 90×3@1 = 102.00 → 102. The warm-up 100×1 (e1RM 103.33) is ignored.
    const s = strength({
      code: "A",
      date: day(1, "mon"),
      log: { bench_press: { warmups: [[100, 1, null]], sets: sets(2, 80, 5, 3), top: [[90, 3, 1]] } },
    });
    const state = computeState(makeCtx({ now: at(day(1, "wed"), "09:00"), history: [s] }));
    expect(state.stats["bench_press"]?.e1rm).toBeCloseTo(102, 1);
  });

  it("6.1 e1RM · measures other than reps produce no e1RM", () => {
    const s = strength({ code: "A", date: day(1, "mon"), log: { plank: sets(2, 0, 40, null) } });
    const state = computeState(makeCtx({ now: at(day(1, "wed"), "09:00"), history: [s] }));
    expect(state.stats["plank"]?.e1rm ?? null).toBeNull();
  });

  it("6.1 fractional sets · 1.0 per primary muscle, 0.5 per secondary, working sets only", () => {
    // bench 2 (chest; triceps, shoulders) + row 2 (back; biceps) + lateral raise 2 (shoulders) + 1 warm-up (ignored)
    const s = strength({
      code: "A",
      date: day(1, "mon"),
      log: {
        bench_press: { warmups: [[40, 10, null]], sets: sets(2, 80, 8, 3) },
        chest_supported_row: sets(2, 50, 10, 3),
        lateral_raise: sets(2, 10, 12, 3),
      },
    });
    const state = computeState(makeCtx({ now: at(day(1, "wed"), "09:00"), history: [s] }));
    const v = state.volume.find((w) => w.week_id === weekId(1));
    expect(v?.by_muscle.chest).toBeCloseTo(2, 6);
    expect(v?.by_muscle.triceps).toBeCloseTo(1, 6);
    expect(v?.by_muscle.shoulders).toBeCloseTo(3, 6); // 0.5 × 2 + 1.0 × 2
    expect(v?.by_muscle.back).toBeCloseTo(2, 6);
    expect(v?.by_muscle.biceps).toBeCloseTo(1, 6);
    expect(v?.by_muscle.quads ?? 0).toBe(0);
  });

  it("ENGINE_RULES 1 · kg lifted = Σ weight × reps over working rep sets, per_hand counts twice", () => {
    // bench 80×8×2 = 1280, row 50×10×2 = 1000, lateral raise 10×12×2 × 2 hands = 480, plank (seconds) and warm-up excluded
    const s = strength({
      code: "A",
      date: day(1, "mon"),
      log: {
        bench_press: { warmups: [[40, 10, null]], sets: sets(2, 80, 8, 3) },
        chest_supported_row: sets(2, 50, 10, 3),
        lateral_raise: sets(2, 10, 12, 3),
        plank: sets(2, 0, 40, null),
      },
    });
    const state = computeState(makeCtx({ now: at(day(1, "wed"), "09:00"), history: [s] }));
    expect(state.totals.kg_lifted).toBeCloseTo(2760, 6);
    expect(state.totals.strength_sessions).toBe(1);
  });

  it("6.1 rounding · nearest, down and up to the increment, without float noise", () => {
    expect(roundToIncrement(83.9, 2.5)).toBe(85);
    expect(roundToIncrement(63, 2.5)).toBe(62.5); // 60% of a remembered 105
    expect(roundToIncrement(46.2, 1.25)).toBe(46.25);
    expect(roundToIncrement(22.9, 2)).toBe(22);
    expect(roundToIncrement(84, 2.5, "down")).toBe(82.5);
    expect(roundToIncrement(76, 2.5, "down")).toBe(75); // reset −5% from 80
    expect(roundToIncrement(72, 2.5, "down")).toBe(70); // reset −10% from 80
    expect(roundToIncrement(57.5 * 0.85, 2.5, "down")).toBe(47.5);
    expect(roundToIncrement(46.75, 5, "down")).toBe(45);
    expect(roundToIncrement(84, 2.5, "up")).toBe(85); // large jump +5% from 80
    expect(roundToIncrement(80.1, 2.5, "up")).toBe(82.5);
    expect(roundToIncrement(82.5, 2.5, "up")).toBe(82.5);
    expect(roundToIncrement(0.1 + 0.2, 0.1)).toBe(0.3);
  });
});

describe("ENGINE_RULES 0 · local time, weeks and finished sessions", () => {
  it("localDate uses the IANA zone (CET winter, CEST summer)", () => {
    expect(localDate("2026-11-09T23:30:00.000Z", TZ)).toBe("2026-11-10");
    expect(localDate("2026-11-09T22:59:00.000Z", TZ)).toBe("2026-11-09");
    expect(localDate("2026-07-01T22:30:00.000Z", TZ)).toBe("2026-07-02");
    expect(localDate("2026-07-01T21:59:00.000Z", TZ)).toBe("2026-07-01");
  });

  it("weekStart returns the Monday; daysBetween counts whole local days (b − a)", () => {
    expect(weekStart("2026-11-15")).toBe("2026-11-09");
    expect(weekStart("2026-11-09")).toBe("2026-11-09");
    expect(weekStart("2027-01-01")).toBe("2026-12-28");
    expect(daysBetween("2026-11-09", "2026-11-23")).toBe(14);
    expect(daysBetween("2026-11-23", "2026-11-09")).toBe(-14);
    expect(daysBetween("2027-03-27", "2027-03-29")).toBe(2); // across the DST change
  });

  it("a session belongs to the local date of started_at (00:30 Monday counts in the new week)", () => {
    const s = strength({ code: "A", date: "2026-11-16", time: "00:30", log: { bench_press: sets(2, 60, 8, 3) } });
    expect(s.sessions?.[0]?.started_at).toBe("2026-11-15T23:30:00.000Z");
    const state = computeState(makeCtx({ now: at("2026-11-17", "12:00"), history: [s] }));
    expect(state.weeks[0]?.strength_done).toBe(0);
    expect(state.weeks[1]?.strength_done).toBe(1);
  });

  it("weeks list every calendar week from block start through the current one, Monday to Sunday", () => {
    const state = computeState(makeCtx({ now: at(day(3, "wed"), "12:00") }));
    expect(state.weeks.map((w) => [w.id, w.start_date, w.end_date, w.calendar_index])).toEqual([
      ["wk_2026-11-09", "2026-11-09", "2026-11-15", 1],
      ["wk_2026-11-16", "2026-11-16", "2026-11-22", 2],
      ["wk_2026-11-23", "2026-11-23", "2026-11-29", 3],
    ]);
    expect(state.current_week.id).toBe("wk_2026-11-23");
    expect(state.today).toBe("2026-11-25");
  });

  it("an open session older than session.auto_finish_hours is auto finished; a fresh one is active and counts", () => {
    const now = at(day(2, "tue"), "21:00");
    const stale = strength({ code: "A", date: day(2, "tue"), time: "17:00", open: true, log: { bench_press: sets(2, 60, 8, 3) } });
    // last set at 17:06, 3 h 54 min before now > auto_finish_hours (3)
    const state = computeState(makeCtx({ now, history: [stale] }));
    expect(state.auto_finished.map((a) => a.session_id)).toEqual([stale.id]);
    expect(state.active).toBeNull();
    expect(BASE_CONFIG.session.auto_finish_hours).toBe(3);

    const fresh = strength({ code: "A", date: day(2, "tue"), time: "20:40", open: true, log: { bench_press: sets(1, 60, 8, 3) } });
    const state2 = computeState(makeCtx({ now, history: [fresh] }));
    expect(state2.active?.session.id).toBe(fresh.id);
    expect(state2.auto_finished).toEqual([]);
    expect(state2.current_week.strength_done).toBe(1); // unfinished sessions count once they have one logged set
  });

  it("deleted rows are ignored everywhere", () => {
    const kept = strength({ code: "A", date: day(1, "mon"), log: { bench_press: sets(2, 60, 8, 3) } });
    const gone = strength({ code: "B", date: day(1, "wed"), deleted: true, log: { overhead_press: sets(2, 40, 8, 3) } });
    const state = computeState(makeCtx({ now: at(day(1, "thu"), "12:00"), history: [kept, gone] }));
    expect(state.current_week.strength_done).toBe(1);
    expect(state.stats["overhead_press"]?.e1rm ?? null).toBeNull();
    expect(state.next.code).toBe("B"); // the deleted B does not advance the rotation
  });

  it("defaultSettings: block starts program.default_start_date, start_pct and timezone from config, no limitations", () => {
    const now = plusMinutes(at("2026-11-08", "12:00"), 0);
    const s = defaultSettings(BASE_CONFIG, BASE_PROGRAM, now);
    expect(() => Settings.parse(s)).not.toThrow();
    expect(s.id).toBe("settings");
    expect(s.block_start_date).toBe(BASE_PROGRAM.default_start_date);
    expect(s.start_pct).toBe(BASE_CONFIG.calibration.start_pct);
    expect(s.timezone).toBe(BASE_CONFIG.timezone_default);
    expect(s.session_order).toEqual(BASE_PROGRAM.rotation);
    expect(s.limitations).toEqual([]);
    expect(s.block_swaps).toEqual({});
  });
});
