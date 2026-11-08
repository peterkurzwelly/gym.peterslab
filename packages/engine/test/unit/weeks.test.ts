import { describe, expect, test } from "vitest";
import { analyze } from "../../src/analysis";
import { computeState } from "../../src/index";
import { History, at, ctxOf, day } from "./fixtures";

const A = ["A1", "A2"];

describe("week counts and status", () => {
  test("floor, target, bonus and walks", () => {
    const h = new History();
    h.simple("A", day(0), A, [[60, 8]]);
    h.simple("B", day(2), ["B1"], [[80, 5]]);
    h.simple("C", day(7), ["C1"], [[100, 10]]);
    h.simple("A", day(8), A, [[60, 8]]);
    h.cardio(day(9));
    h.simple("B", day(10), ["B1"], [[80, 5]]);
    h.cardio(day(11));
    h.walk(day(12), 40);
    const { wf } = analyze(ctxOf(h, at(day(13), "20:00")));
    const [w1, w2] = wf.weeks;
    expect(w1!.status).toBe("floor");
    expect(w1!.is_complete).toBe(true);
    expect(w1!.floor_reached).toBe(true);
    expect(w1!.target_reached).toBe(false);
    expect(w2!.status).toBe("target");
    expect(w2!.strength_done).toBe(3);
    expect(w2!.cardio_done).toBe(2);
    expect(w2!.bonus_done).toBe(1);
    expect(w2!.walking_minutes).toBe(40);
    expect(w2!.to_floor_text).toBeNull();
    expect(w2!.to_target_text).toBeNull();
  });

  test("current week texts and in_progress", () => {
    const h = new History();
    h.simple("A", day(0), A, [[60, 8]]);
    const st = computeState(ctxOf(h, at(day(1))));
    expect(st.current_week.status).toBe("in_progress");
    expect(st.current_week.to_floor_text).toBe("1 more strength session reaches the floor");
    expect(st.current_week.to_target_text).toBe("2 more strength sessions and 1 cardio session reach the target");
  });

  test("travel counts toward the floor; walks never count as sessions", () => {
    const h = new History();
    h.simple("A", day(0), A, [[60, 8]]);
    h.session({ code: "TRAVEL", date: day(2), exercises: [{ pid: "T1", sets: [[16, 12]] }] });
    h.walk(day(3), 60);
    const { wf } = analyze(ctxOf(h, at(day(4))));
    expect(wf.current.strength_done).toBe(2);
    expect(wf.current.floor_reached).toBe(true);
    expect(wf.current.session_ids).toHaveLength(2);
  });

  test("completed below floor vs zero (walk only week is zero)", () => {
    const h = new History();
    h.simple("A", day(0), A, [[60, 8]]);
    h.walk(day(8), 45);
    const { wf } = analyze(ctxOf(h, at(day(15))));
    expect(wf.weeks.map((w) => w.status)).toEqual(["below_floor", "zero", "in_progress"]);
    expect(wf.weeks[1]!.is_zero).toBe(true);
  });

  test("sessions near midnight belong to the week of their local start date", () => {
    const h = new History();
    const sun = h.session({ code: "A", date: day(6), time: "23:30", exercises: [{ pid: "A1", sets: [[60, 8]] }] });
    const mon = h.session({ code: "B", date: day(7), time: "00:30", exercises: [{ pid: "B1", sets: [[80, 5]] }] });
    expect(mon.started_at).toBe("2026-11-15T23:30:00.000Z"); // still Sunday in UTC
    const { wf } = analyze(ctxOf(h, at(day(8))));
    expect(wf.weeks[0]!.session_ids).toEqual([sun.id]);
    expect(wf.weeks[1]!.session_ids).toEqual([mon.id]);
  });

  test("today before the block start: week 1 is shown as current", () => {
    const st = computeState(ctxOf(new History(), at(day(-1), "12:00")));
    expect(st.weeks).toHaveLength(1);
    expect(st.current_week.start_date).toBe(day(0));
    expect(st.block.training_week).toBe(1);
    expect(st.block.dots[0]).toBe("current");
  });

  test("block start mid week: week 1 starts on that week's Monday", () => {
    const st = computeState(ctxOf(new History(), at(day(9)), { block_start_date: day(2) }));
    expect(st.weeks[0]!.start_date).toBe(day(0));
    expect(st.weeks).toHaveLength(2);
  });
});

describe("training week index", () => {
  test("a zero week does not advance the phase and extends the block", () => {
    const h = new History();
    h.simple("A", day(0), A, [[60, 8]]);
    // week 2 zero
    h.simple("B", day(14), ["B1"], [[80, 5]]);
    const { wf } = analyze(ctxOf(h, at(day(22))));
    expect(wf.weeks.map((w) => w.training_week)).toEqual([1, 2, 2, 3]);
    expect(wf.block.extension_weeks).toBe(1);
    expect(wf.block.training_week).toBe(3);
  });

  test("long break restarts at long_restart_week; prospective restart for the current week", () => {
    const h = new History();
    h.simple("A", day(0), A, [[60, 8]]);
    h.simple("B", day(7), ["B1"], [[80, 5]]);
    h.simple("C", day(14), ["C1"], [[100, 10]]);
    // Nothing in week 4 (21..27). Week 5 starts day 28: gap to day 30 is 16 days.
    const before = analyze(ctxOf(h, at(day(30), "08:00")));
    expect(before.wf.weeks.map((w) => w.training_week)).toEqual([1, 2, 3, 4, 2]);
    expect(before.wc.current.prospectiveRestart).toBe(true);

    h.simple("A", day(30), A, [[60, 8]]);
    const after = analyze(ctxOf(h, at(day(34))));
    expect(after.wf.weeks.map((w) => w.training_week)).toEqual([1, 2, 3, 4, 2]);
    expect(after.wc.weeks[4]!.restartSessionId).toBe(h.sessions.at(-1)!.id);
    const next = analyze(ctxOf(h, at(day(37))));
    expect(next.wf.block.training_week).toBe(3);
  });

  test("short gaps never restart", () => {
    const h = new History();
    for (const d of [0, 7, 14]) h.simple("A", day(d), A, [[60, 8]]);
    h.simple("B", day(28), ["B1"], [[80, 5]]); // gap 14 = short_days_max: not long
    const { wf } = analyze(ctxOf(h, at(day(29))));
    expect(wf.block.training_week).toBe(4);
  });
});

describe("repairs, streak and dots", () => {
  function zeroWeekHistory() {
    const h = new History();
    h.simple("A", day(0), A, [[60, 8]]);
    h.simple("B", day(2), ["B1"], [[80, 5]]);
    // week 2 (7..13) zero
    h.simple("C", day(14), ["C1"], [[100, 10]]);
    h.simple("A", day(15), A, [[60, 8]]);
    h.simple("B", day(16), ["B1"], [[80, 5]]);
    h.cardio(day(17));
    return h;
  }

  test("an unrepaired zero week can be repaired, breaks the run", () => {
    const st = computeState(ctxOf(zeroWeekHistory(), at(day(22))));
    expect(st.weeks[1]!.can_repair).toBe(true);
    expect(st.streak).toMatchObject({ weeks_without_zero: 2, zero_weeks: 1, repairs_used: 0, current_run: 1, best_run: 1, floor_weeks: 2, target_weeks: 1 });
    expect(st.block.dots.slice(0, 4)).toEqual(["floor", "target", "current", "future"]);
  });

  test("a repaired zero week counts and keeps the run, but the phase still does not advance", () => {
    const h = zeroWeekHistory();
    h.repair(day(7));
    const st = computeState(ctxOf(h, at(day(22))));
    expect(st.weeks[1]!.repaired).toBe(true);
    expect(st.weeks[1]!.can_repair).toBe(false);
    expect(st.streak).toMatchObject({ weeks_without_zero: 3, zero_weeks: 1, repairs_used: 1, current_run: 3, best_run: 3 });
    expect(st.weeks.map((w) => w.training_week)).toEqual([1, 2, 2, 3]);
  });

  test("one repair per window of 4 weeks", () => {
    const h = zeroWeekHistory();
    h.repair(day(7));
    // week 4 (21..27) zero too, 2 weeks after the repaired one
    const st = computeState(ctxOf(h, at(day(29))));
    expect(st.weeks[3]!.is_zero).toBe(true);
    expect(st.weeks[3]!.can_repair).toBe(false);
    // a zero week far enough away can be repaired again
    const st2 = computeState(ctxOf(h, at(day(50))));
    expect(st2.weeks.filter((w) => w.can_repair).map((w) => w.calendar_index)).toEqual([6, 7]);
  });

  test("current week counts toward weeks without a zero once it has a session", () => {
    const h = new History();
    expect(computeState(ctxOf(h, at(day(1)))).streak.weeks_without_zero).toBe(0);
    h.cardio(day(1));
    expect(computeState(ctxOf(h, at(day(2)))).streak.weeks_without_zero).toBe(1);
  });
});
