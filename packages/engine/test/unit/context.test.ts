import { describe, expect, test } from "vitest";
import type { Settings } from "@gym/schema";
import { normalize, withSettingsDefaults } from "../../src/context";
import { History, at, ctxOf, day, settings } from "./fixtures";

describe("normalize", () => {
  test("deleted sessions, set logs, cardio logs and check-ins are ignored", () => {
    const h = new History();
    const s1 = h.simple("A", day(0), ["A1"], [[60, 8]]);
    const s2 = h.simple("B", day(1), ["B1"], [[80, 5]]);
    h.sessions.find((s) => s.id === s2.id)!.deleted_at = at(day(1), "20:00");
    h.setLogs[0]!.deleted_at = at(day(0), "20:00");
    h.walk(day(1), 30).deleted_at = at(day(1), "21:00");
    h.checkin(day(1), 1).deleted_at = at(day(1), "08:00");
    const n = normalize(ctxOf(h, at(day(2))));
    expect(n.sessions.map((s) => s.id)).toEqual([s1.id]);
    expect(n.sessions[0]!.sets).toHaveLength(0);
    expect(n.sessions[0]!.qualifying).toBe(false); // its only set was deleted
    expect(n.walks).toHaveLength(0);
    expect(n.checkins).toHaveLength(0);
  });

  test("sessions sort by start; local date is the start's local date (near midnight)", () => {
    const h = new History();
    const late = h.session({ code: "B", date: day(1), time: "23:50", exercises: [{ pid: "B1", sets: [[80, 5]] }] });
    const early = h.session({ code: "A", date: day(1), time: "00:10", exercises: [{ pid: "A1", sets: [[60, 8]] }] });
    const n = normalize(ctxOf(h, at(day(3))));
    expect(n.sessions.map((s) => s.id)).toEqual([early.id, late.id]);
    expect(n.sessions.map((s) => s.date)).toEqual([day(1), day(1)]);
    // 23:50 local on Nov 10 is 22:50 UTC: still Nov 10 locally.
    expect(late.started_at).toBe("2026-11-10T22:50:00.000Z");
  });

  test("tracks follow exercise + effective rep range (alternative overrides)", () => {
    const h = new History();
    h.session({ code: "A", date: day(0), exercises: [{ pid: "A4", sets: [[60, 10]] }] });
    h.session({ code: "B", date: day(2), exercises: [{ pid: "B1", ex: "romanian_deadlift", sets: [[80, 8]] }] });
    h.session({ code: "A", date: day(4), exercises: [{ pid: "A6", ex: "dead_bug", sets: [[0, 10]] }] });
    const n = normalize(ctxOf(h, at(day(5))));
    const tracks = n.sessions.map((s) => s.sets[0]!.track);
    expect(tracks).toEqual(["romanian_deadlift@8-10", "romanian_deadlift@6-8", "dead_bug@8-12"]);
    expect(n.sessions[2]!.sets[0]!.measure).toBe("reps"); // dead bug overrides the plank's seconds
    expect(n.sessions[2]!.sets[0]!.slot!.progression_rule).toBe("reps_only");
  });

  test("set logs without prescription_id resolve within the session's day", () => {
    const h = new History();
    h.session({ code: "C", date: day(0), exercises: [{ pid: "C3", sets: [[50, 10]] }] });
    h.setLogs[0]!.prescription_id = null;
    const n = normalize(ctxOf(h, at(day(1))));
    expect(n.sessions[0]!.sets[0]!.track).toBe("seated_cable_row@10-12");
  });

  test("unfinished sessions: auto finished after inactivity, else open but qualifying", () => {
    const h = new History();
    const old = h.session({ code: "A", date: day(0), ended: false, exercises: [{ pid: "A1", sets: [[60, 8], [60, 8]] }] });
    const open = h.session({ code: "B", date: day(2), time: "18:00", ended: false, exercises: [{ pid: "B1", sets: [[80, 5]] }] });
    const n = normalize(ctxOf(h, at(day(2), "19:00")));
    const o = n.sessionById.get(old.id)!;
    expect(o.finished && o.autoFinished).toBe(true);
    // Auto finish time is the last set's completion.
    expect(o.endedIso).toBe(h.setLogs.filter((l) => l.session_id === old.id).at(-1)!.completed_at);
    const p = n.sessionById.get(open.id)!;
    expect(p.finished).toBe(false);
    expect(p.qualifying).toBe(true);
  });

  test("warm-up only strength session does not qualify; cardio needs a cardio log", () => {
    const h = new History();
    h.session({ code: "A", date: day(0), exercises: [{ pid: "A1", sets: [], warmups: [[40, 5]] }] });
    h.session({ code: "CARDIO", date: day(1) });
    h.cardio(day(2));
    const n = normalize(ctxOf(h, at(day(3))));
    expect(n.sessions.map((s) => s.qualifying)).toEqual([false, false, true]);
  });

  test("excludeSessionId and `at` drop sessions; invalid timezone falls back to config", () => {
    const h = new History();
    const a = h.simple("A", day(0), ["A1"], [[60, 8]]);
    h.simple("B", day(3), ["B1"], [[80, 5]]);
    const ctx = ctxOf(h, at(day(5)), { timezone: "Not/AZone" });
    expect(normalize(ctx, { excludeSessionId: a.id }).sessions).toHaveLength(1);
    expect(normalize(ctx, { at: at(day(1)) }).sessions).toHaveLength(1);
    expect(normalize(ctx).tz).toBe("Europe/Stockholm");
  });
});

describe("withSettingsDefaults", () => {
  test("a complete row is returned as is", () => {
    const s = settings({ sex: "male", evening_hour: null });
    expect(withSettingsDefaults(s)).toBe(s);
  });

  test("fields added after the first release take the schema defaults; stored values and nulls stay", () => {
    const full = settings();
    const { evening_hour: _e, week_killers: _w, sex: _s, goal: _g, cut_rate_pct: _c, steps_target: _st, kcal_override: _k, ...old } = full;
    const filled = withSettingsDefaults({ ...old, job_activity: "physical", birth_year: null } as Settings);
    expect(filled).toEqual({ ...full, job_activity: "physical" });
    expect(old).not.toHaveProperty("goal"); // the input is not changed
  });
});
