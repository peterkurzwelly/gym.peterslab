/** Injectable clock so tests control every timestamp the data layer writes. */

const systemNow = () => new Date().toISOString();
let impl: () => string = systemNow;

/** Current instant as ISO UTC with milliseconds. */
export function nowIso(): string {
  return new Date(Date.parse(impl())).toISOString();
}

/** Replace the clock (tests). Pass null to restore the system clock. */
export function setClock(fn: (() => string) | null): void {
  impl = fn ?? systemNow;
}

/** Local calendar date "YYYY-MM-DD" of an instant in an IANA timezone. */
export function localDateOf(iso: string, timeZone: string): string {
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
      new Date(iso),
    );
  } catch {
    return iso.slice(0, 10);
  }
}

/**
 * Next updated_at for a row: now, unless that is not strictly later than the stored value,
 * then stored + 1 ms. Keeps last-write-wins correct even with a clock that stands still or goes back.
 */
export function nextUpdatedAt(previous: string | null | undefined, now: string = nowIso()): string {
  if (!previous) return now;
  const prev = Date.parse(previous);
  const cur = Date.parse(now);
  if (Number.isNaN(prev) || cur > prev) return now;
  return new Date(prev + 1).toISOString();
}
