/** Set order, next set and rest rules for Today (supersets and the travel circuit rest after the round). */
import { describe, expect, it } from "vitest";
import type { PlannedExercise } from "@gym/engine";
import type { SetLog } from "@gym/schema";
import { lastLogged, loggedKeys, nextSlot, orderSlots, restAfter, slotKey, slotLabel } from "../../src/screens/today/slots";

function ex(pid: string, sets: number, rest: number, group: string | null = null): PlannedExercise {
  return {
    prescription_id: pid,
    exercise_id: `ex_${pid}`,
    name: `Exercise ${pid}`,
    superset_group: group,
    rest_s: rest,
    sets: Array.from({ length: sets }, (_, index) => ({ index, weight: 20, reps: 10, rir: 2, kind: "work" as const })),
  } as unknown as PlannedExercise;
}

function log(pid: string, setIndex: number, at: string): SetLog {
  return {
    id: `${pid}-${setIndex}`,
    session_id: "S",
    exercise_id: `ex_${pid}`,
    prescription_id: pid,
    set_index: setIndex,
    is_warmup: false,
    deleted_at: null,
    completed_at: at,
    updated_at: at,
  } as unknown as SetLog;
}

// Session C shape: two straight exercises, then a curl + pushdown superset.
const plan = [ex("C1", 2, 120), ex("C2", 2, 90), ex("C5a", 2, 60, "S"), ex("C5b", 2, 75, "S")];
const slots = orderSlots(plan);

describe("today slots", () => {
  it("orders straight sets, then alternates superset members round by round", () => {
    expect(slots.map((s) => `${s.pid}:${s.setIndex}`)).toEqual(["C1:0", "C1:1", "C2:0", "C2:1", "C5a:0", "C5b:0", "C5a:1", "C5b:1"]);
  });

  it("highlights the first set at cold open and stays with the exercise logged last", () => {
    expect(nextSlot(slots, new Set(), null)).toMatchObject({ pid: "C1", setIndex: 0 });
    // Logged C2 set 1 out of order: finish C2 before going back to C1.
    const sets = [log("C2", 0, "2026-11-09T10:00:00Z")];
    expect(nextSlot(slots, loggedKeys(sets), lastLogged(plan, sets))).toMatchObject({ pid: "C2", setIndex: 1 });
    const more = [...sets, log("C2", 1, "2026-11-09T10:03:00Z")];
    expect(nextSlot(slots, loggedKeys(more), lastLogged(plan, more))).toMatchObject({ pid: "C1", setIndex: 0 });
  });

  it("rests after a straight set, and after the superset round with the longest rest", () => {
    const keys = new Set([slotKey("C1", "ex_C1", 0)]);
    expect(restAfter(plan, slots[0]!, keys)).toBe(120);

    const afterCurl = new Set([slotKey("C5a", "ex_C5a", 0)]);
    expect(restAfter(plan, slots[4]!, afterCurl)).toBeNull(); // straight on to the pushdown
    const afterPair = new Set([...afterCurl, slotKey("C5b", "ex_C5b", 0)]);
    expect(restAfter(plan, slots[5]!, afterPair)).toBe(75);
    expect(nextSlot(slots, afterPair, { pid: "C5b", setIndex: 0 })).toMatchObject({ pid: "C5a", setIndex: 1 });
  });

  it("travel circuit: one set of each, rest only after the round", () => {
    const circuit = [ex("T1", 3, 30, "T"), ex("T2", 3, 30, "T"), ex("T3", 3, 60, "T")];
    const order = orderSlots(circuit);
    expect(order.slice(0, 4).map((s) => `${s.pid}:${s.setIndex}`)).toEqual(["T1:0", "T2:0", "T3:0", "T1:1"]);
    const round = new Set(["T1", "T2", "T3"].map((p) => slotKey(p, `ex_${p}`, 0)));
    expect(restAfter(circuit, order[2]!, round)).toBe(60);
    expect(restAfter(circuit, order[1]!, new Set([slotKey("T1", "ex_T1", 0), slotKey("T2", "ex_T2", 0)]))).toBeNull();
    expect(slotLabel(circuit, order[3]!)).toBe("Set 2 · Exercise T1");
  });
});
