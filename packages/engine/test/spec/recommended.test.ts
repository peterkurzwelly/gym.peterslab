/**
 * SPEC 11.5 + DECISIONS D17: Peter's week killers are work peaks, travel and evenings. The engine tells the Today
 * screen which version to lead with (NextSession.recommended_mode), ENGINE_RULES 5 "Recommended version", first match:
 *   1. never miss twice nudge on (event.never_miss_twice)
 *   2. week_killers has work_peaks, floor not reached, days left in the week including today ≤ sessions needed + 1 (plan.floor_at_risk)
 *   3. week_killers has evenings, evening_hour set and the local hour ≥ it (plan.evening)
 *   else full, with null rule and reason.
 */
import { describe, expect, it } from "vitest";
import { Settings } from "@gym/schema";
import { computeState, defaultSettings } from "../../src/index";
import type { EngineContext, NextSession } from "../../src/index";
import { BASE_CONFIG, BASE_PROGRAM, GUILT_WORDS, at, day, dayLog, makeCtx, must, strength } from "./helpers";

const next = (ctx: EngineContext): NextSession => computeState(ctx).next;
const rec = (n: NextSession) => [n.recommended_mode, n.recommended_rule_id, n.recommended_reason];
const FULL = ["full", null, null];

describe("D17 · defaults", () => {
  it("D17 defaults · a fresh install has evening_hour 19 and week killers work peaks, travel and evenings", () => {
    const s = defaultSettings(BASE_CONFIG, BASE_PROGRAM, at(day(1, "mon"), "07:00"));
    expect(s.evening_hour).toBe(19);
    expect(s.week_killers).toEqual(["work_peaks", "travel", "evenings"]);
    expect(s.limitations).toEqual([]);
    expect(s.interval_modality).toBe("both");
    expect(() => Settings.parse(s)).not.toThrow();
  });
});

describe("D17 · recommended version (ENGINE_RULES 5)", () => {
  it("D17 recommended · full on a calm Monday morning", () => {
    const n = next(makeCtx({ now: at(day(1, "mon"), "07:00") }));
    expect(rec(n)).toEqual(FULL);
  });

  it("D17 recommended · branch 1: the never miss twice nudge leads with the ★ 30 min version", () => {
    const ctx = makeCtx({ now: at(day(1, "thu"), "12:00"), history: [strength({ code: "A", date: day(1, "mon"), log: dayLog("A", 0) })] });
    const state = computeState(ctx);
    const nudge = must(state.nudges.find((x) => x.kind === "never_miss_twice"));
    expect(rec(state.next)).toEqual(["short", "event.never_miss_twice", nudge.text]);
    expect(state.next.recommended_reason).toBe("Never miss twice: ★ 30 min version of B is enough today.");
  });

  it("D17 recommended · branch 2: floor at risk with work peaks (2 days left, 1 session needed)", () => {
    // A Thursday evening, now Saturday morning: 1 of 2, about 38 h since the session (no never miss twice yet).
    const history = [strength({ code: "A", date: day(1, "thu"), log: dayLog("A", 0) })];
    const sat = makeCtx({ now: at(day(1, "sat"), "08:00"), history });
    expect(computeState(sat).nudges.some((x) => x.kind === "never_miss_twice")).toBe(false);
    expect(rec(next(sat))).toEqual(["short", "plan.floor_at_risk", "Floor at risk: the 30 min version counts fully."]);
    // Friday: 3 days left > 1 + 1, nothing at risk yet.
    expect(rec(next(makeCtx({ now: at(day(1, "fri"), "08:00"), history })))).toEqual(FULL);
    // Without work peaks as a week killer the floor rule stays quiet.
    expect(rec(next(makeCtx({ now: at(day(1, "sat"), "08:00"), history, settings: { week_killers: ["travel", "evenings"] } })))).toEqual(FULL);
  });

  it("D17 recommended · branch 2: with nothing logged this week the floor is at risk from Friday (3 days ≤ 2 + 1)", () => {
    // Floor week 1, nothing yet in week 2. never_miss_twice.hours is raised so branch 1 stays out of the way.
    const history = [strength({ code: "A", date: day(1, "mon"), log: dayLog("A", 0) }), strength({ code: "B", date: day(1, "wed"), log: dayLog("B", 0) })];
    const quiet = (hhmm: string, dow: "thu" | "fri" | "sun") =>
      next(makeCtx({ now: at(day(2, dow), hhmm), history, config: (c) => void (c.never_miss_twice.hours = 500) }));
    expect(rec(quiet("08:00", "thu"))).toEqual(FULL); // 4 days left
    expect(quiet("08:00", "fri").recommended_rule_id).toBe("plan.floor_at_risk");
    expect(quiet("08:00", "sun").recommended_rule_id).toBe("plan.floor_at_risk");
    // With the default 48 h the never miss twice nudge is on by then and comes first.
    expect(next(makeCtx({ now: at(day(2, "fri"), "08:00"), history })).recommended_rule_id).toBe("event.never_miss_twice");
  });

  it("D17 recommended · branch 3: after the evening hour, with the configured hour in the text", () => {
    expect(rec(next(makeCtx({ now: at(day(1, "mon"), "19:00") })))).toEqual(["short", "plan.evening", "After 19:00: the 30 min version counts fully."]);
    expect(rec(next(makeCtx({ now: at(day(1, "mon"), "18:59") })))).toEqual(FULL);
    const at20 = (s: Partial<Settings>, hhmm: string) => next(makeCtx({ now: at(day(1, "mon"), hhmm), settings: s }));
    expect(rec(at20({ evening_hour: 20 }, "19:30"))).toEqual(FULL);
    expect(at20({ evening_hour: 20 }, "20:15").recommended_reason).toBe("After 20:00: the 30 min version counts fully.");
    expect(rec(at20({ evening_hour: null }, "22:00"))).toEqual(FULL);
    expect(rec(at20({ week_killers: ["work_peaks", "travel"] }, "22:00"))).toEqual(FULL);
  });

  it("D17 recommended · first match wins: never miss twice beats the evening rule", () => {
    // Wednesday 21:00, nothing logged since block start (69 h): branch 1, not branch 3.
    expect(next(makeCtx({ now: at(day(1, "wed"), "21:00") })).recommended_rule_id).toBe("event.never_miss_twice");
  });

  it("D17 recommended · copy is short, plain and guilt free, and the reason is a decision in the log", () => {
    const state = computeState(makeCtx({ now: at(day(1, "mon"), "20:00") }));
    const reason = must(state.next.recommended_reason);
    expect(reason).not.toMatch(GUILT_WORDS);
    expect(reason).not.toMatch(/ - | – | — /);
    const d = must(state.decisions.find((x) => x.id === `d:plan:${day(1, "mon")}:A:plan.evening`));
    expect([d.rule_id, d.explanation]).toEqual(["plan.evening", reason]);
  });
});
