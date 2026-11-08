/** Core calculations: e1RM, rounding, fractional sets. */
import type { EngineConfig, Exercise, Muscle } from "@gym/schema";
import engineJson from "../../../config/engine.json" with { type: "json" };

const DEFAULT_DIVISOR: number = engineJson.e1rm.divisor;

/** Round to 2 decimals without float noise (0.1 + 0.2 → 0.3). */
export function round2(x: number): number {
  const r = Math.round(x * 100 + Math.sign(x) * 1e-7) / 100;
  return Object.is(r, -0) ? 0 : r;
}

/** Round to the nearest multiple of increment (mode "nearest"), or down / up. Avoids float noise (2 decimals). */
export function roundToIncrement(value: number, increment: number, mode: "nearest" | "down" | "up" = "nearest"): number {
  if (!(increment > 0)) return round2(value);
  // Snap the quotient first so 82.5 / 2.5 = 32.999999 still counts as 33.
  const q = Math.round((value / increment) * 1e6) / 1e6;
  const n = mode === "down" ? Math.floor(q) : mode === "up" ? Math.ceil(q) : Math.round(q);
  return round2(n * increment);
}

/** A load rounded to the increment, never negative. */
export function roundLoad(value: number, increment: number, mode: "nearest" | "down" | "up" = "nearest"): number {
  return Math.max(0, roundToIncrement(value, increment, mode));
}

/** Epley with RIR: weight × (1 + (reps + rir) / divisor). rir null counts as 0. */
export function e1rm(weight: number, reps: number, rir: number | null, divisor: number = DEFAULT_DIVISOR): number {
  return round2(weight * (1 + (reps + (rir ?? 0)) / divisor));
}

/** Weight that gives this e1RM at reps + rir (inverse Epley), unrounded. */
export function weightFromE1rm(value: number, reps: number, rir: number, divisor: number): number {
  return value / (1 + (reps + rir) / divisor);
}

/** Fractional sets one working set adds per muscle. */
export function fractionalSets(exercise: Exercise, config: EngineConfig): Partial<Record<Muscle, number>> {
  const out: Partial<Record<Muscle, number>> = {};
  for (const m of exercise.primary_muscles) out[m] = (out[m] ?? 0) + config.fractional_sets.primary;
  for (const m of exercise.secondary_muscles) out[m] = (out[m] ?? 0) + config.fractional_sets.secondary;
  return out;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Linear interpolation of y from (x0, y0) to (x1, y1), clamped to the end values. */
export function lerpClamped(x: number, x0: number, y0: number, x1: number, y1: number): number {
  if (x1 === x0) return y1;
  const t = clamp((x - x0) / (x1 - x0), 0, 1);
  return y0 + (y1 - y0) * t;
}
