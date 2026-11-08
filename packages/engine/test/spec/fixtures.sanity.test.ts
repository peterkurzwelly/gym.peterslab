/**
 * Checks the fixture DSL and the twelve-week fixture themselves (no engine calls), so the spec tests rest on
 * fixtures that really say what their comments claim.
 */
import { describe, expect, it } from "vitest";
import {
  BASE_PROGRAM,
  LIBRARY,
  at,
  day,
  epley,
  localDateOf,
  programExerciseIds,
  steadyWeeks,
  hist,
  upTo,
  lib,
} from "./helpers";
import {
  CARDIO_WEEKS,
  EXPECTED,
  EXPECTED_TOTALS,
  LIFTS,
  STRENGTH_ROWS,
  TWELVE_WEEKS_HISTORY,
} from "./fixtures/twelve-weeks";

describe("fixture DSL", () => {
  it("the inline library covers every exercise id in program.json (alternatives and travel included)", () => {
    const missing = programExerciseIds(BASE_PROGRAM).filter((id) => !LIBRARY[id]);
    expect(missing).toEqual([]);
  });

  it("library increments, measures and tags follow the task brief", () => {
    expect([lib("bench_press").increment_kg, lib("bench_press").step_kg]).toEqual([2.5, 2.5]);
    for (const id of ["back_squat", "trap_bar_deadlift", "conventional_deadlift", "romanian_deadlift"]) expect(lib(id).step_kg).toBe(5);
    expect(lib("lateral_raise").increment_kg).toBe(2);
    expect(lib("lateral_raise").per_hand).toBe(true);
    expect(lib("leg_press").increment_kg).toBe(5);
    expect(lib("seated_cable_row").increment_kg).toBe(2.5);
    expect(lib("plank").measure).toBe("seconds");
    expect(lib("farmers_carry").measure).toBe("meters");
    for (const id of ["pull_up", "push_up", "hanging_knee_raise"]) expect(lib(id).bodyweight).toBe(true);
    expect(lib("back_squat").tags).toContain("deep_knee_flexion");
    expect(lib("hack_squat").tags).toContain("knee_friendly");
    expect(lib("leg_press").tags).toContain("knee_friendly");
    expect(lib("one_arm_dumbbell_row").tags).toContain("unilateral");
  });

  it("Stockholm time helpers: CET in winter, CEST in summer", () => {
    expect(at("2026-11-09", "18:00")).toBe("2026-11-09T17:00:00.000Z");
    expect(at("2026-11-16", "00:30")).toBe("2026-11-15T23:30:00.000Z");
    expect(at("2026-07-01", "18:00")).toBe("2026-07-01T16:00:00.000Z");
    expect(localDateOf("2026-11-15T23:30:00.000Z")).toBe("2026-11-16");
    expect(day(1, "mon")).toBe("2026-11-09");
    expect(day(7, "thu")).toBe("2026-12-24");
    expect(day(14, "mon")).toBe("2027-02-08");
  });

  it("steady weeks: e1RM of every loaded exercise rises exposure to exposure and reps stay in range", () => {
    const h = hist(steadyWeeks(1, 12));
    const byEx = new Map<string, number[]>();
    for (const s of h.sessions) {
      const logs = h.setLogs.filter((l) => l.session_id === s.id && !l.is_warmup);
      const best = new Map<string, number>();
      for (const l of logs) best.set(l.exercise_id, Math.max(best.get(l.exercise_id) ?? 0, epley(l.weight, l.reps, l.rir ?? 0)));
      for (const [ex, e] of best) byEx.set(ex, [...(byEx.get(ex) ?? []), e]);
    }
    for (const [ex, seq] of byEx) {
      if (lib(ex).measure !== "reps" || seq[0] === 0) continue;
      for (let i = 1; i < seq.length; i++) expect(seq[i]!, `${ex} exposure ${i}`).toBeGreaterThan(seq[i - 1]!);
    }
    for (const l of h.setLogs) {
      const p = BASE_PROGRAM.days.flatMap((d) => d.prescriptions).find((x) => x.id === l.prescription_id)!;
      expect(l.reps).toBeGreaterThanOrEqual(p.rep_min);
      expect(l.reps).toBeLessThanOrEqual(p.rep_max);
    }
  });

  it("upTo keeps only rows that exist at the given instant", () => {
    const h = upTo(TWELVE_WEEKS_HISTORY, at(day(4, "wed"), "21:00"));
    expect(h.checkins.map((c) => c.date)).toEqual(["2026-11-30", "2026-12-01", "2026-12-02"]);
    expect(h.sessions.every((s) => s.started_at < at(day(4, "wed"), "21:00"))).toBe(true);
  });
});

describe("twelve-week fixture matches its derivation", () => {
  const rows = STRENGTH_ROWS;

  it("strength and cardio counts per calendar week", () => {
    const strength = Array.from({ length: 13 }, (_, i) => rows.filter((r) => r.cw === i + 1).length);
    const cardio = Array.from({ length: 13 }, (_, i) => (CARDIO_WEEKS.includes(i + 1) ? 1 : 0));
    expect(strength).toEqual(EXPECTED.strength_done);
    expect(cardio).toEqual(EXPECTED.cardio_done);
    expect(EXPECTED.totals.strength_sessions).toBe(rows.length);
    expect(EXPECTED.totals.cardio_sessions).toBe(CARDIO_WEEKS.length);
  });

  it("training week index follows ENGINE_RULES 2 (zero week does not advance it)", () => {
    let tw = 1;
    const out: number[] = [];
    for (let i = 0; i < 13; i++) {
      out.push(tw);
      const zero = EXPECTED.strength_done[i] === 0 && EXPECTED.cardio_done[i] === 0;
      if (!zero) tw++;
    }
    expect(out).toEqual(EXPECTED.training_week);
    for (const r of rows) expect(r.tw, `row ${r.cw} ${r.code}`).toBe(EXPECTED.training_week[r.cw - 1]);
  });

  it("Peter always does the next session in line", () => {
    const order = rows.map((r) => r.code).join("");
    expect(order).toBe("ABC".repeat(11).slice(0, rows.length));
  });

  it("every eligible exposure raises e1RM (except the stalled OHP), non eligible ones never set a best", () => {
    const seen = new Map<string, { best: number; eligible: number[] }>();
    for (const r of rows)
      LIFTS[r.code].forEach(([ex, reps], i) => {
        const e = epley(r.loads[i]!, reps, r.rir);
        const st = seen.get(ex) ?? { best: 0, eligible: [] };
        if (r.kind === "eligible") {
          if (ex !== EXPECTED.stalled) expect(e, `${ex} CW${r.cw}`).toBeGreaterThan(st.best);
          st.eligible.push(e);
        } else {
          expect(e, `${ex} CW${r.cw} (${r.kind})`).toBeLessThanOrEqual(st.best + 1e-9);
        }
        st.best = Math.max(st.best, e);
        seen.set(ex, st);
      });
    const ohp = seen.get("overhead_press")!.eligible.map((x) => Math.round(x * 100) / 100);
    // CW8 B is eligible since the comeback no longer starts a break window (ENGINE_RULES 4.5 rule change): OHP repeats
    // 42.5 × 8 there (56.67, a tie, not a new best), then 60 from CW9.
    expect(ohp).toEqual([47.83, 51.25, 54.67, 56.67, 56.67, 60, 60, 60, 60]);
  });

  it("reps are always inside the prescription range (no below range, no all-top)", () => {
    const range = (ex: string) => BASE_PROGRAM.days.flatMap((d) => d.prescriptions).find((p) => p.exercise_id === ex)!;
    for (const code of ["A", "B", "C"] as const)
      for (const [ex, reps] of LIFTS[code]) {
        const p = range(ex);
        expect(reps).toBeGreaterThanOrEqual(p.rep_min);
        expect(reps).toBeLessThan(p.rep_max);
      }
  });

  it("bad sleep week: three consecutive check-ins averaging ≤ 2.0, then a recovered one", () => {
    const avgs = TWELVE_WEEKS_HISTORY.checkins.map((c) => (c.sleep + c.soreness + c.stress + c.energy) / 4);
    expect(TWELVE_WEEKS_HISTORY.checkins.map((c) => c.date)).toEqual(["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-04"]);
    expect(avgs).toEqual([2, 1.75, 1.75, 3.5]);
  });

  it("only the CW6 → CW8 gap reaches the 7 day break threshold, and it is a short break (≤ 14 days)", () => {
    const dates = TWELVE_WEEKS_HISTORY.sessions.map((s) => localDateOf(s.started_at)).sort();
    const gaps: { from: string; to: string; days: number }[] = [];
    for (let i = 1; i < dates.length; i++) {
      const d = (Date.parse(dates[i]!) - Date.parse(dates[i - 1]!)) / 86_400_000;
      if (d >= 7) gaps.push({ from: dates[i - 1]!, to: dates[i]!, days: d });
    }
    expect(gaps).toEqual([{ from: "2026-12-19", to: "2026-12-28", days: 9 }]);
    // The 9 day gap ends in the comeback session (Mon 12-28), which overrides the short break (ENGINE_RULES 4.5,
    // comeback.overrides_short_break): no break window, so Wed 12-30 B is a normal session.
    expect(rows.filter((r) => r.cw === 8).map((r) => [day(r.cw, r.dow), r.kind])).toEqual([["2026-12-28", "comeback"], ["2026-12-30", "eligible"]]);
    expect(day(9, "tue")).toBe("2027-01-05");
  });

  it("totals are derivable from the rows", () => {
    expect(EXPECTED_TOTALS.sets).toBe(TWELVE_WEEKS_HISTORY.setLogs.filter((l) => !l.is_warmup).length);
    expect(EXPECTED_TOTALS.kg_lifted).toBeGreaterThan(0);
  });
});
