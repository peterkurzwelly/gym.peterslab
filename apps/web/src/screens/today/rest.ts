/**
 * Rest timer state, kept outside React so it survives remounts, and in sessionStorage so it survives
 * a reload. Absolute timestamps only: right after iOS suspends the app.
 */
import { useSyncExternalStore } from "react";
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

function set(next: RestState | null) {
  current = next;
  writeJson("session", KEY, next);
  for (const l of listeners) l();
}

export function startRest(sessionId: string, seconds: number, label: string, now = Date.now()): void {
  set({ sessionId, startedAt: now, endsAt: now + seconds * 1000, label });
}

export function addRest(seconds: number): void {
  if (current) set({ ...current, endsAt: current.endsAt + seconds * 1000 });
}

export function clearRest(): void {
  if (current) set(null);
}

/** Test hook: forget in-memory state and re-read storage. */
export function resetRestForTests(): void {
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
