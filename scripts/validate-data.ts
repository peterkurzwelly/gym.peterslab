/**
 * Validates data/exercises.json against the schema and config/program.json.
 * Run: node scripts/validate-data.ts   (exit code 1 on any error)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Exercise, ExerciseLibraryFile, ProgramConfig } from "../packages/schema/src/index.ts";

const ROOT = resolve(import.meta.dirname, "..");
const readJson = (p: string): unknown => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));

const errors: string[] = [];
const warnings: string[] = [];
const summary: string[] = [];
const err = (msg: string) => errors.push(msg);
const warn = (msg: string) => warnings.push(msg);

const TAGS = new Set([
  "knee_friendly", "deep_knee_flexion", "low_spinal_load", "high_spinal_load", "unilateral",
  "shoulder_friendly", "overhead", "machine", "bodyweight", "assisted", "grip",
]);

// Allowed smallest load steps per equipment (kg).
const INCREMENTS: Record<string, number[]> = {
  barbell: [1.25, 2.5],
  trap_bar: [1.25, 2.5],
  dumbbell: [1, 2, 2.5],
  kettlebell: [2, 4],
  machine: [2.5, 5],
  cable: [1.25, 2.5, 5],
  bodyweight: [1.25, 2.5, 5],
  bench: [1.25, 2.5, 5],
  band: [1, 2.5],
  other: [1.25, 2.5, 5],
};

const isMultiple = (value: number, of: number) => Math.abs(value / of - Math.round(value / of)) < 1e-9;

// ---------- library ----------
const rawLibrary = readJson("data/exercises.json") as { exercises?: Record<string, unknown>[] };
const parsed = ExerciseLibraryFile.safeParse(rawLibrary);
if (!parsed.success) {
  for (const issue of parsed.error.issues) err(`schema: ${issue.path.join(".")}: ${issue.message}`);
  report();
}
const library = parsed.data!;

// Unknown keys are stripped by zod, so catch typos on the raw rows.
const knownKeys = new Set(Object.keys(Exercise.shape));
for (const row of rawLibrary.exercises ?? []) {
  for (const key of Object.keys(row)) if (!knownKeys.has(key)) err(`${row.id}: unknown field "${key}"`);
}

const byId = new Map<string, Exercise>();
for (const ex of library.exercises) {
  if (byId.has(ex.id)) err(`duplicate id ${ex.id}`);
  byId.set(ex.id, ex);
}

const ids = library.exercises.map((e) => e.id);
if (ids.join() !== [...ids].sort().join()) err("exercises are not sorted by id");

for (const ex of library.exercises) {
  const at = ex.id;
  if (!/^[a-z0-9_]+$/.test(at)) err(`${at}: id must be snake_case`);

  // muscles
  if (new Set(ex.primary_muscles).size !== ex.primary_muscles.length) err(`${at}: duplicate primary muscle`);
  if (new Set(ex.secondary_muscles).size !== ex.secondary_muscles.length) err(`${at}: duplicate secondary muscle`);
  for (const m of ex.secondary_muscles) if (ex.primary_muscles.includes(m)) err(`${at}: ${m} is both primary and secondary`);

  // loads
  const allowed = INCREMENTS[ex.equipment] ?? [];
  if (!allowed.includes(ex.increment_kg)) err(`${at}: increment_kg ${ex.increment_kg} unusual for ${ex.equipment} (allowed ${allowed.join(", ")})`);
  if (ex.step_kg < ex.increment_kg) err(`${at}: step_kg ${ex.step_kg} < increment_kg ${ex.increment_kg}`);
  if (!isMultiple(ex.step_kg, ex.increment_kg)) err(`${at}: step_kg ${ex.step_kg} is not a multiple of increment_kg ${ex.increment_kg}`);
  if (ex.step_kg > 10) err(`${at}: step_kg ${ex.step_kg} too large`);
  if (ex.step_kg > ex.increment_kg && !["squat", "hinge", "lunge"].includes(ex.pattern)) {
    warn(`${at}: step_kg above increment on an upper body or isolation exercise`);
  }

  // flags vs equipment
  if (ex.per_hand && ["machine", "trap_bar", "bodyweight", "bench"].includes(ex.equipment)) err(`${at}: per_hand with ${ex.equipment}`);
  if (ex.bodyweight && !["bodyweight", "bench", "other"].includes(ex.equipment)) err(`${at}: bodyweight with ${ex.equipment}`);
  if (!ex.bodyweight && ex.equipment === "bodyweight") err(`${at}: bodyweight equipment but bodyweight is false`);
  if (ex.bodyweight && ex.tags.includes("assisted")) err(`${at}: assisted exercises log assistance, not added load`);

  // measure vs pattern
  if (ex.measure === "seconds" && ex.pattern !== "core") err(`${at}: seconds outside core`);
  if (ex.measure === "meters" && ex.pattern !== "carry") err(`${at}: meters outside carry`);
  if (ex.pattern === "carry" && ex.measure !== "meters") err(`${at}: carries are measured in meters`);

  // tags
  for (const t of ex.tags) if (!TAGS.has(t)) err(`${at}: unknown tag ${t}`);
  if (new Set(ex.tags).size !== ex.tags.length) err(`${at}: duplicate tag`);
  if ((ex.equipment === "machine") !== ex.tags.includes("machine")) err(`${at}: machine tag must match machine equipment`);
  if (ex.bodyweight !== ex.tags.includes("bodyweight")) err(`${at}: bodyweight tag must match bodyweight flag`);
  if (ex.tags.includes("knee_friendly") && ex.tags.includes("deep_knee_flexion")) err(`${at}: knee_friendly and deep_knee_flexion`);
  if (ex.tags.includes("low_spinal_load") && ex.tags.includes("high_spinal_load")) err(`${at}: low and high spinal load`);

  // ratings and rest
  if ((ex.pattern === "isolation" || ex.pattern === "core") && ex.fatigue_rating > 2) err(`${at}: isolation/core with fatigue 3`);
  if (ex.default_rest_s < 30 || ex.default_rest_s > 300) err(`${at}: default_rest_s ${ex.default_rest_s} out of range`);

  // provenance
  if (ex.source === "free-exercise-db" && !ex.source_id) err(`${at}: free-exercise-db entry without source_id`);
  if (ex.source === "custom" && ex.source_id) err(`${at}: custom entry with a source_id`);
  if (!["free-exercise-db", "custom"].includes(ex.source)) err(`${at}: unexpected source ${ex.source}`);
  if (ex.custom) err(`${at}: library exercises must have custom false`);
  if (ex.instructions.length === 0) warn(`${at}: no instructions`);
}

// ---------- program ----------
const programParsed = ProgramConfig.safeParse(readJson("config/program.json"));
if (!programParsed.success) {
  for (const issue of programParsed.error.issues) err(`program.json: ${issue.path.join(".")}: ${issue.message}`);
  report();
}
const program = programParsed.data!;

const programIds = new Set<string>();
for (const day of program.days) {
  for (const p of day.prescriptions) {
    const where = `${day.code}/${p.id}`;
    programIds.add(p.exercise_id);
    const main = byId.get(p.exercise_id);
    if (!main) err(`${where}: exercise ${p.exercise_id} missing from library`);
    else if (main.measure !== p.measure) err(`${where}: prescription measure ${p.measure} but ${main.id} is ${main.measure}`);

    for (const alt of p.alternatives) {
      programIds.add(alt.exercise_id);
      const ex = byId.get(alt.exercise_id);
      if (!ex) {
        err(`${where}: alternative ${alt.exercise_id} missing from library`);
        continue;
      }
      const measure = alt.measure ?? p.measure;
      if (ex.measure !== measure) err(`${where}: alternative ${ex.id} measured in ${measure} but library says ${ex.measure}`);
      if (alt.exercise_id === p.exercise_id) err(`${where}: alternative equals the default exercise`);
    }
  }
}

// Limitation tags must exist on at least one exercise, otherwise the limitation is a no-op.
for (const [name, lim] of Object.entries(program.limitations)) {
  for (const t of [...lim.avoid_tags, ...lim.prefer_tags]) {
    if (!TAGS.has(t)) err(`limitation ${name}: unknown tag ${t}`);
    else if (!library.exercises.some((e) => e.tags.includes(t))) err(`limitation ${name}: no exercise carries ${t}`);
  }
}

// ---------- limitation swaps (mirrors ENGINE_RULES section 5.1, for review) ----------
type Swap = { at: string; from: string; to: string | null };

function limitationSwaps(active: string[]): Swap[] {
  const lims = active.map((n) => program.limitations[n]);
  const avoid = new Set(lims.flatMap((l) => l.avoid_tags));
  const prefer = new Set(lims.flatMap((l) => l.prefer_tags));
  const hasAny = (ex: Exercise | undefined, tags: Iterable<string>) => {
    const set = new Set(tags);
    return !!ex && ex.tags.some((t) => set.has(t));
  };
  const swaps: Swap[] = [];
  for (const day of program.days) {
    for (const p of day.prescriptions) {
      const def = byId.get(p.exercise_id);
      const alts = p.alternatives.map((a) => byId.get(a.exercise_id)).filter((e): e is Exercise => !!e);
      const allowed = alts.filter((a) => !hasAny(a, avoid));
      const avoidHit = hasAny(def, avoid);
      // Evaluated per limitation: one limitation's prefer tags are not satisfied by another's.
      const preferMiss = lims.some(
        (l) => l.prefer_tags.length > 0 && !hasAny(def, l.prefer_tags) && allowed.some((a) => hasAny(a, l.prefer_tags)),
      );
      if (!avoidHit && !preferMiss) continue;
      const pick = allowed.find((a) => hasAny(a, prefer)) ?? allowed[0] ?? null;
      swaps.push({ at: `${day.code}/${p.id}`, from: p.exercise_id, to: pick?.id ?? null });
    }
  }
  return swaps;
}

const names = Object.keys(program.limitations);
const swapSets: Record<string, Swap[]> = {};
for (const set of [...names.map((n) => [n]), names]) {
  const key = set.join(" + ");
  if (key in swapSets) continue;
  swapSets[key] = limitationSwaps(set);
}

const expectSwap = (lim: string, at: string, to: string) => {
  const s = swapSets[lim]?.find((x) => x.at === at);
  if (!s || s.to !== to) err(`limitation ${lim}: expected ${at} -> ${to}, got ${s ? s.to : "no swap"}`);
};
if (program.limitations.knee_friendly) expectSwap("knee_friendly", "A/A1", "hack_squat");
if (program.limitations.shoulder_symmetry) expectSwap("shoulder_symmetry", "C/C3", "one_arm_dumbbell_row");

for (const list of Object.values(swapSets)) {
  for (const s of list) if (s.to === null) warn(`${s.at}: ${s.from} hits an avoid tag and has no allowed alternative`);
}

const customCount = library.exercises.filter((e) => e.source === "custom").length;
summary.push(`Library: ${library.exercises.length} exercises (${customCount} custom), program references ${programIds.size} ids.`);
for (const [key, list] of Object.entries(swapSets)) {
  const text = list.map((s) => `${s.at} ${s.from} -> ${s.to ?? "(kept)"}`).join(", ");
  summary.push(`Limitation ${key}: ${text || "no swaps"}`);
}

report();

function report(): never {
  for (const line of summary) console.log(line);
  for (const w of warnings) console.warn(`warn: ${w}`);
  for (const e of errors) console.error(`error: ${e}`);
  console.log(errors.length ? `FAILED with ${errors.length} error(s).` : "OK");
  process.exit(errors.length ? 1 : 0);
}
