import { describe, expect, it } from "vitest";
import type { EngineState } from "@gym/engine";
import {
  addDays,
  bookingWindow,
  codesInLine,
  defaultBookingDays,
  googleHref,
  icsHref,
  weekdayOf,
  windowDays,
  zonedIso,
  type BookingWindow,
} from "../../src/screens/plan/booking";

const TZ = "Europe/Stockholm";

function fakeState(p: { today: string; start: string; strength: number; doneToday?: boolean }): EngineState {
  return {
    today: p.today,
    current_week: { start_date: p.start, end_date: addDays(p.start, 6), strength_done: p.strength },
    next: { code: "A", done_today: !!p.doneToday, est_minutes: 55 },
  } as unknown as EngineState;
}

describe("dates and zones", () => {
  it("adds days and finds weekdays without drift", () => {
    expect(addDays("2026-11-09", 6)).toBe("2026-11-15");
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
    expect(weekdayOf("2026-11-08")).toBe(0);
    expect(weekdayOf("2026-11-09")).toBe(1);
  });

  it("builds ISO with the offset in force at that moment", () => {
    expect(zonedIso("2026-11-10", "07:00", TZ)).toBe("2026-11-10T07:00:00+01:00");
    expect(zonedIso("2027-06-01", "07:00", TZ)).toBe("2027-06-01T07:00:00+02:00");
    // DST starts 28 Mar 2027 at 02:00 local: 07:00 is already summer time.
    expect(zonedIso("2027-03-28", "07:00", TZ)).toBe("2027-03-28T07:00:00+02:00");
    expect(zonedIso("2026-11-10", "07:00", "UTC")).toBe("2026-11-10T07:00:00+00:00");
    expect(new Date(zonedIso("2026-11-10", "07:00", TZ)).toISOString()).toBe("2026-11-10T06:00:00.000Z");
  });
});

describe("calendar links", () => {
  const event = { title: "Workout · Session A", start: "2026-11-10T07:00:00+01:00", minutes: 55, notes: "Floor session 1 of 2." };

  it("points at the public ICS endpoint with the offset URL encoded", () => {
    const href = icsHref(event);
    expect(href.startsWith("/api/ics?")).toBe(true);
    const q = new URLSearchParams(href.split("?")[1]);
    expect(href).toContain("start=2026-11-10T07%3A00%3A00%2B01%3A00");
    expect(q.get("start")).toBe("2026-11-10T07:00:00+01:00");
    expect(q.get("title")).toBe("Workout · Session A");
    expect(q.get("minutes")).toBe("55");
    expect(q.get("notes")).toBe("Floor session 1 of 2.");
  });

  it("offers a Google Calendar fallback in UTC", () => {
    const href = googleHref(event);
    expect(href).toContain("calendar.google.com/calendar/render?action=TEMPLATE");
    expect(href).toContain("dates=20261110T060000Z/20261110T065500Z");
    expect(href).toContain(`text=${encodeURIComponent("Workout · Session A")}`);
  });
});

describe("bookingWindow", () => {
  it("books the first block week before the block starts, even on that Sunday", () => {
    const w = bookingWindow(fakeState({ today: "2026-11-08", start: "2026-11-09", strength: 0 }), "2026-11-08T10:00:00.000Z", TZ, 2, "07:00");
    expect(w).toMatchObject({ which: "this", week_start: "2026-11-09", first_open: "2026-11-09", count: 2 });
  });

  it("books next week on Sundays", () => {
    const w = bookingWindow(fakeState({ today: "2026-11-15", start: "2026-11-09", strength: 1 }), "2026-11-15T08:00:00.000Z", TZ, 2, "07:00");
    expect(w).toMatchObject({ which: "next", week_start: "2026-11-16", week_end: "2026-11-22", first_open: "2026-11-16", count: 2 });
  });

  it("books next week once the floor is reached", () => {
    const w = bookingWindow(fakeState({ today: "2026-11-11", start: "2026-11-09", strength: 2 }), "2026-11-11T08:00:00.000Z", TZ, 2, "07:00");
    expect(w.which).toBe("next");
  });

  it("books what still reaches the floor this week, from today when the time is still ahead", () => {
    const early = bookingWindow(fakeState({ today: "2026-11-11", start: "2026-11-09", strength: 1 }), "2026-11-11T05:00:00.000Z", TZ, 2, "07:00");
    expect(early).toMatchObject({ which: "this", first_open: "2026-11-11", count: 1 });
    const late = bookingWindow(fakeState({ today: "2026-11-11", start: "2026-11-09", strength: 1 }), "2026-11-11T09:00:00.000Z", TZ, 2, "07:00");
    expect(late).toMatchObject({ which: "this", first_open: "2026-11-12", count: 1 });
  });

  it("never offers today after a session today (never stack)", () => {
    const w = bookingWindow(fakeState({ today: "2026-11-11", start: "2026-11-09", strength: 1, doneToday: true }), "2026-11-11T04:00:00.000Z", TZ, 2, "07:00");
    expect(w.first_open).toBe("2026-11-12");
  });

  it("offers the Sunday when Saturday already has a session", () => {
    const w = bookingWindow(fakeState({ today: "2026-11-14", start: "2026-11-09", strength: 0, doneToday: true }), "2026-11-14T20:00:00.000Z", TZ, 2, "07:00");
    expect(w.first_open).toBe("2026-11-15");
    expect(w.which).toBe("this");
  });
});

describe("defaultBookingDays", () => {
  const week: BookingWindow = { week_start: "2026-11-16", week_end: "2026-11-22", which: "next", first_open: "2026-11-16", count: 2 };

  it("picks the first open day and leaves a rest day before the second", () => {
    expect(defaultBookingDays(week)).toEqual(["2026-11-16", "2026-11-18"]);
  });

  it("skips days the spacing check flags", () => {
    expect(defaultBookingDays(week, (d) => d !== "2026-11-16")).toEqual(["2026-11-17", "2026-11-19"]);
  });

  it("falls back to the next day when the week runs out, and books one when one is needed", () => {
    expect(defaultBookingDays({ ...week, first_open: "2026-11-21" })).toEqual(["2026-11-21", "2026-11-22"]);
    expect(defaultBookingDays({ ...week, count: 1 })).toEqual(["2026-11-16"]);
    expect(defaultBookingDays({ ...week, count: 0 })).toEqual([]);
  });

  it("marks days before the first open day as closed", () => {
    const days = windowDays({ ...week, first_open: "2026-11-19" });
    expect(days.filter((d) => d.open).map((d) => d.date)).toEqual(["2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]);
  });
});

describe("codesInLine", () => {
  it("follows the rotation from the next session", () => {
    expect(codesInLine("B", ["A", "B", "C"], 2)).toEqual(["B", "C"]);
    expect(codesInLine("C", ["A", "B", "C"], 2)).toEqual(["C", "A"]);
    expect(codesInLine("A", ["B", "A", "C"], 3)).toEqual(["A", "C", "B"]);
  });
});
