#!/usr/bin/env node
/**
 * Builds data/exercises.json from free-exercise-db (Unlicense) + data/exercise-curation.json.
 *
 *   node scripts/build-exercises.mjs                 fetch the pinned upstream commit
 *   node scripts/build-exercises.mjs --ref main      fetch another git ref
 *   node scripts/build-exercises.mjs --source f.json use a local copy of dist/exercises.json
 *
 * The curation file decides which exercises exist and holds every judgment call
 * (pattern, muscles, tags, fatigue, rest). This script fills the mechanical defaults,
 * cleans upstream instructions and writes a sorted, pretty-printed library.
 * Run `node scripts/validate-data.ts` afterwards.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CURATION_PATH = resolve(ROOT, "data/exercise-curation.json");
const OUT_PATH = resolve(ROOT, "data/exercises.json");

// Pinned upstream commit (2026-09-27) so rebuilds are reproducible.
const DEFAULT_REF = "f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5";
const upstreamUrl = (ref) =>
  `https://raw.githubusercontent.com/yuhonas/free-exercise-db/${ref}/dist/exercises.json`;

// free-exercise-db muscle names -> our Muscle enum. null = dropped.
const MUSCLE_MAP = {
  abdominals: "core",
  lats: "back",
  "middle back": "back",
  "lower back": "lower_back",
  quadriceps: "quads",
  adductors: "glutes",
  abductors: "glutes",
  neck: null,
  chest: "chest",
  shoulders: "shoulders",
  biceps: "biceps",
  triceps: "triceps",
  forearms: "forearms",
  traps: "traps",
  hamstrings: "hamstrings",
  glutes: "glutes",
  calves: "calves",
};

// Smallest load step by equipment (kg). Dumbbells are per dumbbell.
const INCREMENT_KG = {
  barbell: 2.5,
  trap_bar: 2.5,
  dumbbell: 2,
  kettlebell: 4,
  machine: 5,
  cable: 2.5,
  bodyweight: 2.5, // added load
  bench: 2.5, // added load (plate)
  band: 2.5,
  other: 2.5,
};

const LOWER_BODY_PATTERNS = new Set(["squat", "hinge", "lunge"]);

function parseArgs(argv) {
  const args = { ref: DEFAULT_REF, source: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--ref") args.ref = argv[++i];
    else if (argv[i] === "--source") args.source = argv[++i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

async function loadUpstream({ ref, source }) {
  if (source) return { list: JSON.parse(await readFile(resolve(source), "utf8")), origin: source };
  const url = upstreamUrl(ref);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed ${res.status} ${url}`);
  return { list: await res.json(), origin: url };
}

function mapMuscles(names) {
  return [...new Set(names.map((m) => MUSCLE_MAP[m]).filter(Boolean))];
}

// Strip upstream filler: tips/notes (some repeat the knees-over-toes myth),
// "starting position" markers, breathing cues and "repeat for reps" lines.
const DROP_SENTENCE = [
  /^[.\s]*$/, // leftover punctuation after removing a parenthetical
  /^this (will be|is) (your|the) (starting|start|initial) position\.?$/i,
  /^repeat\b/i,
  /^perform the amount\b/i,
  /^(inhale|exhale|breathe (in|out))\b[^.]*\.?$/i,
  /\bchapter\b/i,
];

function cleanInstructions(steps) {
  const out = [];
  for (let step of steps ?? []) {
    step = step
      .replace(/\((note|tip)[^)]*\)/gi, "")
      .replace(/\([^)]*(preference|section|chapter|described)[^)]*\)/gi, "")
      .replace(/\s*\b(tips?|note|caution|variations?)( on [a-z ]+)?:.*$/i, "")
      .replace(/\s*\bTips?\s+(?=[A-Z]).*$/, "") // "Tip Ideally, ..." without a colon
      .replace(/,?\s*(and )?repeat[^.]*?(recommended|prescribed) amount of repetitions/gi, "")
      .replace(/\s+\./g, ".")
      .replace(/\.{2,}/g, ".")
      .replace(/\s+/g, " ")
      .trim();
    const sentences = step
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s && !DROP_SENTENCE.some((re) => re.test(s)))
      .map((s) => (/[.!?]$/.test(s) ? s : `${s}.`));
    out.push(...packSentences(sentences));
  }
  return out;
}

// Keep steps short for a phone screen: pack sentences into steps of at most ~MAX_STEP chars.
const MAX_STEP = 180;
function packSentences(sentences) {
  const steps = [];
  let current = "";
  for (const s of sentences) {
    if (current && current.length + 1 + s.length > MAX_STEP) {
      steps.push(current);
      current = s;
    } else {
      current = current ? `${current} ${s}` : s;
    }
  }
  if (current) steps.push(current);
  return steps;
}

function buildExercise(id, cur, upstream) {
  const src = cur.source_id ? upstream.get(cur.source_id) : null;
  if (cur.source_id && !src) throw new Error(`${id}: source_id ${cur.source_id} not found upstream`);

  const primary = cur.primary_muscles ?? mapMuscles(src?.primaryMuscles ?? []);
  const secondary = (cur.secondary_muscles ?? mapMuscles(src?.secondaryMuscles ?? [])).filter(
    (m) => !primary.includes(m),
  );

  const equipment = cur.equipment;
  const increment = cur.increment_kg ?? INCREMENT_KG[equipment];
  const lowerBodyBar = (equipment === "barbell" || equipment === "trap_bar") && LOWER_BODY_PATTERNS.has(cur.pattern);
  const step = cur.step_kg ?? (lowerBodyBar ? 5 : increment);
  const bodyweight = cur.bodyweight ?? equipment === "bodyweight";
  const perHand = cur.per_hand ?? (equipment === "dumbbell" || equipment === "kettlebell");

  const tags = new Set(cur.tags ?? []);
  if (equipment === "machine") tags.add("machine");
  if (bodyweight) tags.add("bodyweight");

  const instructions = cur.instructions ?? cleanInstructions(src?.instructions);

  // Field order follows the Exercise schema.
  return {
    id,
    name: cur.name,
    pattern: cur.pattern,
    primary_muscles: primary,
    secondary_muscles: secondary,
    equipment,
    fatigue_rating: cur.fatigue_rating,
    increment_kg: increment,
    step_kg: step,
    default_rest_s: cur.default_rest_s,
    tags: [...tags].sort(),
    measure: cur.measure ?? "reps",
    per_hand: perHand,
    bodyweight,
    instructions,
    source: src ? "free-exercise-db" : "custom",
    source_id: src ? src.id : null,
    custom: false,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const curation = JSON.parse(await readFile(CURATION_PATH, "utf8"));
  const { list, origin } = await loadUpstream(args);
  const upstream = new Map(list.map((e) => [e.id, e]));

  const exercises = Object.entries(curation.exercises)
    .map(([id, cur]) => buildExercise(id, cur, upstream))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const file = {
    source: "free-exercise-db (github.com/yuhonas/free-exercise-db) + curation",
    license: "Unlicense",
    exercises,
  };
  await writeFile(OUT_PATH, `${JSON.stringify(file, null, 2)}\n`);

  const custom = exercises.filter((e) => e.source === "custom").map((e) => e.id);
  console.log(`Upstream: ${origin} (${list.length} exercises)`);
  console.log(`Wrote ${exercises.length} exercises to data/exercises.json`);
  console.log(`Custom (no upstream match): ${custom.join(", ") || "none"}`);
  console.log("Next: node scripts/validate-data.ts");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
