#!/usr/bin/env node
/**
 * Downloads the two demo photos (start and end position) for every exercise in data/exercises.json
 * from free-exercise-db (Unlicense, same pinned commit as build-exercises.mjs) and writes them as
 * WebP into apps/web/public/ex/<id>-0.webp and <id>-1.webp.
 *
 *   node scripts/fetch-exercise-images.mjs [--force] [--cache <dir>]
 *
 * Needs `cwebp` on PATH (brew install webp). Originals are cached outside the repo.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REF = "f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5";
const OUT = resolve(ROOT, "apps/web/public/ex");
const args = process.argv.slice(2);
const force = args.includes("--force");
const cacheArg = args.indexOf("--cache");
const CACHE = cacheArg >= 0 ? resolve(args[cacheArg + 1]) : resolve(tmpdir(), "gym-ex-src");

// Our own exercises (no upstream entry) borrow the photos of the closest upstream movement.
const BORROW = {
  assisted_pull_up: "Band_Assisted_Pull-Up",
  cable_lateral_raise: "Cable_Seated_Lateral_Raise",
  hanging_knee_raise: "Hanging_Leg_Raise",
  landmine_press: "Landmine_Linear_Jammer",
  split_squat: "Split_Squat_with_Dumbbells",
  suitcase_carry: "Farmers_Walk",
};

const library = JSON.parse(readFileSync(resolve(ROOT, "data/exercises.json"), "utf8"));
const exercises = Array.isArray(library) ? library : library.exercises;
mkdirSync(OUT, { recursive: true });
mkdirSync(CACHE, { recursive: true });

let done = 0;
const missing = [];
for (const ex of exercises) {
  const src = ex.source_id ?? BORROW[ex.id];
  if (!src) {
    missing.push(ex.id);
    continue;
  }
  for (const n of [0, 1]) {
    const out = resolve(OUT, `${ex.id}-${n}.webp`);
    if (existsSync(out) && !force) continue;
    const raw = resolve(CACHE, `${src}-${n}.jpg`);
    if (!existsSync(raw)) {
      const url = `https://raw.githubusercontent.com/yuhonas/free-exercise-db/${REF}/exercises/${encodeURIComponent(src)}/${n}.jpg`;
      const res = await fetch(url);
      if (!res.ok) {
        missing.push(`${ex.id}-${n} (${res.status})`);
        continue;
      }
      writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
    }
    execFileSync("cwebp", ["-quiet", "-q", "70", "-resize", "640", "0", raw, "-o", out]);
    done += 1;
  }
}
const total = exercises.reduce((sum, ex) => {
  let s = sum;
  for (const n of [0, 1]) {
    const f = resolve(OUT, `${ex.id}-${n}.webp`);
    if (existsSync(f)) s += statSync(f).size;
  }
  return s;
}, 0);
console.log(`wrote ${done} images, ${(total / 1024 / 1024).toFixed(1)} MB in ${OUT}`);
if (missing.length) console.log("missing:", missing.join(", "));
