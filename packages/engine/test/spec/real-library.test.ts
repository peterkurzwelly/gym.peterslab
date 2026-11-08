/**
 * The bundled defaults as the app ships them: config/engine.json, config/program.json and the real
 * data/exercises.json (not the inline spec library). A fresh install must plan Session A with a reason on every target.
 */
import { describe, expect, it } from "vitest";
import { Decision } from "@gym/schema";
import type { DayCode, SessionMode } from "@gym/schema";
import { computeState, defaultSettings, loadDefaults, planCardio, planSession } from "../../src/index";
import type { EngineContext, EngineState, SessionPlan } from "../../src/index";
import libraryJson from "../../../../data/exercises.json" with { type: "json" };
import { GUILT_WORDS, emptyHistory, must } from "./helpers";

const BEFORE_BLOCK = "2026-11-08T12:00:00Z"; // Sunday, the day before the block starts
const FIRST_MORNING = "2026-11-09T07:00:00Z"; // Monday 08:00 Stockholm, block day 1

function freshCtx(now: string, limitations: string[] = []): EngineContext {
  const d = loadDefaults();
  return {
    config: d.config,
    program: d.program,
    exercises: d.exercises,
    settings: { ...defaultSettings(d.config, d.program, now), limitations },
    history: emptyHistory(),
    now,
  };
}

function expectPlanExplained(plan: SessionPlan, label: string) {
  expect(plan.exercises.length, label).toBeGreaterThan(0);
  for (const d of plan.decisions) expect(() => Decision.parse(d), d.id).not.toThrow();
  for (const pe of plan.exercises) {
    const where = `${label} ${pe.prescription_id}`;
    expect(pe.reason.trim().length, where).toBeGreaterThan(0);
    expect(pe.reason, where).not.toMatch(GUILT_WORDS);
    expect(pe.rule_id.length, where).toBeGreaterThan(0);
    const d = must(plan.decisions.find((x) => x.id === pe.decision_id), `${where}: decision in plan`);
    expect([d.rule_id, d.explanation], where).toEqual([pe.rule_id, pe.reason]);
    expect(pe.sets.length, where).toBeGreaterThan(0);
  }
}

function expectFreshState(s: EngineState, today: string) {
  expect(s.today).toBe(today);
  expect(s.next.code).toBe("A");
  expect(s.next.reason).toBe("First session of the block");
  expect(s.next.done_today).toBe(false);
  expect(s.next.plan.code).toBe("A");
  expect(s.next.plan.exercises.map((e) => e.prescription_id)).toEqual(["A1", "A2", "A3", "A4", "A5", "A6"]);
  expectPlanExplained(s.next.plan, "next");
  const ids = new Set(s.decisions.map((d) => d.id));
  for (const pe of s.next.plan.exercises) expect(ids.has(pe.decision_id), pe.decision_id).toBe(true);
  for (const d of s.decisions) expect(() => Decision.parse(d), d.id).not.toThrow();
  expect(s.block).toMatchObject({ training_week: 1, phase: "return", complete: false, extension_weeks: 0, deload_week: 8 });
  expect(s.weeks.map((w) => [w.id, w.status, w.is_current])).toEqual([["wk_2026-11-09", "in_progress", true]]);
  expect(s.active).toBeNull();
  expect(s.flags).toEqual([]);
  expect(s.cardio).toMatchObject({ kind: "intervals", rule_id: "cardio.intervals", counts_as: "target" });
  expect(s.totals).toMatchObject({ sessions: 0, sets: 0, kg_lifted: 0 });
}

describe("bundled defaults with the real exercise library", () => {
  it("loadDefaults() validates both configs and data/exercises.json and covers every program exercise", () => {
    const d = loadDefaults();
    expect(Object.keys(d.exercises).length).toBe(libraryJson.exercises.length);
    for (const day of d.program.days)
      for (const p of day.prescriptions)
        for (const id of [p.exercise_id, ...p.alternatives.map((a) => a.exercise_id)]) expect(d.exercises[id], `${p.id} ${id}`).toBeDefined();
    expect(loadDefaults()).toBe(d); // cached
  });

  it("fresh install, the day before the block starts (2026-11-08 12:00Z): next is Session A, every target explained", () => {
    expectFreshState(computeState(freshCtx(BEFORE_BLOCK)), "2026-11-08");
  });

  it("fresh install, block day 1 (2026-11-09 07:00Z): next is Session A in return week 1, every target explained", () => {
    const s = computeState(freshCtx(FIRST_MORNING));
    expectFreshState(s, "2026-11-09");
    // Week 1 of the return phase: 2 sets each, nothing known yet, so pick a weight (bodyweight work starts at 0).
    for (const pe of s.next.plan.exercises) {
      expect(pe.sets.length, pe.prescription_id).toBe(2);
      expect(["calib.pick", "calib.bodyweight"], pe.prescription_id).toContain(pe.rule_id);
    }
  });

  it("every day and mode plans cleanly on the real library, cardio included", () => {
    const ctx = freshCtx(FIRST_MORNING);
    const cases: [DayCode, SessionMode][] = [["A", "full"], ["B", "full"], ["C", "full"], ["A", "short"], ["B", "short"], ["C", "short"], ["TRAVEL", "travel"]];
    for (const [code, mode] of cases) expectPlanExplained(planSession(ctx, { code, mode }), `${code} ${mode}`);
    const cardio = planCardio(ctx);
    expect(cardio.modality_options).toEqual(["bike", "rower"]);
    expect(cardio.reason.length).toBeGreaterThan(0);
  });

  it("limitations on the real library: knee_friendly, shoulder_symmetry and both together", () => {
    const swapsFor = (limitations: string[]) => {
      const ctx = freshCtx(FIRST_MORNING, limitations);
      const out: Record<string, string> = {};
      for (const [code, mode] of [["A", "full"], ["B", "full"], ["C", "full"], ["TRAVEL", "travel"]] as const) {
        const plan = planSession(ctx, { code, mode });
        expectPlanExplained(plan, `${limitations.join("+")} ${code}`);
        for (const pe of plan.exercises) if (pe.swapped) out[pe.prescription_id] = `${pe.primary_exercise_id} -> ${pe.exercise_id}`;
      }
      return out;
    };
    const knee = { A1: "back_squat -> hack_squat", B4: "bulgarian_split_squat -> step_up" };
    const shoulder = {
      A2: "bench_press -> dumbbell_bench_press",
      B2: "overhead_press -> dumbbell_shoulder_press",
      C3: "seated_cable_row -> one_arm_dumbbell_row",
    };
    expect(swapsFor(["knee_friendly"])).toEqual(knee);
    expect(swapsFor(["shoulder_symmetry"])).toEqual(shoulder);
    // Both: each swap follows the limitation that triggered it, so B4 still gets the knee friendly step-up.
    expect(swapsFor(["knee_friendly", "shoulder_symmetry"])).toEqual({ ...knee, ...shoulder });
  });
});
