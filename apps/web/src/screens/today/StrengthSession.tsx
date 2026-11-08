/**
 * Exercise cards for the selected plan, loggable before a session exists: the first confirmed set
 * starts the session and logs in the same tap. While a session runs this also owns the dock
 * (rest timer + finish bar) and the discard action.
 */
import type { PlannedExercise, PlannedSet, SessionPlan } from "@gym/engine";
import type { Exercise, Session, SetLog } from "@gym/schema";
import { useEffect, useMemo, useRef, useState } from "react";
import { ExerciseCard, FinishBar, Pill, RestTimer, ShellDock, type SetValues } from "../../components";
import { discardSession, finishSession, logSet, setPain, swapExercise, updateSet, useSessionLogs } from "../../data";
import { addRest, clearRest, startRest, useRest } from "./rest";
import { lastLogged, loggedKeys, logsFor, nextSlot, orderSlots, restAfter, slotKey, slotLabel } from "./slots";
import { DiscardControl } from "./DiscardControl";
import { QuickStartBar } from "./QuickStart";

export interface StrengthSessionProps {
  plan: SessionPlan;
  /** The session in progress (state.active), or null before the first set. */
  session: Session | null;
  /** Creates the session on the first confirmed set (code, mode, swaps and plan flags). */
  start: () => Promise<Session>;
  exercises: Record<string, Exercise>;
  today: string;
  swapping: boolean;
  /** Swap before the session exists (kept in the screen's local state). */
  onPreSwap: (prescriptionId: string, exerciseId: string | null) => void;
  blockSwaps: Record<string, string>;
  sound: boolean;
  onFinished: (sessionId: string) => void;
}

const SCROLL_TOP_MARGIN = "64px";

/** Bring the highlighted set above the dock (scroll margin uses --shell-bottom from the AppShell). */
function scrollToNext(list: HTMLElement | null, smooth: boolean) {
  const row = list?.querySelector<HTMLElement>('[data-state="next"]');
  if (!row || typeof row.scrollIntoView !== "function") return;
  row.style.scrollMarginBottom = "calc(var(--shell-bottom, 160px) + 8px)";
  row.style.scrollMarginTop = SCROLL_TOP_MARGIN;
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  row.scrollIntoView({ block: "nearest", behavior: smooth && !reduce ? "smooth" : "auto" });
}

/** Open the steppers on the highlighted row (it scrolls itself above the dock). */
function openNextEditor(pid: string) {
  const safe = typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(pid) : pid;
  const row = document.querySelector<HTMLElement>(`[data-pid="${safe}"] [data-state="next"]`);
  const adjust = row?.querySelector<HTMLButtonElement>("button");
  if (adjust) adjust.click();
}

export function StrengthSession({ plan, session, start, exercises, today, swapping, onPreSwap, blockSwaps, sound, onFinished }: StrengthSessionProps) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const starting = useRef<Promise<string> | null>(null);
  const sessionId = session?.id ?? pendingId;
  const logs = useSessionLogs(sessionId);
  const liveSession = session ?? (logs?.session && logs.session.id === pendingId && !logs.session.ended_at ? logs.session : null);
  const logsLoaded = !sessionId || logs?.session?.id === sessionId;
  const sets: SetLog[] = useMemo(() => (sessionId && logs?.session?.id === sessionId ? logs.sets : []), [sessionId, logs]);

  const [painLocal, setPainLocal] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [quickBusy, setQuickBusy] = useState(false);
  // While a set's steppers are open, the dock's quick check would only compete with Done.
  const listRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof MutationObserver === "undefined") return;
    const check = () => setEditing(!!el.querySelector('[data-state="editing"]'));
    const mo = new MutationObserver(check);
    mo.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-state"] });
    check();
    return () => mo.disconnect();
  }, []);
  const rest = useRest(sessionId);

  // A finished, discarded or auto finished session: back to a clean slate.
  const prevSession = useRef<string | null>(session?.id ?? null);
  useEffect(() => {
    const prev = prevSession.current;
    prevSession.current = session?.id ?? null;
    if (prev && !session) {
      setPendingId(null);
      starting.current = null;
      setPainLocal({});
      setFinishing(false);
    }
  }, [session]);

  const slots = useMemo(() => orderSlots(plan.exercises), [plan.exercises]);
  const keys = useMemo(() => loggedKeys(sets), [sets]);
  const next = useMemo(() => nextSlot(slots, keys, lastLogged(plan.exercises, sets)), [slots, keys, plan.exercises, sets]);

  // Land on the next set when a running session is shown (resume, or right after the first set),
  // and keep it in view after each confirm.
  const scrollAfterConfirm = useRef(false);
  const landed = useRef(false);
  useEffect(() => {
    if (!next || !logsLoaded) return;
    if (session && !landed.current) {
      landed.current = true;
      window.setTimeout(() => scrollToNext(listRef.current, false), 30);
    } else if (scrollAfterConfirm.current) {
      scrollAfterConfirm.current = false;
      // Wait a beat so the dock (rest timer) has its new height.
      window.setTimeout(() => scrollToNext(listRef.current, true), 80);
    }
  }, [next, session, logsLoaded]);
  useEffect(() => {
    if (!session) landed.current = false;
  }, [session]);

  const ensureSession = (): Promise<string> => {
    if (sessionId) return Promise.resolve(sessionId);
    starting.current ??= start().then(
      (s) => {
        setPendingId(s.id);
        return s.id;
      },
      (e) => {
        starting.current = null;
        throw e;
      },
    );
    return starting.current;
  };

  const painFor = (ex: PlannedExercise, logged: SetLog[]) => painLocal[ex.exercise_id] ?? logged.some((l) => l.pain_flag);

  const confirm = async (ex: PlannedExercise, exIndex: number, set: PlannedSet, values: SetValues, existing: SetLog | null) => {
    setNotice(null);
    try {
      if (existing) {
        await updateSet(existing.id, { weight: values.weight, reps: values.reps, rir: values.rir });
        return;
      }
      const id = await ensureSession();
      await logSet({
        sessionId: id,
        prescriptionId: ex.prescription_id,
        exerciseId: ex.exercise_id,
        setIndex: set.index,
        target: { weight: set.weight, reps: set.reps, rir: set.rir },
        weight: values.weight,
        reps: values.reps,
        rir: values.rir,
        isTopSet: set.kind === "top",
        ...(painFor(ex, logsFor(ex, sets)) ? { painFlag: true } : {}),
      });
      const after = new Set(keys);
      after.add(slotKey(ex.prescription_id, ex.exercise_id, set.index));
      const slot = slots.find((s) => s.exIndex === exIndex && s.setIndex === set.index);
      const upNext = nextSlot(slots, after, { pid: ex.prescription_id, setIndex: set.index });
      const seconds = slot && upNext ? restAfter(plan.exercises, slot, after) : null;
      if (seconds && upNext) startRest(id, seconds, slotLabel(plan.exercises, upNext));
      else if (!upNext) clearRest();
      scrollAfterConfirm.current = true;
    } catch (e) {
      console.warn("[today] could not save set", e);
      setNotice("That set did not save. Tap the check again.");
    }
  };

  const changePain = (ex: PlannedExercise, on: boolean) => {
    setPainLocal((p) => ({ ...p, [ex.exercise_id]: on }));
    if (sessionId) void setPain(sessionId, ex.exercise_id, on).catch((e) => console.warn("[today] pain", e));
  };

  const swap = (ex: PlannedExercise, exerciseId: string) => {
    // Back to the program exercise removes the swap, unless a block swap would take over again.
    const value = exerciseId === ex.primary_exercise_id && !blockSwaps[ex.prescription_id] ? null : exerciseId;
    if (sessionId) void swapExercise(sessionId, ex.prescription_id, value).catch((e) => console.warn("[today] swap", e));
    else onPreSwap(ex.prescription_id, value);
  };

  const setsLogged = sets.filter((s) => !s.deleted_at && !s.is_warmup).length;
  // "x of y" counts the plan on screen; sets of an exercise swapped out later still count for the session.
  const setsDone = plan.exercises.reduce((n, e) => n + logsFor(e, sets).filter((l) => e.sets.some((p) => p.index === l.set_index)).length, 0);
  const setsTotal = plan.exercises.reduce((n, e) => n + e.sets.length, 0);

  const finish = async () => {
    if (!sessionId || finishing) return;
    setFinishing(true);
    try {
      const result = await finishSession(sessionId);
      if (result.error) console.warn("[today] decisions not stored", result.error);
      clearRest();
      onFinished(sessionId);
    } catch (e) {
      console.warn("[today] finish", e);
      setNotice("Could not finish just now. Your sets are saved. Try again.");
      setFinishing(false);
    }
  };

  const discard = async () => {
    if (!sessionId) return;
    const id = sessionId;
    clearRest();
    setPendingId(null);
    starting.current = null;
    setPainLocal({});
    await discardSession(id);
  };

  return (
    <>
      {notice && <Pill>{notice}</Pill>}

      <div ref={listRef} className="flex flex-col gap-3">
        {plan.exercises.map((ex, i) => {
          const logged = logsFor(ex, sets);
          return (
            <div key={`${ex.prescription_id}:${ex.exercise_id}`} data-pid={ex.prescription_id}>
              <ExerciseCard
                exercise={ex}
                logged={logged}
                activeSetIndex={next && next.exIndex === i ? next.setIndex : null}
                pain={painFor(ex, logged)}
                onConfirmSet={(set, values, existing) => void confirm(ex, i, set, values, existing)}
                onPainChange={(on) => changePain(ex, on)}
                onSwap={(id) => swap(ex, id)}
                swapMode={swapping}
                equipment={exercises[ex.exercise_id]?.equipment}
                position={i + 1}
                today={today}
                circuit={plan.rounds != null}
              />
            </div>
          );
        })}
      </div>

      {liveSession && <DiscardControl setsLogged={setsLogged} onDiscard={discard} />}

      {!liveSession && !editing && next && plan.exercises[next.exIndex] && (
        <ShellDock>
          <QuickStartBar
            exercise={plan.exercises[next.exIndex]!}
            set={plan.exercises[next.exIndex]!.sets.find((s) => s.index === next.setIndex)!}
            busy={quickBusy}
            onPick={() => openNextEditor(next.pid)}
            onConfirm={async () => {
              const ex = plan.exercises[next.exIndex]!;
              const set = ex.sets.find((s) => s.index === next.setIndex)!;
              if (set.weight == null) return openNextEditor(next.pid);
              setQuickBusy(true);
              try {
                await confirm(ex, next.exIndex, set, { weight: set.weight, reps: set.reps, rir: set.rir }, null);
              } finally {
                setQuickBusy(false);
              }
            }}
          />
        </ShellDock>
      )}

      {liveSession && (
        <ShellDock>
          {rest && (
            <RestTimer
              key={rest.startedAt}
              startedAt={rest.startedAt}
              endsAt={rest.endsAt}
              label={rest.label}
              sound={sound}
              onAdd={addRest}
              onSkip={clearRest}
              onDone={clearRest}
            />
          )}
          <FinishBar startedAt={liveSession.started_at} setsDone={setsDone} setsTotal={setsTotal} onFinish={() => void finish()} disabled={finishing || setsLogged === 0} />
        </ShellDock>
      )}
    </>
  );
}
