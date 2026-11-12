/**
 * The workout player: one exercise at a time. The big button in the dock logs the next set exactly as
 * prescribed; tapping a set's numbers adjusts it. The first logged set creates the session.
 */
import type { PlannedExercise, PlannedSet, SessionPlan } from "@gym/engine";
import type { Exercise, Session, SetLog } from "@gym/schema";
import { useEffect, useMemo, useRef, useState } from "react";
import { BackIcon, Button, CheckIcon, ChevronIcon, Pill, RestTimer, ShellDock, Sheet, type SetValues } from "../../components";
import { deleteSet, discardSession, finishSession, logSet, setPain, swapExercise, updateSet, useSessionLogs } from "../../data";
import { cx } from "../../lib/cx";
import { fmtClock, fmtKg, fmtLoad, sideSuffix } from "../../lib/format";
import { toMs, useNow } from "../../lib/timers";
import { markSessionOpen } from "../../lib/updatePolicy";
import { addRest, clearRest, endRest, renameRest, startRest, useRest } from "../today/rest";
import { readPain, writePain } from "../today/storage";
import { lastLogged, loggedKeys, logsFor, nextSlot, orderSlots, restAfter, slotKey, slotLabel } from "../today/slots";
import { ExercisePage, pickedBefore } from "./ExercisePage";

export interface PlayerProps {
  plan: SessionPlan;
  /** The session in progress (state.active), or null before the first set. */
  session: Session | null;
  /** Creates the session on the first confirmed set (code, mode, swaps and plan flags). */
  start: () => Promise<Session>;
  exercises: Record<string, Exercise>;
  today: string;
  /** Swap before the session exists (kept in the screen's local state). */
  onPreSwap: (prescriptionId: string, exerciseId: string | null) => void;
  blockSwaps: Record<string, string>;
  sound: boolean;
  title: string;
  onFinished: (sessionId: string) => void;
  /** Leave the player (the session keeps running). */
  onExit: () => void;
}

/** Open the steppers on the highlighted row. */
function openNextEditor() {
  const row = document.querySelector<HTMLElement>('[data-player] [data-state="next"]');
  row?.querySelector<HTMLButtonElement>("button")?.click();
}

function Elapsed({ startedAt }: { startedAt: string }) {
  const now = useNow(true, 1000);
  return <span className="tabular-nums">{fmtClock(Math.max(0, (now - toMs(startedAt)) / 1000))}</span>;
}

/** "60 kg × 8", "Bodyweight × 10", "30 s". */
function setText(ex: PlannedExercise, weight: number, reps: number): string {
  const amount = ex.measure === "seconds" ? `${reps} s` : ex.measure === "meters" ? `${reps} m` : `${reps}${sideSuffix(ex)}`;
  if (ex.bodyweight && ex.measure !== "reps" && weight === 0) return amount;
  const load = ex.bodyweight ? fmtLoad(weight, { bodyweight: true }) : `${fmtKg(weight)} kg`;
  return `${load} × ${amount}`;
}

export function Player({ plan, session, start, exercises, today, onPreSwap, blockSwaps, sound, title, onFinished, onExit }: PlayerProps) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const starting = useRef<Promise<string> | null>(null);
  const sessionId = session?.id ?? pendingId;
  const logs = useSessionLogs(sessionId);
  // A resumed session's sets load a moment after the screen: until then nothing may be logged over them.
  const loaded = !sessionId || logs?.session_id === sessionId;
  const sets: SetLog[] = useMemo(() => (sessionId && logs?.session_id === sessionId && logs.session ? logs.sets : []), [sessionId, logs]);

  const [painLocal, setPainLocal] = useState<Record<string, boolean>>(() => readPain(sessionId));
  const [notice, setNotice] = useState<string | null>(null);
  // Finishing or discarding from here: the session ends on purpose, so the screen stays as it is until it leaves.
  const [finishing, setFinishing] = useState(false);
  // Finished or discarded somewhere else (another device, or after a long break): stop logging into it.
  const closed = !!sessionId && loaded && !finishing && (logs?.session == null || logs.session.ended_at != null);
  const liveSession = closed ? null : (logs?.session_id === sessionId ? logs.session : null) ?? session;
  const [busy, setBusy] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [discardAsk, setDiscardAsk] = useState(false);
  const rest = useRest(sessionId);

  // While a set's steppers are open, the dock button would only compete with Done.
  const pageRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    const el = pageRef.current;
    if (!el || typeof MutationObserver === "undefined") return;
    const check = () => setEditing(!!el.querySelector('[data-state="editing"]'));
    const mo = new MutationObserver(check);
    mo.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-state"] });
    check();
    return () => mo.disconnect();
  }, []);

  const slots = useMemo(() => orderSlots(plan.exercises), [plan.exercises]);
  const keys = useMemo(() => loggedKeys(sets), [sets]);
  const next = useMemo(() => nextSlot(slots, keys, lastLogged(plan.exercises, sets)), [slots, keys, plan.exercises, sets]);

  // The exercise on screen follows the next open set, unless Peter stepped somewhere else himself.
  const [manual, setManual] = useState<number | null>(null);
  const last = plan.exercises.length - 1;
  const index = Math.max(0, Math.min(last, manual ?? next?.exIndex ?? last));
  const ex = plan.exercises[index];
  useEffect(() => {
    window.scrollTo?.(0, 0);
  }, [index]);

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

  // Pain set before an exercise's first set lives here only, so it is kept on the device for this session.
  useEffect(() => {
    if (sessionId) writePain(sessionId, painLocal);
  }, [sessionId, painLocal]);

  const painFor = (e: PlannedExercise, logged: SetLog[]) => painLocal[e.exercise_id] ?? logged.some((l) => l.pain_flag);

  const confirm = async (e: PlannedExercise, exIndex: number, set: PlannedSet, values: SetValues, existing: SetLog | null) => {
    if (!loaded || closed) return;
    setNotice(null);
    try {
      if (existing) {
        await updateSet(existing.id, { weight: values.weight, reps: values.reps, rir: values.rir });
        return;
      }
      const id = await ensureSession();
      await logSet({
        sessionId: id,
        prescriptionId: e.prescription_id,
        exerciseId: e.exercise_id,
        setIndex: set.index,
        target: { weight: set.weight, reps: set.reps, rir: set.rir },
        weight: values.weight,
        reps: values.reps,
        rir: values.rir,
        isTopSet: set.kind === "top",
        ...(painFor(e, logsFor(e, sets)) ? { painFlag: true } : {}),
      });
      const after = new Set(keys);
      after.add(slotKey(e.prescription_id, e.exercise_id, set.index));
      const slot = slots.find((s) => s.exIndex === exIndex && s.setIndex === set.index);
      const upNext = nextSlot(slots, after, { pid: e.prescription_id, setIndex: set.index });
      const seconds = slot && upNext ? restAfter(plan.exercises, slot, after) : null;
      if (seconds && upNext) startRest(id, seconds, slotLabel(plan.exercises, upNext));
      else if (!upNext) clearRest();
      setManual(null);
    } catch (err) {
      console.warn("[workout] could not save set", err);
      setNotice("That set did not save. Tap again.");
    }
  };

  const remove = async (existing: SetLog) => {
    setNotice(null);
    try {
      await deleteSet(existing.id);
    } catch (err) {
      console.warn("[workout] could not remove set", err);
      setNotice("That set could not be removed. Try again.");
    }
  };

  const changePain = (e: PlannedExercise, on: boolean) => {
    setPainLocal((p) => ({ ...p, [e.exercise_id]: on }));
    if (sessionId) void setPain(sessionId, e.exercise_id, on).catch((err) => console.warn("[workout] pain", err));
  };

  const swap = (e: PlannedExercise, exerciseId: string) => {
    // Back to the program exercise removes the swap, unless a block swap would take over again.
    const value = exerciseId === e.primary_exercise_id && !blockSwaps[e.prescription_id] ? null : exerciseId;
    const swappedTo = exercises[exerciseId]?.name;
    if (swappedTo) renameRest(e.name, swappedTo);
    if (sessionId) void swapExercise(sessionId, e.prescription_id, value).catch((err) => console.warn("[workout] swap", err));
    else onPreSwap(e.prescription_id, value);
  };

  const setsLogged = sets.filter((s) => !s.deleted_at && !s.is_warmup).length;
  const doneIn = (e: PlannedExercise) => logsFor(e, sets).filter((l) => e.sets.some((p) => p.index === l.set_index)).length;
  const setsDone = plan.exercises.reduce((n, e) => n + doneIn(e), 0);
  const setsTotal = plan.exercises.reduce((n, e) => n + e.sets.length, 0);

  const finish = async () => {
    if (!sessionId || finishing) return;
    setFinishing(true);
    try {
      const result = await finishSession(sessionId);
      if (result.error) console.warn("[workout] decisions not stored", result.error);
      clearRest();
      writePain(null, null);
      markSessionOpen(null);
      onFinished(sessionId);
    } catch (err) {
      console.warn("[workout] finish", err);
      setNotice("Could not finish just now. Your sets are saved. Try again.");
      setFinishing(false);
      setFinishOpen(false);
    }
  };

  const discard = async () => {
    if (!sessionId) return onExit();
    if (finishing) return;
    const id = sessionId;
    setFinishing(true);
    try {
      await discardSession(id);
    } catch (err) {
      console.warn("[workout] discard", err);
      setNotice("Could not discard just now. Your sets are saved. Try again.");
      setFinishing(false);
      setFinishOpen(false);
      return;
    }
    clearRest();
    writePain(null, null);
    markSessionOpen(null);
    onExit();
  };

  if (!ex) return null;

  const exLogs = logsFor(ex, sets).filter((l) => !l.deleted_at && !l.is_warmup);
  const loggedIdx = new Set(exLogs.map((l) => l.set_index));
  // The set to do now on this exercise: the engine's next slot when it is here, else the first open one.
  const activeSet = (next && next.exIndex === index ? ex.sets.find((s) => s.index === next.setIndex) : undefined) ?? ex.sets.find((s) => !loggedIdx.has(s.index)) ?? null;
  const activeWeight = activeSet ? (activeSet.weight ?? pickedBefore(exLogs.sort((a, b) => a.set_index - b.set_index), activeSet.index)) : null;
  const allDone = setsDone >= setsTotal && setsTotal > 0;

  const logActive = async () => {
    if (!activeSet || busy) return;
    if (activeWeight == null) return openNextEditor();
    setBusy(true);
    try {
      await confirm(ex, index, activeSet, { weight: activeWeight, reps: activeSet.reps, rir: activeSet.rir }, null);
    } finally {
      setBusy(false);
    }
  };

  const setWord = activeSet ? (activeSet.kind === "top" ? "Top set" : `Set ${activeSet.index + 1}`) : "";

  return (
    <div data-player className="flex min-h-dvh flex-col pt-[env(safe-area-inset-top)]">
      {/* top bar */}
      <div className="sticky top-0 z-20 bg-night/90 backdrop-blur-xl" style={{ top: "env(safe-area-inset-top)" }}>
        <div className="flex h-14 items-center gap-1 px-2">
          <button type="button" onClick={onExit} aria-label="Back to Today" className="gym-press grid h-11 w-11 shrink-0 place-items-center rounded-full text-fg active:bg-raise">
            <BackIcon size={24} />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <div className="truncate font-display text-[19px] uppercase text-fg">{title}</div>
            <div className="text-[11.5px] font-medium text-fg-faint">
              {liveSession ? <Elapsed startedAt={liveSession.started_at} /> : "Not started"} · {setsDone} of {setsTotal} sets
            </div>
          </div>
          <button
            type="button"
            onClick={() => (liveSession ? setFinishOpen(true) : onExit())}
            className="gym-press min-h-11 shrink-0 rounded-full px-3 text-[14px] font-semibold text-volt active:bg-raise"
          >
            {liveSession ? "Finish" : "Close"}
          </button>
        </div>
        {/* one segment per exercise */}
        <div className="flex gap-1 px-4 pb-2" role="tablist" aria-label="Exercises">
          {plan.exercises.map((e, i) => {
            const done = doneIn(e);
            const frac = e.sets.length ? done / e.sets.length : 0;
            return (
              <button
                key={`${e.prescription_id}:${e.exercise_id}`}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`${e.name}, ${done} of ${e.sets.length} sets`}
                onClick={() => setManual(i)}
                className="flex h-7 flex-1 items-center"
              >
                <span className={cx("block h-[5px] w-full overflow-hidden rounded-full", i === index ? "bg-fg/35" : "bg-raise-2")}>
                  <span className="block h-full rounded-full bg-volt transition-[width] duration-300" style={{ width: `${frac * 100}%` }} />
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div ref={pageRef} className="flex-1 px-4 pb-4 pt-1">
        {closed && <Pill className="mb-3">This workout was closed on another device or after a long break. The sets you logged are saved.</Pill>}
        {notice && <Pill className="mb-3">{notice}</Pill>}
        {plan.rounds != null && index === 0 && setsLogged === 0 && <Pill className="mb-3">Circuit: one set of each exercise in a row, then rest.</Pill>}
        <ExercisePage
          key={`${ex.prescription_id}:${ex.exercise_id}`}
          exercise={ex}
          logged={logsFor(ex, sets)}
          activeSetIndex={activeSet?.index ?? null}
          pain={painFor(ex, logsFor(ex, sets))}
          equipment={exercises[ex.exercise_id]?.equipment}
          today={today}
          position={index + 1}
          total={plan.exercises.length}
          circuit={plan.rounds != null}
          onConfirmSet={(set, values, existing) => void confirm(ex, index, set, values, existing)}
          onRemoveSet={(existing) => void remove(existing)}
          onPainChange={(on) => changePain(ex, on)}
          onSwap={(id) => swap(ex, id)}
        />
      </div>

      <ShellDock>
        {rest && (
          <RestTimer key={rest.startedAt} startedAt={rest.startedAt} endsAt={rest.endsAt} label={rest.label} sound={sound} alert={false} onAdd={addRest} onSkip={clearRest} onDone={() => endRest(sound)} />
        )}
        {!editing && (
          <div className="flex items-center gap-2 rounded-[24px] bg-card p-2 shadow-[0_12px_32px_rgba(0,0,0,0.6)]">
            <button
              type="button"
              aria-label="Previous exercise"
              disabled={index === 0}
              onClick={() => setManual(index - 1)}
              className="gym-press grid h-[58px] w-12 shrink-0 place-items-center rounded-[18px] bg-raise text-fg disabled:opacity-30"
            >
              <BackIcon size={22} />
            </button>
            {closed ? (
              <Button variant="primary" size="lg" className="min-w-0 flex-1" onClick={onExit}>
                Back to Today
              </Button>
            ) : activeSet ? (
              <Button variant="primary" size="lg" className="min-w-0 flex-1 flex-col !gap-0 px-3" disabled={busy || !loaded} onClick={() => void logActive()} aria-label={activeWeight == null ? `Pick weight for ${ex.name} ${setWord.toLowerCase()}` : `Log ${ex.name} ${setWord.toLowerCase()}`}>
                <span className="flex items-center gap-2 leading-none">
                  {activeWeight != null && <CheckIcon size={22} strokeWidth={2.5} />}
                  {activeWeight == null ? "Pick weight" : `Log ${setWord.toLowerCase()}`}
                </span>
                {activeWeight != null && <span className="mt-1 font-sans text-[12.5px] font-semibold normal-case leading-none tracking-normal opacity-70">{setText(ex, activeWeight, activeSet.reps)}</span>}
              </Button>
            ) : allDone ? (
              <Button variant="primary" size="lg" className="min-w-0 flex-1" disabled={finishing} onClick={() => void finish()}>
                Finish workout
              </Button>
            ) : (
              <Button variant="primary" size="lg" className="min-w-0 flex-1" onClick={() => setManual(next && next.exIndex !== index ? next.exIndex : Math.min(last, index + 1))}>
                Next exercise
              </Button>
            )}
            <button
              type="button"
              aria-label="Skip to the next exercise"
              disabled={index === last}
              onClick={() => setManual(index + 1)}
              className="gym-press grid h-[58px] w-12 shrink-0 place-items-center rounded-[18px] bg-raise text-fg disabled:opacity-30"
            >
              <ChevronIcon size={22} />
            </button>
          </div>
        )}
      </ShellDock>

      <Sheet
        open={finishOpen}
        onClose={() => {
          setFinishOpen(false);
          setDiscardAsk(false);
        }}
        title={allDone ? "Finish workout" : "Finish early?"}
      >
        <div className="flex flex-col gap-3 pt-2">
          <p className="m-0 text-[15px] leading-snug text-fg-dim">
            {setsDone} of {setsTotal} sets logged.{!allDone && " Open sets are left out. Next time builds on what you logged."}
          </p>
          <Button variant="primary" size="lg" block disabled={finishing || setsLogged === 0} onClick={() => void finish()}>
            Finish
          </Button>
          <Button variant="secondary" size="md" block onClick={() => setFinishOpen(false)}>
            Keep going
          </Button>
          {discardAsk ? (
            <div className="rounded-2xl bg-raise px-4 py-3">
              <p className="m-0 text-[14px] leading-snug text-fg">
                Discard this workout?{" "}
                <span className="text-fg-dim">
                  {!loaded ? "Loading your sets." : setsLogged === 0 ? "Nothing is logged yet." : `The ${setsLogged} logged ${setsLogged === 1 ? "set goes" : "sets go"} with it.`}
                </span>
              </p>
              <div className="mt-3 flex gap-2">
                <Button variant="secondary" size="md" className="flex-1 !bg-raise-2" disabled={!loaded || finishing} onClick={() => void discard()}>
                  Discard
                </Button>
                <Button variant="ghost" size="md" className="flex-1" onClick={() => setDiscardAsk(false)}>
                  Keep it
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" size="sm" className="self-center" onClick={() => setDiscardAsk(true)}>
              Discard workout
            </Button>
          )}
        </div>
      </Sheet>
    </div>
  );
}
