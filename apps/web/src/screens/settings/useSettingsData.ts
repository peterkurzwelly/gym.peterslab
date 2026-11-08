/** Read side for the settings screen: bundled config (program, calibration range) and the exercise list. */
import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Exercise, ProgramConfig } from "@gym/schema";
import { defaultSettings } from "@gym/engine";
import { db, getDefaults } from "../../data";

export interface SettingsDefaults {
  program: ProgramConfig;
  /** Week 1 start % range from config/engine.json calibration. */
  calibration: { min: number; max: number };
  /** Main lift exercise ids in program order (back squat, bench press, trap bar deadlift, overhead press). */
  mainIds: string[];
  /** Every exercise id the program prescribes (alternatives included). */
  programIds: Set<string>;
  /** exercise_id → rest seconds from its first prescription (what the engine uses without an override). */
  programRest: Record<string, number>;
  /** Evening hour a fresh install gets (used when the evening switch is turned back on). */
  eveningDefault: number;
}

let cached: SettingsDefaults | null = null;

export function settingsDefaults(): SettingsDefaults {
  if (cached) return cached;
  const { program, config } = getDefaults();
  const byPrescription = new Map<string, string>();
  const programIds = new Set<string>();
  const programRest: Record<string, number> = {};
  for (const day of program.days) {
    for (const p of day.prescriptions) {
      byPrescription.set(p.id, p.exercise_id);
      programIds.add(p.exercise_id);
      programRest[p.exercise_id] ??= p.rest_s;
      for (const a of p.alternatives) programIds.add(a.exercise_id);
    }
  }
  const mainIds = program.main_lifts.map((id) => byPrescription.get(id) ?? id);
  cached = {
    program,
    calibration: { min: config.calibration.start_pct_min, max: config.calibration.start_pct_max },
    mainIds,
    programIds,
    programRest,
    eveningDefault: defaultSettings(config, program, new Date(0).toISOString()).evening_hour ?? 19,
  };
  return cached;
}

/** Library plus live custom exercises (custom wins on id clash, deleted ones skipped). */
export function useExercises(): Record<string, Exercise> {
  const custom = useLiveQuery(() => db.exercise.toArray(), [], []);
  return useMemo(() => {
    const out: Record<string, Exercise> = { ...getDefaults().exercises };
    for (const row of custom) {
      const { updated_at: _u, deleted_at, ...ex } = row;
      if (!deleted_at) out[ex.id] = ex;
    }
    return out;
  }, [custom]);
}
