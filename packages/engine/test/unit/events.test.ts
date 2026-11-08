import { describe, expect, test } from "vitest";
import { normalize } from "../../src/context";
import { readinessFor } from "../../src/events";
import { computeState, spacingWarnings } from "../../src/index";
import { History, at, ctxOf, day } from "./fixtures";

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
      // A zero week brings a short break too, so the weights are not the same.
      text: "Coming back is easy on purpose: one set less, lighter weights to ease in.",
      action: { mode: "comeback", code: "B" },
    });
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
