/**
 * Stand-in for @gym/engine in data layer tests (the real engine is built separately).
 * Use: vi.mock("@gym/engine", async () => (await import("./engineMock")).engineMock);
 */
import { vi } from "vitest";
import type { Decision, EngineConfig, ProgramConfig, Settings } from "@gym/schema";
import type { EngineContext, EngineState, PlanOptions, SessionSummary } from "@gym/engine";
import engineJson from "../../../../config/engine.json";
import programJson from "../../../../config/program.json";

export const testConfig = engineJson as unknown as EngineConfig;
export const testProgram = programJson as unknown as ProgramConfig;

export function makeSettings(now: string): Settings {
  return {
    id: "settings",
    block_start_date: "2026-11-02",
    block_number: 1,
    timezone: "Europe/Stockholm",
    limitations: [],
    remembered_weights: {},
    interval_modality: "both",
    session_order: ["A", "B", "C"],
    block_swaps: {},
    rest_overrides: {},
    increment_overrides: {},
    start_pct: 0.6,
    sound: true,
    evening_hour: 19,
    week_killers: ["work_peaks", "travel", "evenings"],
    updated_at: now,
    deleted_at: null,
  };
}

export function makeDecision(sessionId: string, exerciseId: string, explanation = "All sets hit top of range: +2.5 kg."): Decision {
  return {
    id: `d:${sessionId}:${exerciseId}@6-8`,
    date: "2026-11-08T10:00:00.000Z",
    rule_id: "dp.increase",
    engine_version: "test",
    session_id: sessionId,
    exercise_id: exerciseId,
    inputs_snapshot: { sets: [8, 8, 8] },
    output: { weight: 82.5, reps: 6 },
    explanation,
    updated_at: "2026-11-08T10:00:00.000Z",
    deleted_at: null,
  };
}

/** Decisions for every distinct exercise logged in the session. */
function summaryFor(ctx: EngineContext, sessionId: string): SessionSummary {
  const exercises = [
    ...new Set(ctx.history.setLogs.filter((s) => s.session_id === sessionId).map((s) => s.exercise_id)),
  ];
  return {
    session_id: sessionId,
    decisions: exercises.map((e) => makeDecision(sessionId, e)),
  } as unknown as SessionSummary;
}

export const engineMock = {
  ENGINE_VERSION: "test",
  loadDefaults: vi.fn(() => ({ config: testConfig, program: testProgram, exercises: {} })),
  defaultSettings: vi.fn((_c: EngineConfig, _p: ProgramConfig, now: string) => makeSettings(now)),
  computeState: vi.fn(
    (ctx: EngineContext) =>
      ({
        today: ctx.now.slice(0, 10),
        auto_finished: [],
        decisions: [],
        cardio: { kind: "easy" },
        sessions_seen: ctx.history.sessions.length,
      }) as unknown as EngineState,
  ),
  planSession: vi.fn((_ctx: EngineContext, _opts: PlanOptions) => ({ exercises: [] })),
  planCardio: vi.fn(() => ({ kind: "easy" })),
  spacingWarnings: vi.fn(() => []),
  summarizeSession: vi.fn(summaryFor),
  e1rm: vi.fn((w: number, reps: number, rir: number | null, divisor = 30) => w * (1 + (reps + (rir ?? 0)) / divisor)),
  roundToIncrement: vi.fn((v: number) => v),
  localDate: vi.fn((iso: string) => iso.slice(0, 10)),
  weekStart: vi.fn((d: string) => d),
  daysBetween: vi.fn(() => 0),
};

/** Restore default mock implementations between tests. */
export function resetEngineMock(): void {
  engineMock.summarizeSession.mockImplementation(summaryFor);
  engineMock.computeState.mockImplementation(
    (ctx: EngineContext) =>
      ({
        today: ctx.now.slice(0, 10),
        auto_finished: [],
        decisions: [],
        cardio: { kind: "easy" },
        sessions_seen: ctx.history.sessions.length,
      }) as unknown as EngineState,
  );
}
