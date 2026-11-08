/**
 * Sunday booking of the two floor sessions (PROGRAM.md rule 1, DECISIONS D17).
 * Pure helpers: which week to book, default days that respect spacing, and calendar links.
 * Links go to the public /api/ics endpoint (one event per link) with a Google Calendar fallback.
 */
import type { EngineState } from "@gym/engine";

/** Time chips. Mornings first: evenings are one of Peter's week killers. */
export const BOOK_TIMES = ["06:00", "07:00", "08:00", "12:00", "17:00", "18:00"] as const;
export const DEFAULT_BOOK_TIME = "07:00";

const pad = (n: number) => String(n).padStart(2, "0");

function parseDate(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return [y, m, d];
}

/** "2026-11-09" + 3 → "2026-11-12". Calendar arithmetic in UTC, so no DST drift. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = parseDate(date);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: string): number {
  const [y, m, d] = parseDate(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Whole days b − a. */
export function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = parseDate(a);
  const [by, bm, bd] = parseDate(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

interface WallClock {
  date: string;
  minutes: number; // minutes since local midnight
}

function wallParts(utcMs: number, tz: string): { y: number; m: number; d: number; h: number; mi: number; s: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) p[part.type] = part.value;
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute), s: Number(p.second) };
}

/** Offset of tz from UTC at an instant, in minutes (Stockholm winter → 60). */
export function tzOffsetMinutes(utcMs: number, tz: string): number {
  try {
    const w = wallParts(utcMs, tz);
    const asUtc = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
    return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60_000);
  } catch {
    return 0;
  }
}

/** Local wall clock of an instant in tz. */
export function wallClock(iso: string, tz: string): WallClock {
  const ms = Date.parse(iso);
  try {
    const w = wallParts(ms, tz);
    return { date: `${w.y}-${pad(w.m)}-${pad(w.d)}`, minutes: w.h * 60 + w.mi };
  } catch {
    return { date: iso.slice(0, 10), minutes: Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16)) };
  }
}

/** Local date + "HH:MM" in tz → ISO with that zone's offset at that moment: "2026-11-10T07:00:00+01:00". */
export function zonedIso(date: string, time: string, tz: string): string {
  const [y, m, d] = parseDate(date);
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  // Two passes so the offset is the one in force at the resulting instant (DST days).
  let off = tzOffsetMinutes(wall, tz);
  off = tzOffsetMinutes(wall - off * 60_000, tz);
  const sign = off >= 0 ? "+" : "-";
  const a = Math.abs(off);
  return `${date}T${pad(hh)}:${pad(mm)}:00${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

export interface CalendarEvent {
  title: string;
  /** ISO with offset, from zonedIso. */
  start: string;
  minutes: number;
  notes: string;
}

/** Plain link to the public ICS endpoint. The offset in start is URL encoded (+ → %2B). */
export function icsHref(e: CalendarEvent): string {
  const q = [
    `title=${encodeURIComponent(e.title)}`,
    `start=${encodeURIComponent(e.start)}`,
    `minutes=${Math.round(e.minutes)}`,
    `notes=${encodeURIComponent(e.notes)}`,
  ];
  return `/api/ics?${q.join("&")}`;
}

/** 20261110T060000Z */
function gcalStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "");
}

/** Google Calendar "add event" fallback. */
export function googleHref(e: CalendarEvent): string {
  const start = Date.parse(e.start);
  const end = start + Math.round(e.minutes) * 60_000;
  return (
    "https://calendar.google.com/calendar/render?action=TEMPLATE" +
    `&text=${encodeURIComponent(e.title)}` +
    `&dates=${gcalStamp(start)}/${gcalStamp(end)}` +
    `&details=${encodeURIComponent(e.notes)}`
  );
}

export interface BookingWindow {
  /** Monday and Sunday of the week being booked. */
  week_start: string;
  week_end: string;
  /** "this" = the current week, "next" = the week after. */
  which: "this" | "next";
  /** First date that can still be booked (today, tomorrow, or the Monday). */
  first_open: string;
  /** Sessions to book: the floor, minus strength sessions already done when booking this week. */
  count: number;
}

/**
 * Which week to book. Sunday, or once this week's floor is reached → next week.
 * Before the block starts → its first week. Otherwise the rest of this week, for what still reaches the floor.
 */
export function bookingWindow(state: EngineState, nowIso: string, tz: string, floor: number, time: string): BookingWindow {
  const week = state.current_week;
  const today = state.today;
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const beforeTime = wallClock(nowIso, tz).minutes < hh * 60 + mm;
  const next = (): BookingWindow => {
    const start = addDays(week.start_date, 7);
    return { week_start: start, week_end: addDays(start, 6), which: "next", first_open: start, count: floor };
  };
  if (today < week.start_date) {
    return { week_start: week.start_date, week_end: week.end_date, which: "this", first_open: week.start_date, count: floor };
  }
  const needed = Math.max(0, floor - week.strength_done);
  if (weekdayOf(today) === 0 || needed === 0) return next();
  // A session already done today: never stack, so the earliest booking is tomorrow.
  const first = beforeTime && !state.next.done_today ? today : addDays(today, 1);
  if (first > week.end_date) return next();
  return { week_start: week.start_date, week_end: week.end_date, which: "this", first_open: first, count: needed };
}

/** The bookable dates of the window, Monday first (dates before first_open are not bookable). */
export function windowDays(w: BookingWindow): { date: string; open: boolean }[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(w.week_start, i);
    return { date, open: date >= w.first_open };
  });
}

/**
 * Default days: the first open day that passes `ok` (the engine's spacing check), then the first
 * day after it that leaves a rest day in between, else the day right after. At most w.count days.
 */
export function defaultBookingDays(w: BookingWindow, ok: (date: string) => boolean = () => true): string[] {
  const open = windowDays(w)
    .filter((d) => d.open)
    .map((d) => d.date);
  if (w.count <= 0 || !open.length) return [];
  const first = open.find(ok) ?? open[0]!;
  const picked = [first];
  while (picked.length < Math.min(w.count, 2)) {
    const last = picked[picked.length - 1]!;
    const spaced = open.find((d) => dayDiff(last, d) >= 2);
    const nextDay = open.find((d) => dayDiff(last, d) === 1);
    const pick = spaced ?? nextDay;
    if (!pick) break;
    picked.push(pick);
  }
  return picked;
}

/** Session codes in line from `first`, following the rotation: B → [B, C]. */
export function codesInLine<T extends string>(first: T, order: readonly T[], n: number): T[] {
  const i = Math.max(0, order.indexOf(first));
  return Array.from({ length: n }, (_, k) => order[(i + k) % order.length] ?? first);
}
