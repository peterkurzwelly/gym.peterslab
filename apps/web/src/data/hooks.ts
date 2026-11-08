/**
 * React hooks over Dexie + the engine. Engine errors never throw into render: they come back as `error`.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  computeState,
  planSession,
  summarizeSession,
  type CardioPlan,
  type EngineContext,
  type EngineState,
  type PlanOptions,
  type SessionPlan,
  type SessionSummary,
} from "@gym/engine";
import type { CardioLog, Checkin, Session, SetLog, Settings } from "@gym/schema";
import { db } from "./db";
import { nowIso } from "./clock";
import { buildContext, readSnapshot, snapshotSignature, type DataSnapshot } from "./context";
import { ensureSettings, persistAutoFinished, persistDecisions } from "./repo";

const NOW_REFRESH_MS = 30_000;

const toError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)));

// ---------- shared "now" (one ticker for every hook) ----------

let currentNow = nowIso();
const nowListeners = new Set<() => void>();
let stopTicker: (() => void) | null = null;

function tickNow() {
  currentNow = nowIso();
  for (const l of nowListeners) l();
}

function subscribeNow(listener: () => void): () => void {
  nowListeners.add(listener);
  if (!stopTicker) {
    tickNow();
    const id = setInterval(tickNow, NOW_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") tickNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    stopTicker = () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }
  return () => {
    nowListeners.delete(listener);
    if (!nowListeners.size && stopTicker) {
      stopTicker();
      stopTicker = null;
    }
  };
}

/** ISO now, refreshed every 30 s and whenever the app becomes visible. */
export function useNow(): string {
  return useSyncExternalStore(subscribeNow, () => currentNow, () => currentNow);
}

// ---------- engine state ----------

export interface EngineResult {
  /** Data loaded and the engine ran (state or error is set). */
  ready: boolean;
  state: EngineState | null;
  ctx: EngineContext | null;
  error: Error | null;
}

type SnapshotResult = { snapshot: DataSnapshot; error: null } | { snapshot: null; error: Error };

/**
 * The engine ignores sessions that start after ctx.now, so a write newer than the 30 s ticker (the
 * session the first set just started) must move "now" forward before the next render. Rounded up to
 * the next whole second so hook instances reading the same write still share one computeState.
 * Silent on purpose: the live query result that follows re-renders with the new value.
 */
function advanceNowTo(iso: string) {
  const ms = Math.ceil(Date.parse(iso) / 1000) * 1000;
  const next = new Date(ms).toISOString();
  if (next > currentNow) currentNow = next;
}

async function querySnapshot(): Promise<SnapshotResult> {
  try {
    const snapshot = await readSnapshot();
    advanceNowTo(nowIso());
    return { snapshot, error: null };
  } catch (e) {
    return { snapshot: null, error: toError(e) };
  }
}

// Several components may call useEngine at once: share one computeState per (data, now).
let lastCompute: { key: string; value: EngineResult } | null = null;

function computeCached(snapshot: DataSnapshot, now: string): EngineResult {
  const key = `${snapshotSignature(snapshot)}|${now}`;
  if (lastCompute?.key === key) return lastCompute.value;
  let value: EngineResult;
  let ctx: EngineContext | null = null;
  try {
    ctx = buildContext(snapshot, now);
    value = { ready: true, ctx, state: computeState(ctx), error: null };
  } catch (e) {
    console.warn("[engine]", e);
    value = { ready: true, ctx, state: null, error: toError(e) };
  }
  lastCompute = { key, value };
  return value;
}

// Shared across hook instances so StrictMode / several components create the row once.
let ensuring: Promise<unknown> | null = null;
function ensureSettingsOnce() {
  ensuring ??= ensureSettings()
    .catch((e) => console.warn("[data] could not create settings", e))
    .finally(() => {
      ensuring = null;
    });
}

const handledAutoFinish = new Set<string>();
async function persistAutoFinishedOnce(state: EngineState) {
  const fresh = state.auto_finished.filter((a) => !handledAutoFinish.has(a.session_id));
  if (!fresh.length) return;
  for (const a of fresh) handledAutoFinish.add(a.session_id);
  try {
    await persistAutoFinished(fresh);
    const ids = new Set(fresh.map((a) => a.session_id));
    await persistDecisions(state.decisions.filter((d) => d.session_id != null && ids.has(d.session_id)));
  } catch (e) {
    console.warn("[data] could not persist auto finished sessions", e);
  }
}

/** Live engine state from Dexie. Recomputes on every local or synced write, every 30 s and on app focus. */
export function useEngine(): EngineResult {
  const live = useLiveQuery(querySnapshot, []);
  const now = useNow();

  const result = useMemo<EngineResult>(() => {
    if (!live) return { ready: false, state: null, ctx: null, error: null };
    if (live.error) return { ready: true, state: null, ctx: null, error: live.error };
    return computeCached(live.snapshot, now);
  }, [live, now]);

  const missingSettings = !!live?.snapshot && !live.snapshot.settings;
  useEffect(() => {
    if (missingSettings) ensureSettingsOnce();
  }, [missingSettings]);

  useEffect(() => {
    if (result.state?.auto_finished.length) void persistAutoFinishedOnce(result.state);
  }, [result.state]);

  return result;
}

export interface PlanResult {
  ready: boolean;
  plan: SessionPlan | null;
  error: Error | null;
}

/** planSession for any code and mode. Pass opts.sessionId when resuming so targets stay frozen. null → no plan. */
export function usePlan(opts: PlanOptions | null): PlanResult {
  const { ready, ctx, error } = useEngine();
  // opts is compared by value (its JSON), so inline objects do not recompute every render.
  const key = opts ? JSON.stringify(opts) : null;
  return useMemo(() => {
    const o = key ? (JSON.parse(key) as PlanOptions) : null;
    if (!ctx || !o) return { ready, plan: null, error: ctx ? null : error };
    try {
      return { ready: true, plan: planSession(ctx, o), error: null };
    } catch (e) {
      return { ready: true, plan: null, error: toError(e) };
    }
  }, [ctx, key, ready, error]);
}

export interface SummaryResult {
  ready: boolean;
  summary: SessionSummary | null;
  error: Error | null;
}

/** Summary for a finished session (what changed for next time and why). summary is null if the session is unknown. */
export function useSessionSummary(sessionId: string | null | undefined): SummaryResult {
  const { ready, ctx, error } = useEngine();
  return useMemo(() => {
    if (!ctx || !sessionId) return { ready, summary: null, error: ctx ? null : error };
    if (!ctx.history.sessions.some((s) => s.id === sessionId)) return { ready: true, summary: null, error: null };
    try {
      return { ready: true, summary: summarizeSession(ctx, sessionId), error: null };
    } catch (e) {
      return { ready: true, summary: null, error: toError(e) };
    }
  }, [ctx, sessionId, ready, error]);
}

export interface CardioPlanResult {
  ready: boolean;
  plan: CardioPlan | null;
  error: Error | null;
}

/** Cardio plan for this training week (readiness swap and spacing warnings applied). */
export function useCardioPlan(): CardioPlanResult {
  const { ready, state, error } = useEngine();
  return { ready, plan: state?.cardio ?? null, error };
}

// ---------- plain live reads ----------

/** The settings row (undefined while loading, null if not created yet). */
export function useSettings(): Settings | null | undefined {
  return useLiveQuery(async () => {
    const s = await db.settings.get("settings");
    return s && !s.deleted_at ? s : null;
  }, []);
}

export interface SessionLogs {
  session: Session | null;
  /** Logged sets in log order. */
  sets: SetLog[];
  cardio: CardioLog[];
}

/** Session row + its logged sets and cardio logs, live. undefined while loading. */
export function useSessionLogs(sessionId: string | null | undefined): SessionLogs | undefined {
  return useLiveQuery(async () => {
    if (!sessionId) return { session: null, sets: [], cardio: [] };
    const [session, sets, cardio] = await Promise.all([
      db.session.get(sessionId),
      db.set_log.where("session_id").equals(sessionId).toArray(),
      db.cardio_log.where("session_id").equals(sessionId).toArray(),
    ]);
    return {
      session: session && !session.deleted_at ? session : null,
      sets: sets
        .filter((s) => !s.deleted_at)
        .sort((a, b) => a.completed_at.localeCompare(b.completed_at) || a.set_index - b.set_index),
      cardio: cardio.filter((c) => !c.deleted_at),
    };
  }, [sessionId]);
}

/** Check-in for a local date (null if none). undefined while loading. */
export function useCheckin(date: string | null | undefined): Checkin | null | undefined {
  return useLiveQuery(async () => {
    if (!date) return null;
    const c = await db.checkin.get(`ck_${date}`);
    return c && !c.deleted_at ? c : null;
  }, [date]);
}
