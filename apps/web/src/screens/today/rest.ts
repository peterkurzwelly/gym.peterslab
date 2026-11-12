/**
 * Rest timer state, kept outside React so it survives remounts, and in sessionStorage so it survives
 * a reload. Absolute timestamps only: right after iOS suspends the app.
 */
import { useSyncExternalStore } from "react";
import { flashScreen } from "../../lib/flash";
import { beepLong, vibrate } from "../../lib/sound";
import { readJson, writeJson } from "./storage";

export interface RestState {
  sessionId: string;
  startedAt: number;
  endsAt: number;
  /** What comes next, e.g. "Bench press · set 2". */
  label: string;
}

const KEY = "gym.today.rest";
let current: RestState | null = readJson<RestState>("session", KEY);
const listeners = new Set<() => void>();
/** endsAt of the rest that already alerted (one alert per rest, however many callers notice the end). */
let alertedFor: number | null = null;

function set(next: RestState | null) {
  current = next;
  writeJson("session", KEY, next);
  for (const l of listeners) l();
}

export function startRest(sessionId: string, seconds: number, label: string, now = Date.now()): void {
  alertedFor = null;
  set({ sessionId, startedAt: now, endsAt: now + seconds * 1000, label });
}

export function addRest(seconds: number): void {
  if (current) set({ ...current, endsAt: current.endsAt + seconds * 1000 });
}

/** A swap during the rest: the label names the exercise that is now up next. */
export function renameRest(from: string, to: string): void {
  if (current && from && to && from !== to && current.label.endsWith(`· ${from}`)) set({ ...current, label: current.label.slice(0, -from.length) + to });
}

export function clearRest(): void {
  if (current) set(null);
}

/** Noticing the end later than this means the app was in the background: no beep, just clear. */
export const LATE_ALERT_MS = 3000;

/**
 * Ends the rest once it is over: beep, flash and vibrate when on time, then clear it. Safe to call from
 * several places (the dock timer and the app wide watcher): one alert per endsAt. Returns true when it ended.
 */
export function endRest(sound: boolean, now = Date.now()): boolean {
  const r = current;
  if (!r || now < r.endsAt) return false;
  if (alertedFor !== r.endsAt) {
    alertedFor = r.endsAt;
    if (now - r.endsAt < LATE_ALERT_MS) {
      if (sound) beepLong();
      flashScreen();
      vibrate([250, 120, 250]);
    }
  }
  set(null);
  return true;
}

/** The running rest of any session (the app wide watcher and the header chip). */
export function useAnyRest(): RestState | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Test hook: forget in-memory state and re-read storage. */
export function resetRestForTests(): void {
  alertedFor = null;
  current = readJson<RestState>("session", KEY);
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const snapshot = () => current;

/** The running rest for this session, or null. */
export function useRest(sessionId: string | null): RestState | null {
  const rest = useSyncExternalStore(subscribe, snapshot, snapshot);
  return rest && sessionId && rest.sessionId === sessionId ? rest : null;
}
