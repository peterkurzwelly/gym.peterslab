/**
 * Local date helpers. All day and week logic runs on local "YYYY-MM-DD" strings in settings.timezone.
 * Local dates are converted to a UTC day number, so adding days is exact and DST never shifts a date.
 */

const DAY_MS = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

interface Parts {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

function zonedParts(ms: number, timeZone: string): Parts {
  const out: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(ms))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return { y: out.year ?? 0, m: out.month ?? 1, d: out.day ?? 1, h: (out.hour ?? 0) % 24, mi: out.minute ?? 0, s: out.second ?? 0 };
}

function pad(n: number, len = 2): string {
  return String(n).padStart(len, "0");
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Local calendar date "YYYY-MM-DD" of an ISO instant in an IANA timezone. */
export function localDate(iso: string, timeZone: string): string {
  const p = zonedParts(Date.parse(iso), timeZone);
  return `${pad(p.y, 4)}-${pad(p.m)}-${pad(p.d)}`;
}

/** Day number (days since 1970-01-01) of a local date string. */
export function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.round(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / DAY_MS);
}

export function fromDayNumber(n: number): string {
  const dt = new Date(n * DAY_MS);
  return `${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function addDays(date: string, days: number): string {
  return fromDayNumber(dayNumber(date) + days);
}

/** Whole days between two local dates (b − a). */
export function daysBetween(a: string, b: string): number {
  return dayNumber(b) - dayNumber(a);
}

/** 0 = Monday … 6 = Sunday. */
export function isoWeekday(date: string): number {
  return (new Date(dayNumber(date) * DAY_MS).getUTCDay() + 6) % 7;
}

/** Monday ("YYYY-MM-DD") of the week containing a local date. */
export function weekStart(date: string): string {
  return addDays(date, -isoWeekday(date));
}

/** Offset (local wall clock − UTC) in ms at an instant. */
function offsetMs(ms: number, timeZone: string): number {
  const p = zonedParts(ms, timeZone);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** UTC instant (ms) of local midnight at the start of a local date. */
export function localMidnightMs(date: string, timeZone: string): number {
  const guess = dayNumber(date) * DAY_MS;
  const first = guess - offsetMs(guess, timeZone);
  return guess - offsetMs(first, timeZone);
}

export function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

export function hoursBetween(fromMs: number, toMs: number): number {
  return (toMs - fromMs) / 3_600_000;
}
