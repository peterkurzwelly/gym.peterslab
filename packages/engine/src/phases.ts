/** Phase per training week, including the deload week (planned or pulled forward). */
import type { EngineConfig, Phase, ProgramConfig, SetsRule } from "@gym/schema";

/** The program's deload phase entry, or one derived from the sets base phase when the program has none. */
export function deloadPhase(program: ProgramConfig, config: EngineConfig): Phase {
  const found = program.phases.find((p) => p.name === "deload");
  if (found) return found;
  const base = program.phases.find((p) => p.name === config.deload.sets_base_phase) ?? program.phases[0];
  return {
    name: "deload",
    label: "Deload week",
    week_from: config.deload.planned_week,
    week_to: config.deload.planned_week,
    rir_min: base?.rir_min ?? 0,
    rir_max: base?.rir_max ?? 0,
    sets: [],
    large_jumps: false,
    top_set: null,
  };
}

/**
 * Phase of a training week. Deload weeks come only from `deloadWeeks`; a week inside the program's
 * deload range that is not a deload week (deload moved) takes the phase before it. Weeks past the
 * last phase repeat the last one (consolidate).
 */
export function phaseForWeek(program: ProgramConfig, config: EngineConfig, tw: number, deloadWeeks: ReadonlySet<number>): Phase {
  if (deloadWeeks.has(tw)) return deloadPhase(program, config);
  const ordered = program.phases.filter((p) => p.name !== "deload").sort((a, b) => a.week_from - b.week_from);
  const first = ordered[0];
  if (!first) return deloadPhase(program, config);
  const inRange = ordered.find((p) => p.week_from <= tw && tw <= p.week_to);
  if (inRange) return inRange;
  let before: Phase | undefined;
  for (const p of ordered) if (p.week_to < tw) before = p;
  return before ?? first;
}

/** Sets rule of a phase covering the training week, else the nearest one. */
export function setsRuleFor(phase: Phase, tw: number): SetsRule | null {
  const rules = phase.sets;
  const hit = rules.find((r) => r.weeks[0] <= tw && tw <= r.weeks[1]);
  if (hit) return hit;
  const first = rules[0];
  if (!first) return null;
  if (tw < first.weeks[0]) return first;
  return rules[rules.length - 1] ?? null;
}

/** Initial deload weeks: the planned one, when it lies inside the block. */
export function plannedDeloadWeeks(program: ProgramConfig, config: EngineConfig): Set<number> {
  const s = new Set<number>();
  if (config.deload.planned_week >= 1 && config.deload.planned_week <= program.block_weeks) s.add(config.deload.planned_week);
  return s;
}
