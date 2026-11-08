/**
 * Display formatting only. The engine owns every number; these helpers just turn them into text.
 * En dash appears only inside numeric ranges ("6–8"). Elsewhere we separate with "·".
 */
import type { Measure } from "@gym/schema";

const EN_DASH = "–";
const MINUS = "−";

/** 82.5 → "82.5", 80 → "80", 81.25 → "81.25". No trailing ".0", float noise removed. */
export function fmtKg(n: number): string {
  // String() of a rounded number never prints a trailing ".0"; `|| 0` turns −0 into 0.
  return String(Math.round(n * 100) / 100 || 0);
}

/** Signed kg delta: +2.5, −5 (true minus sign). */
export function fmtKgDelta(n: number): string {
  if (n === 0) return "0";
  return `${n > 0 ? "+" : MINUS}${fmtKg(Math.abs(n))}`;
}

/** Thousands with a thin space: 6240 → "6 240". */
export function fmtInt(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export interface LoadShape {
  bodyweight?: boolean;
  per_hand?: boolean;
}

/** Load as shown on a set: "80", "BW", "BW+5", "22.5/hand". No unit; callers add "kg" where it helps. */
export function fmtLoad(weight: number, ex: LoadShape = {}): string {
  if (ex.bodyweight) return weight > 0 ? `BW+${fmtKg(weight)}` : "BW";
  return ex.per_hand ? `${fmtKg(weight)}/hand` : fmtKg(weight);
}

export interface AmountShape {
  measure?: Measure;
  per_side?: boolean;
  /** Used to pick "/arm" vs "/leg" for unilateral work. */
  name?: string;
}

const ARM_WORDS = /\b(row|press|curl|raise|fly|arm|extension|carry)\b/i;

/** "/leg" for unilateral leg work, "/arm" for one arm upper body work. */
export function sideSuffix(ex: AmountShape): string {
  if (!ex.per_side) return "";
  return ex.name && ARM_WORDS.test(ex.name) ? "/arm" : "/leg";
}

/** Reps, seconds or meters: "8", "8/leg", "30 s", "40 m". */
export function fmtAmount(n: number, ex: AmountShape = {}): string {
  const m = ex.measure ?? "reps";
  if (m === "seconds") return `${n} s`;
  if (m === "meters") return `${n} m`;
  return `${n}${sideSuffix(ex)}`;
}

/** Numeric range with an en dash: (6, 8) → "6–8", (8, 8) → "8". */
export function fmtRange(min: number, max: number): string {
  return min === max ? String(min) : `${min}${EN_DASH}${max}`;
}

/** Range with its unit: "6–8", "30–45 s", "30–40 m", "8–10/leg". */
export function fmtRangeAmount(min: number, max: number, ex: AmountShape = {}): string {
  const m = ex.measure ?? "reps";
  const r = fmtRange(min, max);
  if (m === "seconds") return `${r} s`;
  if (m === "meters") return `${r} m`;
  return `${r}${sideSuffix(ex)}`;
}

/** Seconds as a clock: 65 → "1:05", 3725 → "1:02:05". Negative clamps to 0. */
export function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (x: number) => String(x).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Estimated length: "~55 min". */
export function fmtApproxMin(min: number): string {
  return `~${Math.round(min)} min`;
}

/** Duration in minutes: "48 min", "1 h 5 min". */
export function fmtMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Parse a local "YYYY-MM-DD" without timezone drift. */
function parseLocalDate(date: string): { y: number; m: number; d: number; weekday: number } {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, weekday };
}

/** "2026-11-09" → "Mon 9 Nov". */
export function fmtLocalDate(date: string): string {
  const { m, d, weekday } = parseLocalDate(date);
  return `${WEEKDAYS[weekday]} ${d} ${MONTHS[m - 1]}`;
}

/** "Today", "Yesterday" or "Mon 9 Nov", relative to `today` (both local dates). */
export function fmtRelativeDate(date: string, today: string): string {
  const a = parseLocalDate(date);
  const b = parseLocalDate(today);
  const diff = Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return fmtLocalDate(date);
}

/** Week range "9–15 Nov" or "30 Nov · 6 Dec" across months. */
export function fmtWeekRange(start: string, end: string): string {
  const a = parseLocalDate(start);
  const b = parseLocalDate(end);
  if (a.m === b.m) return `${a.d}${EN_DASH}${b.d} ${MONTHS[b.m - 1]}`;
  return `${a.d} ${MONTHS[a.m - 1]} · ${b.d} ${MONTHS[b.m - 1]}`;
}

/** Check-in average: 3.5 → "3.5", 4 → "4". */
export function fmtScore(n: number): string {
  return fmtKg(Math.round(n * 10) / 10);
}
