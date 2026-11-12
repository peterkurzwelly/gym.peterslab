/** Plain words for effort. The engine speaks RIR (reps in reserve); the screen says how many reps to leave. */
import type { PlannedExercise, SessionPlan } from "@gym/engine";
import { fmtRangeAmount } from "./format";

/** "leave 3 in the tank", "all out". */
export function effortText(rir: number): string {
  if (rir <= 0) return "all out";
  return `leave ${rir} in the tank`;
}

/** Short tag next to a logged set: "3 left", "max". */
export function effortTag(rir: number): string {
  return rir <= 0 ? "max" : `${rir} left`;
}

/** "3 sets · 5–8 reps · leave 3 in the tank" (plus "+ top set"). */
export function targetLine(ex: PlannedExercise): string {
  const work = ex.sets.filter((s) => s.kind === "work").length;
  const top = ex.sets.some((s) => s.kind === "top");
  const range = fmtRangeAmount(ex.rep_min, ex.rep_max, ex);
  const amount = ex.measure === "reps" ? `${range} reps` : range;
  return `${work} ${work === 1 ? "set" : "sets"} · ${amount} · ${effortText(ex.target_rir)}${top ? " · plus one top set" : ""}`;
}

/** What this part of the 12 weeks is for, in one line. */
export function phaseLine(phase: SessionPlan["phase"]): string {
  switch (phase) {
    case "return":
      return "Easy on purpose. Learn the moves, stop every set with reps to spare.";
    case "build":
      return "Solid work. Add reps or weight wherever the app says so.";
    case "deload":
      return "Recovery week. Half the sets, same weights.";
    case "push":
      return "The hard block. Sets end close to your limit.";
    case "consolidate":
      return "Last week. One top set per main lift shows what you built.";
    default:
      return "";
  }
}
