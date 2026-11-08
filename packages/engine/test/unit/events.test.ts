import { describe, expect, test } from "vitest";
import { normalize } from "../../src/context";
import { readinessFor } from "../../src/events";
import { computeState, spacingWarnings } from "../../src/index";
import { History, at, ctxOf, day, withConfig } from "./fixtures";

describe("readiness", () => {
  test("average, lowest score, set drops and load cut steps", () => {
    const h = new History();
    h.checkin(day(0), 2, 2, 2, 2);
    h.checkin(day(1), 3, 1, 2, 1);
    h.checkin(day(2), 1, 1, 1, 1);
    h.checkin(day(3), 3, 3, 2, 2);
    const n = normalize(ctxOf(h, at(day(4))));
    expect(readinessFor(n, day(0))).toMatchObject({ average: 2, adjusted: true, sets_drop: 1, load_cut_pct: 0.05, lowest: { metric: "sleep", value: 2 } });
    expect(readinessFor(n, day(1))).toMatchObject({ average: 1.75, sets_drop: 1, load_cut_pct: 0.075, lowest: { metric: "soreness", value: 1 } });
    expect(readinessFor(n, day(2))).toMatchObject({ average: 1, sets_drop: 2, load_cut_pct: 0.1 });
    expect(readinessFor(n, day(3))).toMatchObject({ average: 2.5, adjusted: false, sets_drop: 0, load_cut_pct: 0 });
    expect(readinessFor(n, day(4))).toBeNull();
  });

  test("state readiness carries the banner of the next plan", () => {
    const h = new History();
    h.checkin(day(0), 2, 2, 2, 1);
    const st = computeState(ctxOf(h, at(day(0), "09:00")));
    expect(st.readiness).toMatchObject({ checkin_id: `ck_${day(0)}`, adjusted: true, cardio_swap: true });
    // No weights yet (calibration), so only the set drop is named.
    expect(st.readiness!.banner).toBe("Energy 1/5: 1 set dropped per exercise.");
  });
});

describe("nudges", () => {
  test("never miss twice: 48 h after the last strength session with the floor not reached", () => {
    const h = new History();
    h.simple("A", day(0), ["A1"], [[60, 8]]); // ends 18:45
    const early = computeState(ctxOf(h, at(day(2), "18:00")));
    expect(early.nudges.some((x) => x.kind === "never_miss_twice")).toBe(false);
    const late = computeState(ctxOf(h, at(day(2), "19:00")));
    expect(late.nudges.find((x) => x.kind === "never_miss_twice")).toEqual({
      kind: "never_miss_twice",
      rule_id: "event.never_miss_twice",
      text: "Never miss twice: ★ 30 min version of B is enough today.",
      action: { mode: "short", code: "B" },
    });
  });

  test("never miss twice counts from block start without history, and stops once the floor is reached", () => {
    expect(computeState(ctxOf(new History(), at(day(2), "01:00"))).nudges.some((x) => x.kind === "never_miss_twice")).toBe(true);
    const h = new History();
    h.simple("A", day(0), ["A1"], [[60, 8]]);
    h.simple("B", day(1), ["B1"], [[60, 5]]);
    expect(computeState(ctxOf(h, at(day(4)))).nudges.some((x) => x.kind === "never_miss_twice")).toBe(false);
  });

  test("never stack: a strength session today means done for today", () => {
    const h = new History();
    h.simple("A", day(0), ["A1"], [[60, 8]]);
    const st = computeState(ctxOf(h, at(day(0), "21:00")));
    expect(st.next).toMatchObject({ code: "B", done_today: true, reason: "Done for today. Next: Session B, whenever it fits." });
    expect(st.nudges.some((x) => x.kind === "never_miss_twice")).toBe(false);
    // Cardio the same day is fine and does not count as done.
    const c = new History();
    c.cardio(day(0));
    expect(computeState(ctxOf(c, at(day(0), "21:00"))).next.done_today).toBe(false);
  });

  test("book floor on Sundays and session free Mondays; Sunday review on Sundays", () => {
    const kinds = (h: History, d: string) => computeState(ctxOf(h, at(d, "09:00"))).nudges.map((x) => x.kind);
    const h = new History();
    h.simple("A", day(3), ["A1"], [[60, 8]]);
    h.simple("B", day(5), ["B1"], [[60, 5]]);
    expect(kinds(h, day(6))).toEqual(["book_floor", "sunday_review"]);
    expect(kinds(h, day(7))).toEqual(["book_floor"]);
    expect(kinds(h, day(8))).not.toContain("book_floor");
    h.simple("C", day(7), ["C1"], [[100, 10]]);
    expect(computeState(ctxOf(h, at(day(7), "21:00"))).nudges.map((x) => x.kind)).not.toContain("book_floor");
  });

  test("comeback nudge after a zero week", () => {
    const h = new History();
    h.simple("A", day(6), ["A1"], [[60, 8]]);
    const st = computeState(ctxOf(h, at(day(14), "09:00")));
    expect(st.nudges.find((x) => x.kind === "comeback")).toMatchObject({
      // The 8 day gap meets the short break rule, but the comeback overrides it (comeback.overrides_short_break,
      // ENGINE_RULES 4.5 rule change): same weights, and no break_resume nudge next to it.
      text: "Coming back is easy on purpose: one set less, same weights.",
      action: { mode: "comeback", code: "B" },
    });
    expect(st.nudges.some((x) => x.kind === "break_resume")).toBe(false);
  });

  test("comeback nudge with the override off: the short break lowers the weights", () => {
    const h = new History();
    h.simple("A", day(6), ["A1"], [[60, 8]]);
    const st = computeState(
      withConfig(ctxOf(h, at(day(14), "09:00")), (c) => {
        c.comeback.overrides_short_break = false;
      }),
    );
    expect(st.nudges.find((x) => x.kind === "comeback")?.text).toBe("Coming back is easy on purpose: one set less, lighter weights to ease in.");
    expect(st.nudges.some((x) => x.kind === "break_resume")).toBe(true);
  });

  test("block complete after 12 training weeks", () => {
    const h = new History();
    for (let w = 0; w < 12; w++) h.simple("C", day(w * 7), ["C1"], [[100, 10]]);
    const st = computeState(ctxOf(h, at(day(84), "09:00")));
    expect(st.block).toMatchObject({ training_week: 13, complete: true, phase: "consolidate" });
    expect(st.nudges[0]).toMatchObject({ kind: "block_complete", text: "Block done. Plan the next 12 weeks." });
    expect(st.next.plan.exercises.length).toBeGreaterThan(0);
  });
});

describe("spacing warnings", () => {
  test("three strength days in a row", () => {
    const h = new History();
    h.simple("A", day(0), ["A1"], [[60, 8]]);
    h.simple("B", day(1), ["B1"], [[60, 5]]);
    expect(spacingWarnings(ctxOf(h, at(day(2))), "C").map((w) => w.rule_id)).toEqual(["spacing.consecutive_strength"]);
    expect(spacingWarnings(ctxOf(h, at(day(3))), "C")).toEqual([]);
    expect(spacingWarnings(ctxOf(h, at(day(2))), "CARDIO", { intensity: "easy" })).toEqual([]);
  });

  test("hard cardio within 24 h before a heavy day", () => {
    const h = new History();
    h.cardio(day(1), 26, "hard", "07:00");
    expect(spacingWarnings(ctxOf(h, at(day(1), "20:00")), "A").map((w) => w.rule_id)).toEqual(["spacing.hard_cardio_before_heavy"]);
    expect(spacingWarnings(ctxOf(h, at(day(1), "20:00")), "C")).toEqual([]);
    expect(spacingWarnings(ctxOf(h, at(day(2), "09:00")), "A")).toEqual([]);
    const easy = new History();
    easy.cardio(day(1), 30, "easy", "07:00");
    expect(spacingWarnings(ctxOf(easy, at(day(1), "20:00")), "B")).toEqual([]);
  });
});

describe("flags", () => {
  test("pain, readiness trend and volume flags", () => {
    const h = new History();
    for (let w = 0; w < 5; w++) h.simple("C", day(w * 7), ["C1"], [[100, 10]]);
    h.session({ code: "A", date: day(29), exercises: [{ pid: "A2", sets: [[60, 8]], pain: true }] });
    for (const d of [36, 37, 38]) h.checkin(day(d), 2);
    const st = computeState(ctxOf(h, at(day(38), "12:00")));
    const kinds = st.flags.map((f) => f.kind);
    expect(kinds).toContain("pain");
    expect(kinds).toContain("readiness_trend");
    // Week 5 (build, a band phase) is the last completed week.
    expect(st.flags.find((f) => f.kind === "volume_low" && f.text.startsWith("Back"))?.text).toBe("Back: 0 sets last week, band is 8 to 10.");
    expect(st.flags.find((f) => f.kind === "volume_low" && f.text.startsWith("Quads"))?.text).toBe("Quads: 1 set last week, band is 8 to 10.");
  });
});

describe("recommended version (plan.recommend_short)", () => {
  const rec = (h: History, now: string, s: Parameters<typeof ctxOf>[2] = {}) => {
    const n = computeState(ctxOf(h, now, s)).next;
    return [n.recommended_mode, n.recommended_rule_id, n.recommended_reason];
  };

  test("full by default: morning, floor not at risk, no never miss twice", () => {
    expect(rec(new History(), at(day(0), "09:00"))).toEqual(["full", null, null]);
  });

  test("after the evening hour: short, with the configured hour in the text", () => {
    expect(rec(new History(), at(day(0), "19:00"))).toEqual(["short", "plan.evening", "After 19:00: the 30 min version counts fully."]);
    expect(rec(new History(), at(day(0), "20:30"), { evening_hour: 21 })).toEqual(["full", null, null]);
    expect(rec(new History(), at(day(0), "21:05"), { evening_hour: 21 })[2]).toBe("After 21:00: the 30 min version counts fully.");
    expect(rec(new History(), at(day(0), "08:00"), { evening_hour: 7 })[2]).toBe("After 07:00: the 30 min version counts fully.");
  });

  test("evening rule off: evening_hour null or evenings not a week killer", () => {
    expect(rec(new History(), at(day(0), "22:00"), { evening_hour: null })).toEqual(["full", null, null]);
    expect(rec(new History(), at(day(0), "22:00"), { week_killers: ["work_peaks", "travel"] })).toEqual(["full", null, null]);
  });

  test("not after the evening hour when a strength session is already done today", () => {
    const h = new History();
    h.simple("A", day(0), ["A1"], [[60, 8]], { time: "17:00" });
    const n = computeState(ctxOf(h, at(day(0), "20:00"))).next;
    expect(n.done_today).toBe(true);
    expect(n.recommended_mode).toBe("full");
  });

  test("floor at risk with work_peaks: days left including today ≤ sessions needed + 1", () => {
    const h = new History();
    h.simple("A", day(3), ["A1"], [[60, 8]]); // Thursday: 1 of 2
    expect(rec(h, at(day(4), "09:00"))).toEqual(["full", null, null]); // Friday: 3 days left > 2
    expect(rec(h, at(day(5), "09:00"))).toEqual(["short", "plan.floor_at_risk", "Floor at risk: the 30 min version counts fully."]); // Saturday: 2 ≤ 2
    expect(rec(h, at(day(5), "09:00"), { week_killers: ["travel", "evenings"] })).toEqual(["full", null, null]);
    // Floor reached: nothing at risk.
    h.simple("B", day(5), ["B1"], [[60, 5]], { time: "08:00" });
    expect(rec(h, at(day(6), "09:00"))).toEqual(["full", null, null]);
  });

  test("never miss twice wins over the other branches", () => {
    // 49 h after block start with nothing logged, at 20:00: never miss twice, not the evening rule.
    const r = rec(new History(), at(day(2), "20:00"));
    expect(r).toEqual(["short", "event.never_miss_twice", "Never miss twice: ★ 30 min version of A is enough today."]);
  });

  test("nothing before the block starts", () => {
    expect(rec(new History(), at(day(-1), "20:00"))).toEqual(["full", null, null]);
  });

  test("the recommendation is a decision in the state log", () => {
    const st = computeState(ctxOf(new History(), at(day(0), "20:00")));
    const d = st.decisions.find((x) => x.id === `d:plan:${day(0)}:A:plan.evening`);
    expect(d).toMatchObject({ rule_id: "plan.evening", explanation: "After 19:00: the 30 min version counts fully.", output: { recommended_mode: "short" } });
  });

  test("settings rows without the new fields get the defaults; evening_hour null stays off", () => {
    const base = ctxOf(new History(), at(day(0), "20:00"));
    const { evening_hour: _e, week_killers: _w, ...old } = base.settings;
    const legacy = computeState({ ...base, settings: old as typeof base.settings }).next;
    expect([legacy.recommended_mode, legacy.recommended_rule_id]).toEqual(["short", "plan.evening"]);
    expect(normalize({ ...base, settings: old as typeof base.settings }).settings).toMatchObject({ evening_hour: 19, week_killers: ["work_peaks", "travel", "evenings"] });
    expect(normalize(ctxOf(new History(), at(day(0)), { evening_hour: null })).settings.evening_hour).toBeNull();
  });
});
