/**
 * @gym/engine: pure, deterministic training engine. No I/O, no clock, no randomness.
 * Same EngineContext in, same output out. Rule semantics: docs/ENGINE_RULES.md.
 *
 * CONTRACT: the function signatures below are what the web app and tests code against.
 * Implementations live in sibling modules and are re-exported here.
 */
import type { CardioPlan, EngineContext, PlanOptions, SessionPlan, SessionSummary, SpacingWarning } from "./types";
import type { DayCode } from "@gym/schema";
import { analyze } from "./analysis";
import { buildCardio } from "./cardio";
import { spacing } from "./events";
import { buildPlan } from "./planning";
import { summarize } from "./summary";

export * from "./types";

// ENGINE_VERSION: engine version string, read from config/engine.json (engine_version).
// loadDefaults(): parse and validate the bundled config/engine.json, config/program.json and data/exercises.json.
//   Throws with a readable message when a file fails validation.
// defaultSettings(config, program, nowIso): settings for a fresh install.
export { ENGINE_VERSION, loadDefaults, defaultSettings } from "./defaults";

// computeState(ctx): everything the UI needs in one call. Pure and deterministic.
export { computeState } from "./state";

// computeBody(input): body and fuel in one call (weight trend, calorie / protein / steps targets, pace,
//   weekly adaptive adjustment). Separate from computeState: it reads body logs and settings only. ENGINE_RULES 10.
export { computeBody } from "./body";

/** Plan a session (any day code and mode) as of opts.at ?? ctx.now. */
export function planSession(ctx: EngineContext, opts: PlanOptions): SessionPlan {
  return buildPlan(analyze(ctx, { at: opts.at, excludeSessionId: opts.sessionId }), opts);
}

/** Cardio plan for the current training week, with readiness swap and spacing warnings applied. */
export function planCardio(ctx: EngineContext, opts?: { at?: string }): CardioPlan {
  return buildCardio(analyze(ctx, { at: opts?.at })).plan;
}

/**
 * Warnings (never blocks) for starting a session of this kind at opts.at ?? ctx.now.
 * Cardio intensity defaults to today's cardio plan (intervals are hard; deload, readiness swap and bonus are easy).
 */
export function spacingWarnings(ctx: EngineContext, code: DayCode, opts?: { at?: string; intensity?: "easy" | "hard" }): SpacingWarning[] {
  const an = analyze(ctx, { at: opts?.at });
  const intensity = opts?.intensity ?? (code === "CARDIO" && buildCardio(an).plan.kind === "easy" ? "easy" : "hard");
  return spacing(an, code, intensity);
}

/** What changed for next time and why, for a finished session (ctx.history must include it). */
export function summarizeSession(ctx: EngineContext, sessionId: string): SessionSummary {
  return summarize(analyze(ctx, { forceFinishedId: sessionId }), sessionId);
}

// ---- calculations (exported for UI and tests) ----
// e1rm(weight, reps, rir, divisor?): Epley with RIR, weight × (1 + (reps + rir) / divisor). rir null counts as 0.
// roundToIncrement(value, increment, mode?): nearest multiple of increment, or down / up. 2 decimals, no float noise.
export { e1rm, roundToIncrement } from "./calc";

// localDate(iso, tz): local calendar date "YYYY-MM-DD" of an instant. weekStart(date): its Monday.
// daysBetween(a, b): whole days b − a.
export { localDate, weekStart, daysBetween } from "./dates";
