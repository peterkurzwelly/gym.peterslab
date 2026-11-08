/** Bundled config + library loading, and fresh install settings. */
import { z } from "zod";
import { EngineConfig, ExerciseLibraryFile, ProgramConfig } from "@gym/schema";
import type { Exercise, Settings } from "@gym/schema";
import engineJson from "../../../config/engine.json" with { type: "json" };
import programJson from "../../../config/program.json" with { type: "json" };
import libraryJson from "../../../data/exercises.json" with { type: "json" };

/** Engine version string, read from config/engine.json (engine_version). */
export const ENGINE_VERSION: string = engineJson.engine_version;

export interface Defaults {
  config: EngineConfig;
  program: ProgramConfig;
  exercises: Record<string, Exercise>;
}

function parseOrThrow<T extends z.ZodType>(schema: T, raw: unknown, file: string): z.output<T> {
  const res = schema.safeParse(raw);
  if (!res.success) throw new Error(`${file} is invalid:\n${z.prettifyError(res.error)}`);
  return res.data;
}

/** Every exercise id the program references (defaults and alternatives) that the library lacks. */
export function missingExerciseIds(program: ProgramConfig, exercises: Record<string, unknown>): string[] {
  const missing = new Set<string>();
  for (const day of program.days) {
    for (const p of day.prescriptions) {
      if (!exercises[p.exercise_id]) missing.add(p.exercise_id);
      for (const a of p.alternatives) if (!exercises[a.exercise_id]) missing.add(a.exercise_id);
    }
  }
  return [...missing].sort();
}

/** Validate raw config objects. Throws with a readable message listing what is wrong. */
export function validateDefaults(raw: { engine: unknown; program: unknown; library: unknown }): Defaults {
  const config = parseOrThrow(EngineConfig, raw.engine, "config/engine.json");
  const program = parseOrThrow(ProgramConfig, raw.program, "config/program.json");
  const library = parseOrThrow(ExerciseLibraryFile, raw.library, "data/exercises.json");

  const exercises: Record<string, Exercise> = {};
  const dupes: string[] = [];
  for (const ex of library.exercises) {
    if (exercises[ex.id]) dupes.push(ex.id);
    exercises[ex.id] = ex;
  }
  if (dupes.length) throw new Error(`data/exercises.json has duplicate exercise ids: ${dupes.join(", ")}`);

  const missing = missingExerciseIds(program, exercises);
  if (missing.length) {
    throw new Error(
      `config/program.json references ${missing.length} exercise id(s) missing from data/exercises.json: ${missing.join(", ")}`,
    );
  }

  const prescriptionIds = new Set(program.days.flatMap((d) => d.prescriptions.map((p) => p.id)));
  const badMain = program.main_lifts.filter((id) => !prescriptionIds.has(id));
  if (badMain.length) throw new Error(`config/program.json main_lifts lists unknown prescription ids: ${badMain.join(", ")}`);

  const codes = new Set(program.days.map((d) => d.code));
  const badRotation = program.rotation.filter((c) => !codes.has(c));
  if (badRotation.length) throw new Error(`config/program.json rotation lists days that do not exist: ${badRotation.join(", ")}`);

  return { config, program, exercises };
}

let cached: Defaults | null = null;

/**
 * Parse and validate the bundled config/engine.json, config/program.json and data/exercises.json.
 * Throws with a readable message when a file fails validation. The result is cached; treat it as read only.
 */
export function loadDefaults(): Defaults {
  if (!cached) cached = validateDefaults({ engine: engineJson, program: programJson, library: libraryJson });
  return cached;
}

/** Settings for a fresh install (block starts program.default_start_date, no limitations, start_pct from config). */
export function defaultSettings(config: EngineConfig, program: ProgramConfig, nowIso: string): Settings {
  return {
    id: "settings",
    block_start_date: program.default_start_date,
    block_number: 1,
    timezone: config.timezone_default,
    limitations: [],
    remembered_weights: {},
    interval_modality: "both",
    session_order: [...program.rotation],
    block_swaps: {},
    rest_overrides: {},
    increment_overrides: {},
    start_pct: config.calibration.start_pct,
    sound: true,
    updated_at: nowIso,
    deleted_at: null,
  };
}
