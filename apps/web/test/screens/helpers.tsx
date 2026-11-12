/**
 * Shared setup for the screen tests: the real engine over Dexie (fake-indexeddb) with a clock the test owns,
 * history seeded through the repo, and a router host that shows where a tap navigated to.
 */
import { cleanup, configure, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { computeState, planSession } from "@gym/engine";
import type { Settings } from "@gym/schema";
import { AppShell } from "../../src/components/AppShell";
import { GuideProvider } from "../../src/components/GuideSheet";
import { db, finishSession, loadContext, logCardio, logSet, saveBodyLog, setClock, startCardioSession, startSession, updateSettings } from "../../src/data";
import * as repo from "../../src/data/repo";
import { markSessionOpen } from "../../src/lib/updatePolicy";
import { RestChip } from "../../src/screens/today/RestAlert";
import { resetRestForTests } from "../../src/screens/today/rest";
import { resetDb } from "../data/helpers";

// These tests do real IndexedDB round trips and run the real engine: give findBy and waitFor room on a busy machine.
configure({ asyncUtilTimeout: 3000 });

/** Monday 9 Nov 2026, 08:00 in Stockholm: the first morning of block week 1. */
export const BLOCK_DAY_ONE = "2026-11-09T07:00:00.000Z";

let now = BLOCK_DAY_ONE;
/** Move the app clock (data layer and engine). */
export function at(iso: string): void {
  now = iso;
}
export const clockNow = (): string => now;

/** Fresh database, settings row, storage and rest timer; the clock at `startIso`. Call in beforeEach. */
export async function resetApp(startIso: string = BLOCK_DAY_ONE): Promise<void> {
  window.scrollTo = (() => {}) as typeof window.scrollTo; // jsdom has no layout
  await resetDb();
  at(startIso);
  setClock(() => now);
  for (const store of [() => window.sessionStorage, () => window.localStorage]) {
    try {
      store()?.clear();
    } catch {
      /* Node's own localStorage stub may shadow jsdom's */
    }
  }
  resetRestForTests();
  markSessionOpen(null);
  await repo.ensureSettings();
}

/** Call in afterEach. */
export function teardownApp(): void {
  cleanup();
  setClock(null);
}

export async function liveSessions() {
  return (await db.session.toArray()).filter((s) => !s.deleted_at);
}
export async function liveSets() {
  return (await db.set_log.toArray()).filter((s) => !s.deleted_at);
}
export async function settingsRow(): Promise<Settings> {
  const s = await db.settings.get("settings");
  if (!s) throw new Error("no settings row");
  return s;
}

export interface SeedOptions {
  /** Log only the first n exercises (default: all). */
  exercises?: number;
  /** Leave the session open (default: finish it). */
  open?: boolean;
  /** Weight for sets without one (calibration). */
  pick?: number;
}

/** The next strength session in line, logged as prescribed from `startIso` (2 min per set). Returns its id. */
export async function strength(startIso: string, { exercises, open = false, pick = 40 }: SeedOptions = {}): Promise<string> {
  at(startIso);
  const ctx = await loadContext(startIso);
  const code = computeState(ctx).next.code;
  const plan = planSession(ctx, { code, mode: "full" });
  const s = await startSession({ code, mode: "full", flags: plan.flags });
  let t = Date.parse(startIso);
  for (const ex of plan.exercises.slice(0, exercises ?? plan.exercises.length)) {
    for (const set of ex.sets) {
      t += 120_000;
      at(new Date(t).toISOString());
      await logSet({
        sessionId: s.id,
        prescriptionId: ex.prescription_id,
        exerciseId: ex.exercise_id,
        setIndex: set.index,
        target: { weight: set.weight, reps: set.reps, rir: set.rir },
        weight: set.weight ?? (ex.bodyweight ? 0 : pick),
        reps: ex.calibration ? ex.rep_max : set.reps,
        rir: set.rir,
      });
    }
  }
  at(new Date(t + 300_000).toISOString());
  if (!open) await finishSession(s.id);
  return s.id;
}

/** One finished interval cardio session (bike, 26 min, 8 hard). Returns its id. */
export async function cardio(startIso: string): Promise<string> {
  at(startIso);
  const s = await startCardioSession();
  await logCardio({ sessionId: s.id, modality: "bike", minutes: 26, hardMinutes: 8, intensity: "hard", source: "timer" });
  at(new Date(Date.parse(startIso) + 30 * 60_000).toISOString());
  await finishSession(s.id);
  return s.id;
}

/** Sex, birth year, height and one weigh-in today: what the engine needs for calorie and protein targets. */
export async function completeProfile(weightKg = 85, date = now.slice(0, 10)): Promise<void> {
  await updateSettings({ sex: "male", birth_year: 1986, height_cm: 180 });
  await saveBodyLog(date, { weight_kg: weightKg });
}

/** Shows the current route, so a test can assert where a button led. */
function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}
export const where = (): string => document.querySelector('[data-testid="where"]')?.textContent ?? "";

/**
 * Renders `routes` (path → element) inside the app frame: router, guide sheet provider and shell with the
 * rest chip. Paths without an element in `routes` render nothing; `where()` still reports them.
 */
export function renderApp(path: string, routes: Record<string, ReactNode>) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <GuideProvider>
        <AppShell sync={<RestChip />}>
          <Where />
          <Routes>
            {Object.entries(routes).map(([p, element]) => (
              <Route key={p} path={p} element={element} />
            ))}
            <Route path="*" element={null} />
          </Routes>
        </AppShell>
      </GuideProvider>
    </MemoryRouter>,
  );
}
