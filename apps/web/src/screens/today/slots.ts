/**
 * Pure helpers for the order sets are done in. No numbers are computed here: targets come from the plan.
 * Supersets (and the travel circuit) alternate: one set of each member, then the next round.
 */
import type { PlannedExercise } from "@gym/engine";
import type { SetLog } from "@gym/schema";

export interface Slot {
  pid: string;
  exerciseId: string;
  exIndex: number;
  setIndex: number;
  /** superset_group, or the prescription id for a single exercise. */
  group: string;
}

const groupOf = (ex: PlannedExercise) => (ex.superset_group ? `g:${ex.superset_group}` : `p:${ex.prescription_id}`);

/** Every planned set in the order it is meant to be done. */
export function orderSlots(exercises: PlannedExercise[]): Slot[] {
  const out: Slot[] = [];
  const emitted = new Set<string>();
  exercises.forEach((ex) => {
    const group = groupOf(ex);
    if (emitted.has(group)) return;
    emitted.add(group);
    const members = exercises.map((e, i) => ({ e, i })).filter(({ e }) => groupOf(e) === group);
    const rounds = Math.max(...members.map(({ e }) => e.sets.length));
    for (let r = 0; r < rounds; r++) {
      for (const { e, i } of members) {
        const set = e.sets[r];
        if (set) out.push({ pid: e.prescription_id, exerciseId: e.exercise_id, exIndex: i, setIndex: set.index, group });
      }
    }
  });
  return out;
}

/** Working sets logged for this planned exercise (same prescription and the exercise now planned). */
export function logsFor(ex: PlannedExercise, sets: SetLog[]): SetLog[] {
  return sets.filter((s) => !s.deleted_at && !s.is_warmup && s.prescription_id === ex.prescription_id && s.exercise_id === ex.exercise_id);
}

export type LoggedKey = (pid: string, exerciseId: string, setIndex: number) => string;
export const slotKey: LoggedKey = (pid, exerciseId, setIndex) => `${pid}|${exerciseId}|${setIndex}`;

export function loggedKeys(sets: SetLog[]): Set<string> {
  return new Set(sets.filter((s) => !s.deleted_at && !s.is_warmup).map((s) => slotKey(s.prescription_id ?? "", s.exercise_id, s.set_index)));
}

/**
 * The set to highlight next: stay with the exercise (or superset) logged last until it is done,
 * then the earliest set not logged yet.
 */
export function nextSlot(slots: Slot[], logged: Set<string>, last: { pid: string; setIndex: number } | null): Slot | null {
  const open = (s: Slot) => !logged.has(slotKey(s.pid, s.exerciseId, s.setIndex));
  if (last) {
    const at = slots.findIndex((s) => s.pid === last.pid && s.setIndex === last.setIndex);
    if (at >= 0) {
      const group = slots[at]!.group;
      const inGroup = slots.map((s, i) => ({ s, i })).filter(({ s }) => s.group === group);
      const after = inGroup.find(({ s, i }) => i > at && open(s)) ?? inGroup.find(({ s }) => open(s));
      if (after) return after.s;
    }
  }
  return slots.find(open) ?? null;
}

/** The most recently logged set of this plan, by completion time. */
export function lastLogged(exercises: PlannedExercise[], sets: SetLog[]): { pid: string; setIndex: number } | null {
  const planned = new Set(exercises.map((e) => `${e.prescription_id}|${e.exercise_id}`));
  let best: SetLog | null = null;
  for (const s of sets) {
    if (s.deleted_at || s.is_warmup || !planned.has(`${s.prescription_id}|${s.exercise_id}`)) continue;
    if (!best || s.completed_at > best.completed_at || (s.completed_at === best.completed_at && s.updated_at > best.updated_at)) best = s;
  }
  return best ? { pid: best.prescription_id ?? "", setIndex: best.set_index } : null;
}

/**
 * Rest in seconds after logging `slot`, or null when no rest is due: the next superset member comes
 * first, or nothing is left. A superset rests after the round, for the longest rest of its members.
 */
export function restAfter(exercises: PlannedExercise[], slot: Slot, logged: Set<string>): number | null {
  const ex = exercises[slot.exIndex];
  if (!ex) return null;
  if (!ex.superset_group) return ex.rest_s;
  const members = exercises.filter((e) => e.superset_group === ex.superset_group);
  const inRound = members.filter((e) => e.sets.some((s) => s.index === slot.setIndex));
  const roundDone = inRound.every((e) => logged.has(slotKey(e.prescription_id, e.exercise_id, slot.setIndex)));
  return roundDone ? Math.max(...members.map((e) => e.rest_s)) : null;
}

/** "Set 2 · Bench press", "Top set · Bench press". Set first: the rest bar truncates the end. */
export function slotLabel(exercises: PlannedExercise[], slot: Slot): string {
  const ex = exercises[slot.exIndex];
  if (!ex) return "";
  const set = ex.sets.find((s) => s.index === slot.setIndex);
  return `${set?.kind === "top" ? "Top set" : `Set ${slot.setIndex + 1}`} · ${ex.name}`;
}
