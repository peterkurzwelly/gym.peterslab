/**
 * Small per-device conveniences for the Today screen. Storage can throw or be empty (private mode,
 * cleared site data), so every read and write is guarded and the screen works without it.
 */
import type { SessionMode } from "@gym/schema";

type Area = "local" | "session";

function area(which: Area): Storage | null {
  try {
    return which === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readJson<T>(which: Area, key: string): T | null {
  try {
    const raw = area(which)?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeJson(which: Area, key: string, value: unknown): void {
  try {
    if (value == null) area(which)?.removeItem(key);
    else area(which)?.setItem(key, JSON.stringify(value));
  } catch {
    /* storage is a nicety */
  }
}

// ---------- check-in skip, remembered for the local date ----------

const SKIP_KEY = "gym.today.checkin-skip";

export function readCheckinSkip(today: string): boolean {
  return readJson<string>("local", SKIP_KEY) === today;
}

export function writeCheckinSkip(today: string): void {
  writeJson("local", SKIP_KEY, today);
}

// ---------- choices made before the first set (mode, swaps) ----------

export interface PreChoice {
  date: string;
  code: string;
  /** null follows the engine's recommended version. */
  mode: SessionMode | null;
  swaps: Record<string, string>;
}

const PRE_KEY = "gym.today.pre";

export function readPreChoice(date: string, code: string): PreChoice | null {
  const v = readJson<PreChoice>("session", PRE_KEY);
  return v && v.date === date && v.code === code ? v : null;
}

export function writePreChoice(v: PreChoice | null): void {
  writeJson("session", PRE_KEY, v);
}

// ---------- last cardio modality ----------

const MODALITY_KEY = "gym.today.cardio-modality";

export function readCardioModality(): string | null {
  return readJson<string>("local", MODALITY_KEY);
}

export function writeCardioModality(m: string): void {
  writeJson("local", MODALITY_KEY, m);
}

// ---------- interval timer run, kept across a remount or reload of the cardio panel ----------

const INTERVAL_KEY = "gym.today.interval";

export interface StoredIntervalRun {
  sessionId: string;
  startedAt: number;
  pausedAt: number | null;
  pausedMs: number;
  finished?: { minutes: number; hardMinutes: number } | null;
}

/** The stored timer run for this cardio session, or null. */
export function readIntervalRun(sessionId: string | null | undefined): StoredIntervalRun | null {
  if (!sessionId) return null;
  const v = readJson<StoredIntervalRun>("session", INTERVAL_KEY);
  return v && v.sessionId === sessionId && typeof v.startedAt === "number" ? v : null;
}

/** Stores the run for this session; null (or no session) forgets it. */
export function writeIntervalRun(sessionId: string | null | undefined, run: Omit<StoredIntervalRun, "sessionId"> | null): void {
  writeJson("session", INTERVAL_KEY, sessionId && run ? { ...run, sessionId } : null);
}

// ---------- pain flags of the open workout, also for exercises without a logged set yet ----------
const PAIN_KEY = "gym.workout.pain";

interface PainStore {
  sessionId: string;
  flags: Record<string, boolean>;
}

/** exercise_id -> pain on or off, for this session only. */
export function readPain(sessionId: string | null): Record<string, boolean> {
  if (!sessionId) return {};
  const v = readJson<PainStore>("local", PAIN_KEY);
  return v && v.sessionId === sessionId && v.flags && typeof v.flags === "object" ? v.flags : {};
}

/** Keeps one session's flags; null clears them. */
export function writePain(sessionId: string | null, flags: Record<string, boolean> | null): void {
  writeJson("local", PAIN_KEY, sessionId && flags && Object.keys(flags).length > 0 ? { sessionId, flags } : null);
}
