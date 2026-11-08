import { describe, expect, test } from "vitest";
import { addDays, daysBetween, isoWeekday, localDate, localMidnightMs, weekStart } from "../../src/dates";

const TZ = "Europe/Stockholm";

describe("localDate", () => {
  test("uses the local calendar day, not UTC", () => {
    // 23:30 UTC on Nov 9 is 00:30 on Nov 10 in Stockholm (UTC+1 in winter).
    expect(localDate("2026-11-09T23:30:00.000Z", TZ)).toBe("2026-11-10");
    expect(localDate("2026-11-09T22:59:59.000Z", TZ)).toBe("2026-11-09");
    expect(localDate("2026-11-09T23:00:00.000Z", TZ)).toBe("2026-11-10");
  });

  test("summer time is UTC+2", () => {
    expect(localDate("2026-07-01T21:59:00Z", TZ)).toBe("2026-07-01");
    expect(localDate("2026-07-01T22:00:00Z", TZ)).toBe("2026-07-02");
  });

  test("DST end 2026-10-25: the repeated hour stays on the same date", () => {
    // Clocks go from 03:00 CEST back to 02:00 CET at 01:00 UTC.
    expect(localDate("2026-10-24T22:30:00Z", TZ)).toBe("2026-10-25"); // 00:30 CEST
    expect(localDate("2026-10-25T00:30:00Z", TZ)).toBe("2026-10-25"); // 02:30 CEST
    expect(localDate("2026-10-25T01:30:00Z", TZ)).toBe("2026-10-25"); // 02:30 CET
    expect(localDate("2026-10-25T22:59:00Z", TZ)).toBe("2026-10-25"); // 23:59 CET
    expect(localDate("2026-10-25T23:00:00Z", TZ)).toBe("2026-10-26");
  });

  test("DST start 2027-03-28: the skipped hour does not shift the date", () => {
    expect(localDate("2027-03-27T23:00:00Z", TZ)).toBe("2027-03-28"); // 00:00 CET
    expect(localDate("2027-03-28T01:30:00Z", TZ)).toBe("2027-03-28"); // 03:30 CEST
    expect(localDate("2027-03-28T21:59:00Z", TZ)).toBe("2027-03-28"); // 23:59 CEST
    expect(localDate("2027-03-28T22:00:00Z", TZ)).toBe("2027-03-29");
  });

  test("other timezones", () => {
    expect(localDate("2026-11-10T03:00:00Z", "America/New_York")).toBe("2026-11-09");
    expect(localDate("2026-11-10T03:00:00Z", "UTC")).toBe("2026-11-10");
  });
});

describe("weekStart / daysBetween / addDays", () => {
  test("weeks run Monday to Sunday", () => {
    expect(weekStart("2026-11-09")).toBe("2026-11-09"); // Monday
    expect(weekStart("2026-11-15")).toBe("2026-11-09"); // Sunday
    expect(weekStart("2026-11-16")).toBe("2026-11-16");
    expect(weekStart("2027-01-01")).toBe("2026-12-28"); // across the year
    expect(isoWeekday("2026-11-15")).toBe(6);
    expect(isoWeekday("2026-11-09")).toBe(0);
  });

  test("whole days across DST changes", () => {
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
    expect(daysBetween("2027-03-27", "2027-03-29")).toBe(2);
    expect(daysBetween("2026-11-09", "2027-01-31")).toBe(83);
    expect(daysBetween("2026-11-15", "2026-11-09")).toBe(-6);
    expect(addDays("2027-03-27", 1)).toBe("2027-03-28");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  test("weekStart is stable around DST weeks", () => {
    expect(weekStart("2026-10-25")).toBe("2026-10-19");
    expect(weekStart("2026-10-26")).toBe("2026-10-26");
    expect(weekStart("2027-03-28")).toBe("2027-03-22");
  });
});

describe("localMidnightMs", () => {
  test("midnight on normal and DST days", () => {
    expect(new Date(localMidnightMs("2026-11-09", TZ)).toISOString()).toBe("2026-11-08T23:00:00.000Z");
    expect(new Date(localMidnightMs("2026-07-01", TZ)).toISOString()).toBe("2026-06-30T22:00:00.000Z");
    expect(new Date(localMidnightMs("2026-10-25", TZ)).toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(new Date(localMidnightMs("2026-10-26", TZ)).toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect(new Date(localMidnightMs("2027-03-28", TZ)).toISOString()).toBe("2027-03-27T23:00:00.000Z");
    expect(new Date(localMidnightMs("2027-03-29", TZ)).toISOString()).toBe("2027-03-28T22:00:00.000Z");
  });
});
