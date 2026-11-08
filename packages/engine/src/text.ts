/** Copy helpers. Plain, guilt free, no dashes as punctuation ("−" is only used as a minus sign). */
import type { Measure } from "@gym/schema";
import { round2 } from "./calc";

/** 82.5 → "82.5", 85 → "85". */
export function fmtNum(x: number): string {
  return String(round2(x));
}

/** 0.075 → "7.5". */
export function fmtPct(fraction: number): string {
  return String(round2(fraction * 100));
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
export function numberWord(n: number): string {
  return WORDS[n] ?? String(n);
}

/** "8 reps", "45 s", "30 m". */
export function amount(n: number, measure: Measure): string {
  if (measure === "seconds") return `${n} s`;
  if (measure === "meters") return `${n} m`;
  return plural(n, "rep");
}

export function signedKg(delta: number): string {
  return delta >= 0 ? `+${fmtNum(delta)} kg` : `−${fmtNum(-delta)} kg`;
}

export function timesWord(n: number): string {
  if (n === 1) return "once";
  if (n === 2) return "twice";
  return `${n} times`;
}

/**
 * Comeback line. Says "same weights" unless a break lowers them: a long break does, a short break only when
 * comeback.overrides_short_break is false (by default the comeback keeps the same weights, PROGRAM.md rule 4).
 */
export function comebackText(setReduction: number, lighter: boolean): string {
  const sets = `${numberWord(setReduction)} set${setReduction === 1 ? "" : "s"} less`;
  return `Coming back is easy on purpose: ${sets}, ${lighter ? "lighter weights to ease in" : "same weights"}.`;
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
