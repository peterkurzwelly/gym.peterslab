/**
 * Regression tests for the engine review fixes (2026-11-08) and D18 (training in the week before the block).
 * Each describe names the finding or decision it pins down.
 */
import { describe, expect, it } from "vitest";
import { computeState, planSession, summarizeSession } from "../../src/index";
import type { EngineState } from "../../src/index";
import type { Part, SetTuple } from "./helpers";
import {
  GUILT_WORDS,
  at,
  cardio,
  checkin,
  day,
  dayLog,
  intervals,
  makeCtx,
  must,
  planned,
  repsAt,
  sets,
  steadyWeeks,
  strength,
  topSets,
  walk,
  weekId,
  workSets,
} from "./helpers";

const nudge = (s: EngineState, kind: string) => s.nudges.find((n) => n.kind === kind);
const volumeFlags = (s: EngineState) => s.flags.filter((f) => f.kind === "volume_low" || f.kind === "volume_high");

// ---------------------------------------------------------------- never miss twice (D19)

describe("D19 · never miss twice counts inside the week", () => {
  // Peter's planned week 1: A Mon 18:00, B Wed 18:00, C Sat 10:00, intervals Sun. Target reached.
  const week1: Part[] = [
    strength({ code: "A", date: day(1, "mon"), log: dayLog("A", 0) }),
    strength({ code: "B", date: day(1, "wed"), log: dayLog("B", 0) }),
    strength({ code: "C", date: day(1, "sat"), time: "10:00", log: dayLog("C", 0) }),
    intervals(day(1, "sun")),
  ];

  it("a target week then Monday: no nudge and the full version leads, morning and evening alike", () => {
    for (const hhmm of ["11:00", "18:00"]) {
      const state = computeState(makeCtx({ now: at(day(2, "mon"), hhmm), history: week1 }));
      expect(state.weeks[0]?.status).toBe("target");
      expect(nudge(state, "never_miss_twice"), hhmm).toBeUndefined();
      expect([state.next.recommended_mode, state.next.recommended_rule_id], hhmm).toEqual(["full", null]);
    }
  });

  it("the 48 h then run from Monday 00:00: Tuesday 23:00 no, Wednesday 01:00 yes", () => {
    expect(nudge(computeState(makeCtx({ now: at(day(2, "tue"), "23:00"), history: week1 })), "never_miss_twice")).toBeUndefined();
    const wed = computeState(makeCtx({ now: at(day(2, "wed"), "01:00"), history: week1 }));
    expect(must(nudge(wed, "never_miss_twice")).action).toEqual({ mode: "short", code: "A" });
    expect(wed.next.recommended_rule_id).toBe("event.never_miss_twice");
  });

  it("inside the week it still measures from the last session (Monday 18:00 → Wednesday 19:00)", () => {
    const h = [...week1, strength({ code: "A", date: day(2, "mon"), log: dayLog("A", 1) })];
    expect(nudge(computeState(makeCtx({ now: at(day(2, "wed"), "18:00"), history: h })), "never_miss_twice")).toBeUndefined();
    expect(nudge(computeState(makeCtx({ now: at(day(2, "wed"), "19:00"), history: h })), "never_miss_twice")).toBeDefined();
  });
});

// ---------------------------------------------------------------- bodyweight below range (reactive deload)

describe("Review fix · bodyweight below range does not pull a deload or reset to 0 kg", () => {
  // Weeks 1 and 2: every loaded lift in range, but pull-ups 5,4(,4) at bodyweight and knee raises 8,8 (range 10 to 15).
  const b = (cw: number, pull: SetTuple[]) =>
    strength({ code: "B", date: day(cw, "wed"), log: { ...dayLog("B", cw - 1), pull_up: pull, hanging_knee_raise: sets(2, 0, 8, 3) } });
  const history: Part[] = [
    strength({ code: "A", date: day(1, "mon"), log: dayLog("A", 0) }),
    b(1, repsAt(0, [5, 4], 3)),
    strength({ code: "C", date: day(1, "fri"), log: dayLog("C", 0) }),
    strength({ code: "A", date: day(2, "mon"), log: dayLog("A", 1) }),
    b(2, repsAt(0, [5, 4, 4], 3)),
  ];

  it("no reactive deload: week 3 stays a return week and week 8 stays the deload", () => {
    const state = computeState(makeCtx({ now: at(day(3, "mon"), "07:00"), history }));
    expect(state.block.reactive_deload_used).toBe(false);
    expect(state.block.deload_week).toBe(8);
    expect(state.current_week.phase).toBe("return");
    expect(state.flags.filter((f) => f.kind === "reactive_deload")).toEqual([]);
  });

  it("pull-up below range twice at bodyweight: hold at rep_min and point at the lat pulldown (dp.bodyweight_hold)", () => {
    const ctx = makeCtx({ now: at(day(3, "mon"), "07:00"), history });
    const change = must(summarizeSession(ctx, `s_${day(2, "wed")}_B`).changes.find((c) => c.exercise_id === "pull_up"));
    expect(change.rule_id).toBe("dp.bodyweight_hold");
    expect(change.to).toEqual({ weight: 0, reps: 6 });
    expect(change.explanation).toContain("Lat pulldown");
    expect(change.explanation).not.toMatch(/0 kg|reset/);
    const pe = planned(planSession(ctx, { code: "B", mode: "full" }), "B3");
    expect(workSets(pe).map((s) => [s.weight, s.reps])[0]).toEqual([0, 6]);
    expect(pe.reason).toContain("Lat pulldown");
    expect(pe.reason).not.toMatch(GUILT_WORDS);
  });

  it("loaded lifts below range twice still pull the deload forward", () => {
    const a = (date: string) =>
      strength({ code: "A", date, log: { back_squat: [[80, 4, 2], [80, 4, 2], [80, 3, 2]], bench_press: [[70, 4, 2], [70, 4, 2], [70, 3, 2]] } });
    const state = computeState(makeCtx({ now: at(day(3, "mon"), "07:00"), history: [...history.slice(0, 3), a(day(2, "mon")), a(day(2, "thu"))] }));
    expect(state.block.deload_week).toBe(3);
  });
});

// ---------------------------------------------------------------- comeback + short (D20)

describe("D20 · a short comeback session does not stack both set reductions", () => {
  // Steady weeks 1 and 2, week 3 empty (zero), now week 4 (training week 3: 3 sets on main and starred lifts).
  const history = steadyWeeks(1, 2);

  it("Monday after the zero week: no never miss twice, so the full version leads and gives the comeback plan", () => {
    const state = computeState(makeCtx({ now: at(day(4, "mon"), "18:00"), history }));
    expect(nudge(state, "comeback")).toBeDefined();
    expect(nudge(state, "never_miss_twice")).toBeUndefined();
    expect(state.next.recommended_mode).toBe("full");
    expect(state.next.plan.flags).toContain("comeback");
    expect(workSets(planned(state.next.plan, "A1")).length).toBe(2); // 3 − 1
  });

  it("the short version on a comeback takes one reduction, not two", () => {
    const ctx = makeCtx({ now: at(day(4, "wed"), "18:00"), history });
    const state = computeState(ctx);
    expect(state.next.recommended_mode).toBe("short"); // never miss twice is on by Wednesday
    const short = planSession(ctx, { code: "A", mode: "short" });
    expect(short.flags).toContain("comeback");
    for (const pe of short.exercises) expect(workSets(pe).length, pe.prescription_id).toBe(2); // 3 − max(1, 1)
  });
});

// ---------------------------------------------------------------- consolidate top set

describe("Review fix · the top set is always heavier than the work sets", () => {
  it("a lagging e1RM is floored at one step above today's work weight", () => {
    // Squat 100 × 5 at RIR 0: e1RM 116.67 → 5 @ RIR 1 would be 95, below the 100 × 8 work target.
    const ctx = makeCtx({
      now: at(day(1, "wed"), "08:00"),
      history: [strength({ code: "A", date: day(1, "mon"), log: { back_squat: sets(2, 100, 5, 0) } })],
      program: (p) => void (must(p.phases.find((x) => x.name === "return")).top_set = { main_lifts: true, rir: 1 }),
    });
    const pe = planned(planSession(ctx, { code: "A", mode: "full" }), "A1");
    expect(workSets(pe)[0]).toMatchObject({ weight: 100, reps: 8 });
    expect(topSets(pe)[0]).toMatchObject({ weight: 105, reps: 5, rir: 1 }); // 100 + step 5
  });
});

// ---------------------------------------------------------------- volume flags

describe("Review fix · volume flags skip zero weeks and the program's own prescription", () => {
  it("a zero week in a band phase raises no '0 sets' flags", () => {
    const state = computeState(makeCtx({ now: at(day(6, "mon"), "07:00"), history: steadyWeeks(1, 4) }));
    expect(state.weeks[4]).toMatchObject({ status: "zero", phase: "build" });
    expect(volumeFlags(state)).toEqual([]);
  });

  it("a target week done exactly as planned raises no volume flags, even where the plan sits outside the band", () => {
    let history: Part[] = steadyWeeks(1, 4);
    for (const [code, dow] of [["A", "mon"], ["B", "wed"], ["C", "fri"]] as const) {
      const plan = planSession(makeCtx({ now: at(day(5, dow), "07:00"), history }), { code, mode: "full" });
      const log: Record<string, SetTuple[]> = {};
      for (const pe of plan.exercises) log[pe.exercise_id] = workSets(pe).map((s) => [s.weight ?? 20, s.reps, 3] as const);
      history = [...history, strength({ code, date: day(5, dow), log })];
    }
    history = [...history, intervals(day(5, "sat"), 5)];
    const state = computeState(makeCtx({ now: at(day(6, "mon"), "07:00"), history }));
    expect(state.weeks[4]).toMatchObject({ status: "target", phase: "build" });
    const w5 = must(state.volume.find((v) => v.week_id === weekId(5)));
    expect(Object.values(w5.by_muscle).some((v) => v < 8 || v > 10)).toBe(true);
    expect(volumeFlags(state)).toEqual([]);
  });
});

// ---------------------------------------------------------------- extension weeks

describe("Review fix · extension_weeks includes the weeks a long break restart took back", () => {
  it("steady weeks 1 to 3, one session in week 4, week 5 empty, back in week 6 → training week 2, 4 weeks longer", () => {
    const history = [steadyWeeks(1, 3), strength({ code: "A", date: day(4, "mon"), log: dayLog("A", 3) }), strength({ code: "B", date: day(6, "tue"), log: dayLog("B", 3) })];
    const state = computeState(makeCtx({ now: at(day(6, "wed"), "07:00"), history }));
    expect(state.weeks.map((w) => w.training_week)).toEqual([1, 2, 3, 4, 5, 2]);
    expect(state.block.extension_weeks).toBe(4);
  });
});

// ---------------------------------------------------------------- readiness banner

describe("Review fix · the readiness banner matches what changed", () => {
  it("shows the real load cut, not the configured percentage (65 × 0.95 = 61.75 → 60)", () => {
    const history = [
      strength({ code: "A", date: day(1, "mon"), log: { back_squat: sets(2, 65, 6, 3) } }),
      strength({ code: "B", date: day(1, "thu"), log: dayLog("B", 0) }),
      checkin(day(2, "mon"), [2, 3, 2, 2]),
    ];
    const plan = planSession(makeCtx({ now: at(day(2, "mon"), "08:00"), history }), { code: "A", mode: "full" });
    expect(workSets(planned(plan, "A1"))[0]?.weight).toBe(60);
    expect(must(plan.adjustments.find((a) => a.rule_id === "event.readiness")).text).toBe("Sleep 2/5: Back squat 65 → 60 kg, 1 set dropped per exercise.");
  });

  it("claims no dropped set when the short version is already at the minimum and nothing was cut", () => {
    // Week 1 short: 2 − 1 = 1 set per exercise (readiness min 1), first exercise still a calibration (no weight).
    const history = [strength({ code: "A", date: day(1, "mon"), log: dayLog("A", 0) }), checkin(day(1, "thu"), [2, 2, 2, 3])];
    const ctx = makeCtx({ now: at(day(1, "thu"), "19:30"), history });
    const before = planSession(makeCtx({ now: at(day(1, "thu"), "19:30"), history: history.slice(0, 1) }), { code: "B", mode: "short" });
    const plan = planSession(ctx, { code: "B", mode: "short" });
    expect(plan.exercises.map((e) => workSets(e).length)).toEqual(before.exercises.map((e) => workSets(e).length));
    const text = must(plan.adjustments.find((a) => a.rule_id === "event.readiness")).text;
    expect(text).toMatch(/^Sleep 2\/5: /);
    expect(text).not.toMatch(/dropped|−|→/);
  });
});

// ---------------------------------------------------------------- PRs

describe("Review fix · personal bests come from eligible sessions only and leave out bodyweight", () => {
  const bench = (date: string, w: number, mode?: "comeback") =>
    strength({ code: "A", date, ...(mode ? { mode } : {}), log: { bench_press: sets(2, w, 6, 3) } });
  const pull = (date: string, w: number) => strength({ code: "B", date, log: { pull_up: sets(2, w, 8, 3) } });
  const history = [bench(day(1, "mon"), 50), pull(day(1, "tue"), 2.5), bench(day(1, "wed"), 55, "comeback"), pull(day(1, "thu"), 5), bench(day(1, "fri"), 55)];
  const ctx = makeCtx({ now: at(day(1, "sat"), "08:00"), history });

  it("a hold session (comeback) lists no PR; the next eligible one lists it once", () => {
    expect(summarizeSession(ctx, `s_${day(1, "wed")}_A`).prs).toEqual([]);
    const prs = summarizeSession(ctx, `s_${day(1, "fri")}_A`).prs;
    expect(prs.map((p) => p.exercise_id)).toEqual(["bench_press"]);
    expect(prs[0]?.previous_best).toBeCloseTo(50 * (1 + 9 / 30), 2);
  });

  it("added load on a bodyweight exercise is not a personal best", () => {
    expect(summarizeSession(ctx, `s_${day(1, "thu")}_B`).prs).toEqual([]);
  });
});

// ---------------------------------------------------------------- cardio after midnight

describe("Review fix · a session's cardio minutes stay in the session's week", () => {
  it("Sunday 23:30 intervals saved after midnight (log dated Monday) count in week 1 for both sessions and WHO minutes", () => {
    const c = cardio({ date: day(1, "sun"), time: "23:30", minutes: 26, intensity: "hard", hard_minutes: 8 });
    c.cardioLogs = c.cardioLogs!.map((l) => ({ ...l, date: day(2, "mon") }));
    const state = computeState(makeCtx({ now: at(day(2, "mon"), "08:00"), history: [c] }));
    expect(state.weeks[0]?.cardio_done).toBe(1);
    expect(must(state.volume.find((v) => v.week_id === weekId(1))).who_minutes).toBe(34); // 8 × 2 + 18
    expect(must(state.volume.find((v) => v.week_id === weekId(2))).who_minutes).toBe(0);
  });
});

// ---------------------------------------------------------------- D18

describe("D18 · sessions in the week before the block count toward week 1", () => {
  it("before the block with no history, Today offers Session A in training week 1 (return phase), full version", () => {
    const state = computeState(makeCtx({ now: at(day(0, "sun"), "20:00") }));
    expect(state.next.code).toBe("A");
    expect(state.next.plan.training_week).toBe(1);
    expect(state.next.plan.phase).toBe("return");
    expect(state.next.recommended_mode).toBe("full");
    expect(state.current_week).toMatchObject({ id: weekId(1), strength_done: 0, status: "in_progress" });
  });

  it("Session A on the Sunday before counts toward week 1 and progresses as week 1 of the return phase", () => {
    const a = strength({ code: "A", date: day(0, "sun"), time: "10:00", log: { back_squat: sets(2, 60, 8, 3) } });
    const sunday = computeState(makeCtx({ now: at(day(0, "sun"), "12:00"), history: [a] }));
    expect(sunday.current_week).toMatchObject({ id: weekId(1), strength_done: 1, session_ids: [a.id] });
    expect(sunday.next).toMatchObject({ code: "B", done_today: true });

    const ctx = makeCtx({ now: at(day(1, "mon"), "07:00"), history: [a] });
    const state = computeState(ctx);
    expect(state.weeks[0]).toMatchObject({ calendar_index: 1, start_date: day(1, "mon"), strength_done: 1, session_ids: [a.id] });
    expect(state.next.code).toBe("B");
    const change = must(summarizeSession(ctx, must(a.id)).changes[0]);
    expect(change.rule_id).toBe("dp.increase");
    expect(change.to).toEqual({ weight: 65, reps: 5 }); // 60 + step 5, after increase at rep_min
    const d = must(state.decisions.find((x) => x.id === change.decision_id));
    expect(d.inputs_snapshot).toMatchObject({ phase: "return", target_rir: 3 });
    expect(state.stats["back_squat"]?.first_e1rm).toBeCloseTo(60 * (1 + 11 / 30), 2);
  });

  it("floor, target and cardio from the week before: week 1 can be reached before Monday", () => {
    const history = [
      cardio({ date: day(0, "fri"), minutes: 26, intensity: "hard", hard_minutes: 8 }),
      strength({ code: "A", date: day(0, "sat"), time: "10:00", log: dayLog("A", 0) }),
      strength({ code: "B", date: day(0, "sun"), time: "10:00", log: dayLog("B", 0) }),
      walk(day(0, "sun"), 40),
    ];
    const mon = computeState(makeCtx({ now: at(day(1, "mon"), "07:00"), history }));
    expect(mon.current_week).toMatchObject({ strength_done: 2, cardio_done: 1, floor_reached: true, status: "floor", walking_minutes: 40 });
    expect(nudge(computeState(makeCtx({ now: at(day(1, "wed"), "20:00"), history })), "never_miss_twice")).toBeUndefined();

    const withC = [...history, strength({ code: "C", date: day(1, "wed"), log: dayLog("C", 0) })];
    const next = computeState(makeCtx({ now: at(day(2, "mon"), "07:00"), history: withC }));
    expect(next.weeks[0]).toMatchObject({ status: "target", strength_done: 3, cardio_done: 1 });
    expect(next.current_week.training_week).toBe(2);
  });

  it("only the 7 days before the block's Monday: a session 8 days before belongs to no week", () => {
    const early = strength({ code: "A", date: day(-1, "sun"), log: dayLog("A", 0) });
    const edge = strength({ code: "B", date: day(0, "mon"), log: dayLog("B", 0) });
    const state = computeState(makeCtx({ now: at(day(1, "mon"), "07:00"), history: [early, edge] }));
    expect(state.weeks.length).toBe(1);
    expect(state.weeks[0]?.session_ids).toEqual([edge.id]);
  });
});
