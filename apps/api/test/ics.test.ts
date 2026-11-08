import { describe, expect, it } from "vitest";
import { escapeText, foldLine } from "../src/ics";
import { call } from "./helpers";

const qs = (p: Record<string, string>) => "/api/ics?" + new URLSearchParams(p).toString();

async function ics(p: Record<string, string>) {
  const res = await call(qs(p));
  return { res, text: await res.text() };
}

function unfold(text: string): string[] {
  return text.replace(/\r\n /g, "").split("\r\n");
}

describe("GET /api/ics", () => {
  it("returns one VEVENT in UTC with a 30 min alarm", async () => {
    const { res, text } = await ics({ title: "Session A", start: "2026-11-10T18:00:00+01:00", minutes: "45", notes: "Floor session 1 of 2" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/calendar; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe("inline; filename=session.ics");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(text.endsWith("\r\n")).toBe(true);
    expect(text.replace(/\r\n/g, "")).not.toContain("\n");

    const lines = unfold(text);
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines).toContain("VERSION:2.0");
    expect(lines.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(1);
    expect(lines).toContain("DTSTART:20261110T170000Z");
    expect(lines).toContain("DTEND:20261110T174500Z");
    expect(lines).toContain("SUMMARY:Session A");
    expect(lines).toContain("DESCRIPTION:Floor session 1 of 2");
    expect(lines).toContain("URL:https://gym.test/");
    expect(lines.find((l) => l.startsWith("DTSTAMP:"))).toMatch(/^DTSTAMP:\d{8}T\d{6}Z$/);
    expect(lines.find((l) => l.startsWith("UID:"))).toMatch(/^UID:[0-9a-f]{32}@gym\.peterslab\.app$/);
    const alarm = lines.slice(lines.indexOf("BEGIN:VALARM"), lines.indexOf("END:VALARM") + 1);
    expect(alarm).toEqual(["BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Session A", "TRIGGER:-PT30M", "END:VALARM"]);
    expect(lines.slice(-3)).toEqual(["END:VEVENT", "END:VCALENDAR", ""]);
  });

  it("defaults title and duration; UID is stable for the same booking", async () => {
    const a = unfold((await ics({ start: "2026-11-12T06:30:00Z" })).text);
    const b = unfold((await ics({ start: "2026-11-12T07:30:00+01:00" })).text);
    expect(a).toContain("SUMMARY:Workout");
    expect(a).toContain("DTEND:20261112T073000Z");
    expect(a.find((l) => l.startsWith("UID:"))).toBe(b.find((l) => l.startsWith("UID:")));
    const c = unfold((await ics({ start: "2026-11-12T06:30:00Z", title: "Other" })).text);
    expect(c.find((l) => l.startsWith("UID:"))).not.toBe(a.find((l) => l.startsWith("UID:")));
  });

  it("escapes text and folds long lines at 75 octets", async () => {
    const notes = "Warm up, then A1; A2\nback squat · " + "long ".repeat(40) + "åäö 💪".repeat(10);
    const { text } = await ics({ title: "Legs, heavy; ok\\", start: "2026-11-10T17:00:00Z", notes });
    for (const line of text.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    const lines = unfold(text);
    expect(lines).toContain(String.raw`SUMMARY:Legs\, heavy\; ok\\`);
    expect(lines.find((l) => l.startsWith("DESCRIPTION:Warm"))).toBe(`DESCRIPTION:${escapeText(notes)}`);
  });

  it.each([
    ["missing start", { title: "x" }],
    ["start without zone", { start: "2026-11-10T17:00:00" }],
    ["start not a date", { start: "tomorrow" }],
    ["impossible date", { start: "2026-13-40T17:00:00Z" }],
    ["minutes too small", { start: "2026-11-10T17:00:00Z", minutes: "2" }],
    ["minutes too large", { start: "2026-11-10T17:00:00Z", minutes: "1000" }],
    ["minutes not a number", { start: "2026-11-10T17:00:00Z", minutes: "abc" }],
    ["minutes fractional", { start: "2026-11-10T17:00:00Z", minutes: "30.5" }],
    ["title too long", { start: "2026-11-10T17:00:00Z", title: "x".repeat(121) }],
  ])("%s: 400", async (_name, p) => {
    const res = await call(qs(p as Record<string, string>));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_params" });
  });

  it("is public: works without auth (the Today and Plan screens open it with a plain navigation)", async () => {
    const res = await call(qs({ start: "2026-11-10T17:00:00Z" }), {}, { DEV_ALLOW_ALL: undefined });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("BEGIN:VCALENDAR");
  });
});

describe("ics helpers", () => {
  it("foldLine never splits multi-byte characters", () => {
    const folded = foldLine("DESCRIPTION:" + "💪".repeat(40));
    for (const part of folded.split("\r\n")) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
      expect(part).not.toContain("�");
    }
    expect(folded.replace(/\r\n /g, "")).toBe("DESCRIPTION:" + "💪".repeat(40));
  });

  it("short lines are untouched", () => {
    expect(foldLine("SUMMARY:x")).toBe("SUMMARY:x");
  });
});
