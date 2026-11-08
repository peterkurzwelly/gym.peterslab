/**
 * @gym/engine: pure, deterministic training engine. No I/O, no clock, no randomness.
 * Same EngineContext in, same output out. Rule semantics: docs/ENGINE_RULES.md.
 *
 * CONTRACT: the function signatures below are what the web app and tests code against.
 * Implementations live in sibling modules and are re-exported here.
 */
import type { CardioPlan, EngineContext, EngineState, PlanOptions, SessionPlan, SessionSummary, SpacingWarning } from "./types";
import type { DayCode, EngineConfig, Exercise, ProgramConfig, Settings } from "@gym/schema";

export * from "./types";

/** Engine version string, read from config/engine.json (engine_version). */
export declare const ENGINE_VERSION: string;

/**
 * Parse and validate the bundled config/engine.json, config/program.json and data/exercises.json.
 * Throws with a readable message when a file fails validation.
 */
export declare function loadDefaults(): {
  config: EngineConfig;
  program: ProgramConfig;
  exercises: Record<string, Exercise>;
};

/** Settings for a fresh install (block starts program.default_start_date, no limitations, start_pct from config). */
export declare function defaultSettings(config: EngineConfig, program: ProgramConfig, nowIso: string): Settings;

/** Everything the UI needs in one call. Pure and deterministic. */
export declare function computeState(ctx: EngineContext): EngineState;

/** Plan a session (any day code and mode) as of opts.at ?? ctx.now. */
export declare function planSession(ctx: EngineContext, opts: PlanOptions): SessionPlan;

/** Cardio plan for the current training week, with readiness swap and spacing warnings applied. */
export declare function planCardio(ctx: EngineContext, opts?: { at?: string }): CardioPlan;

/** Warnings (never blocks) for starting a session of this kind at opts.at ?? ctx.now. */
export declare function spacingWarnings(ctx: EngineContext, code: DayCode, opts?: { at?: string; intensity?: "easy" | "hard" }): SpacingWarning[];

/** What changed for next time and why, for a finished session (ctx.history must include it). */
export declare function summarizeSession(ctx: EngineContext, sessionId: string): SessionSummary;

// ---- calculations (exported for UI and tests) ----

/** Epley with RIR: weight × (1 + (reps + rir) / divisor). rir null counts as 0. */
export declare function e1rm(weight: number, reps: number, rir: number | null, divisor?: number): number;

/** Round to the nearest multiple of increment (mode "nearest"), or down / up. Avoids float noise (2 decimals). */
export declare function roundToIncrement(value: number, increment: number, mode?: "nearest" | "down" | "up"): number;

/** Local calendar date "YYYY-MM-DD" of an ISO instant in an IANA timezone. */
export declare function localDate(iso: string, timeZone: string): string;

/** Monday ("YYYY-MM-DD") of the week containing a local date. */
export declare function weekStart(date: string): string;

/** Whole days between two local dates (b − a). */
export declare function daysBetween(a: string, b: string): number;
