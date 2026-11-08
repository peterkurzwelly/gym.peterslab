import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { Decision } from "@gym/schema";
import type { EngineState } from "../../src/types";
import { computeState } from "../../src/index";
import { History, at, ctxOf, day, program, withConfig } from "./fixtures";

function expectExplained(st: EngineState) {
  const ids = new Set(st.decisions.map((d) => d.id));
  expect(ids.size).toBe(st.decisions.length); // unique ids
  const plans = [st.next.plan, ...(st.active ? [st.active.plan] : [])];
  for (const plan of plans) {
    for (const e of plan.exercises) {
      expect(ids.has(e.decision_id), `${e.exercise_id} → ${e.decision_id}`).toBe(true);
      expect(plan.decisions.some((d) => d.id === e.decision_id)).toBe(true);
      expect(st.decisions.find((d) => d.id === e.decision_id)!.explanation).toBe(e.reason);
    }
  }
}

/** 12 weeks × 5 sessions × 25 sets, daily check-ins, weekly cardio. */
function bigHistory(): History {
  const h = new History();
  const codes = ["A", "B", "C"] as const;
  let k = 0;
  for (let w = 0; w < 12; w++) {
    for (let d = 0; d < 5; d++) {
      const code = codes[k++ % 3]!;
      const pres = program.days.find((x) => x.code === code)!.prescriptions;
      const exercises = pres.map((p) => ({ pid: p.id, sets: [] as [number, number, number][] }));
      for (let i = 0; i < 25; i++) exercises[i % exercises.length]!.sets.push([40 + w * 2.5, 8 + (i % 3), 2 + (i % 2)]);
      h.session({ code, date: day(w * 7 + d), exercises });
    }
    h.cardio(day(w * 7 + 5));
    for (let d = 0; d < 7; d++) h.checkin(day(w * 7 + d), 3 + ((w + d) % 3), 3, 4, 3);
  }
  return h;
}

describe("computeState", () => {
  test("empty history: week 1, first session of the block, everything explained", () => {
    const st = computeState(ctxOf(new History(), at(day(0), "07:00")));
    expect(st.today).toBe(day(0));
    expect(st.block).toMatchObject({ training_week: 1, phase: "return", complete: false, extension_weeks: 0, deload_week: 8 });
    expect(st.next).toMatchObject({ code: "A", reason: "First session of the block", done_today: false, est_minutes: 55, short_minutes: 30 });
    expect(st.active).toBeNull();
    expect(st.tracks).toEqual({});
    expect(st.totals.sessions).toBe(0);
    expect(st.engine_version).toBe("1.0.0");
    expectExplained(st);
  });

  test("deterministic: same context twice deep equals", () => {
    const h = bigHistory();
    const ctx = ctxOf(h, at(day(84), "10:00"));
    expect(computeState(ctx)).toEqual(computeState(ctx));
  });

  test("active session plan is frozen and explained; stale open sessions auto finish", () => {
    const h = new History();
    const stale = h.session({ code: "A", date: day(0), ended: false, exercises: [{ pid: "A1", sets: [[60, 8, 3], [60, 8, 3]] }] });
    const open = h.session({ code: "B", date: day(2), time: "18:00", ended: false, exercises: [{ pid: "B1", sets: [[80, 5, 3]] }] });
    const st = computeState(ctxOf(h, at(day(2), "18:20")));
    expect(st.auto_finished).toEqual([{ session_id: stale.id, ended_at: h.setLogs[1]!.completed_at }]);
    expect(st.active?.session.id).toBe(open.id);
    expect(st.active!.plan.code).toBe("B");
    // The stale session fed progression (auto finished), the open one did not.
    expect(st.tracks["back_squat@5-8"]!.exposures).toBe(1);
    expect(st.tracks["trap_bar_deadlift@4-6"]).toBeUndefined();
    // The open session counts toward the week and today.
    expect(st.current_week.strength_done).toBe(2);
    expect(st.next.done_today).toBe(true);
    expectExplained(st);
  });

  test("changing a threshold in engine.json changes behavior", () => {
    const h = new History();
    h.simple("A", day(0), ["A1"], [[60, 8]]);
    const ctx = ctxOf(h, at(day(1)));
    expect(computeState(ctx).current_week.floor_reached).toBe(false);
    expect(computeState(withConfig(ctx, (c) => void (c.week.strength_floor = 1))).current_week.floor_reached).toBe(true);
    expect(computeState(withConfig(ctx, (c) => void (c.session.auto_finish_hours = 1000))).tracks).toBeDefined();
  });

  test("deleted rows are ignored everywhere", () => {
    const h = new History();
    h.simple("A", day(0), ["A1"], [[60, 8]]);
    const b = h.simple("B", day(1), ["B1"], [[80, 5]]);
    b.deleted_at = at(day(1), "22:00");
    const st = computeState(ctxOf(h, at(day(2))));
    expect(st.current_week.strength_done).toBe(1);
    expect(st.next.code).toBe("B");
    expect(st.totals.sets).toBe(1);
  });

  test("a big history computes fast and stays fully explained", () => {
    const h = bigHistory();
    h.session({ code: "A", date: day(84), time: "09:00", ended: false, exercises: [{ pid: "A1", sets: [[70, 8, 2]] }] });
    const ctx = ctxOf(h, at(day(84), "09:30"));
    computeState(ctx); // warm up
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      computeState(ctx);
      runs.push(performance.now() - t0);
    }
    runs.sort((a, b) => a - b);
    expect(runs[2]!).toBeLessThan(50);
    const st = computeState(ctx);
    expect(st.weeks).toHaveLength(13);
    expect(st.totals.sets).toBe(12 * 5 * 25 + 1);
    expectExplained(st);
    // Every decision is a valid synced row with a deterministic id.
    for (const d of st.decisions) {
      expect(Decision.safeParse(d).success, d.id).toBe(true);
      expect(d.id).toMatch(/^d:(init:|plan:\d{4}-\d{2}-\d{2}:[A-Z]+:|event:[a-z_.]+:|s\d+:)/);
    }
  });

  test("timestamps with offsets are normalized for decision dates", () => {
    const st = computeState(ctxOf(new History(), "2026-11-09T09:00:00+01:00"));
    expect(st.today).toBe(day(0));
    for (const d of st.decisions) expect(Decision.safeParse(d).success, d.id).toBe(true);
  });

  test("custom exercises from history can be block swapped in", () => {
    const h = new History();
    const ctx = ctxOf(h, at(day(0), "08:00"), { block_swaps: { A5: "my_raise" } });
    ctx.history.customExercises = [
      { ...ctx.exercises.lateral_raise!, id: "my_raise", name: "Band raise", custom: true, updated_at: at(day(0)), deleted_at: null },
    ];
    const ex = computeState(ctx).next.plan.exercises.find((e) => e.prescription_id === "A5")!;
    expect(ex).toMatchObject({ exercise_id: "my_raise", name: "Band raise", swapped: "block" });
    ctx.history.customExercises[0]!.deleted_at = at(day(0));
    expect(computeState(ctx).next.plan.exercises.find((e) => e.prescription_id === "A5")!.exercise_id).toBe("lateral_raise");
  });

  test("the engine never reads the clock or randomness", () => {
    const dir = join(__dirname, "../../src");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src, f).not.toMatch(/Date\.now\(|new Date\(\)|Math\.random|performance\.now/);
    }
  });
});
