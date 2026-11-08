/** Single-event iCalendar file (RFC 5545) for "book your two floor sessions" on iPhone. */
import { z } from "zod";

/** ISO date-time with an explicit Z or offset, so the instant is never ambiguous. */
const IsoWithZone = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/, "ISO date-time with Z or offset")
  .refine((s) => !Number.isNaN(Date.parse(s)), "invalid date");

export const IcsQuery = z.object({
  title: z.string().trim().min(1).max(120).default("Workout"),
  start: IsoWithZone,
  minutes: z.coerce.number().int().min(5).max(480).default(60),
  notes: z.string().max(1000).optional(),
});
export type IcsQuery = z.infer<typeof IcsQuery>;

/** 20261110T170000Z */
export function icsDate(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "");
}

/** TEXT value escaping: backslash, semicolon, comma, newlines. */
export function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

/** Folds a content line at 75 octets (continuation lines start with one space). Never splits a UTF-8 char. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const max = out.length === 0 ? 75 : 74; // continuation lines carry the leading space
    if (bytes + n > max) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

async function uidFor(start: string, title: string): Promise<string> {
  // Deterministic, so adding the same booking twice updates the event instead of duplicating it.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${start}|${title}`));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 32)}@gym.peterslab.app`;
}

export async function buildIcs(q: IcsQuery, now: Date, url?: string): Promise<string> {
  const start = new Date(q.start);
  const end = new Date(start.getTime() + q.minutes * 60_000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//peterslab//Workout OS//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${await uidFor(start.toISOString(), q.title)}`,
    `DTSTAMP:${icsDate(now)}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${escapeText(q.title)}`,
    `DESCRIPTION:${escapeText(q.notes?.trim() || "Booked from Workout OS.")}`,
    ...(url ? [`URL:${url}`] : []),
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeText(q.title)}`,
    "TRIGGER:-PT30M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
