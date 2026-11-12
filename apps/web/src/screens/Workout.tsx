/**
 * Workout: the overview of the next session (what you will do, with a how-to for every exercise), then the
 * player. The engine owns every number; this screen picks the version, renders and logs.
 */
import { localDate, type EngineContext, type EngineState, type PlanOptions, type PlannedExercise, type SessionPlan } from "@gym/engine";
import type { Session, SessionMode, Settings } from "@gym/schema";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AdjustmentBanner,
  AlternativesPanel,
  BackIcon,
  Button,
  CheckinCard,
  ChevronIcon,
  ExerciseDemo,
  Page,
  SegmentedControl,
  ShellDock,
  Skeleton,
  SpacingWarnings,
  SwapIcon,
  useGuide,
  type CheckinScores,
} from "../components";
import { saveCheckin, startSession, useCheckin, useEngine, usePlan, useSettings } from "../data";
import { cx } from "../lib/cx";
import { effortText, phaseLine } from "../lib/effort";
import { fmtKg, fmtLoad, fmtRangeAmount } from "../lib/format";
import { EngineError } from "./today/Calm";
import { readCheckinSkip, readPreChoice, writeCheckinSkip, writePreChoice, type PreChoice } from "./today/storage";
import { Player } from "./workout/Player";

export function WorkoutScreen() {
  const { ready, state, ctx, error } = useEngine();
  const settings = useSettings();
  if (!ready)
    return (
      <Page className="pt-[calc(env(safe-area-inset-top)+16px)]">
        <Skeleton height={220} />
        <Skeleton height={320} />
      </Page>
    );
  if (error || !state || !ctx) return <EngineError title="This workout could not be planned" detail={error?.message ?? null} />;
  return <WorkoutReady state={state} ctx={ctx} settings={settings ?? null} />;
}

/** "Session A", "Travel workout". */
export function workoutTitle(code: string, mode: SessionMode, name?: string | null): string {
  if (code === "TRAVEL" || mode === "travel") return "Travel workout";
  const base = name && name !== `Session ${code}` ? name : `Session ${code}`;
  return mode === "short" ? `${base} · short` : base;
}

type Choice = "full" | "short" | "travel";

/** Why the short version leads today, in plain words. */
function shortReason(ruleId: string | null): string {
  if (ruleId?.includes("evening")) return "It is late. The short one fits the evening and counts fully.";
  if (ruleId?.includes("floor")) return "The week is running out. Short and done beats skipped.";
  return "It has been a few days. Short and done keeps the week alive, and it counts fully.";
}

function WorkoutReady({ state, ctx, settings }: { state: EngineState; ctx: EngineContext; settings: Settings | null }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = state.next;
  const sound = settings?.sound ?? true;

  const active = state.active?.session ?? null;
  const activeStrength = active && active.program_day_id !== "CARDIO" ? active : null;
  const activeCardio = active && active.program_day_id === "CARDIO" ? active : null;
  // The engine state is a live query: it lags the first set and runs ahead of finish. Hold the session this
  // visit played, so the screen never drops to the overview or "Done for today" in between (the player shows
  // when a held session was closed elsewhere).
  const [held, setHeld] = useState<Session | null>(null);
  useEffect(() => {
    if (activeStrength) setHeld((h) => (h?.id === activeStrength.id && h.updated_at === activeStrength.updated_at ? h : activeStrength));
  }, [activeStrength]);
  const current = activeStrength ?? held;

  // ---- choices before the first set: version and swaps (local, survive a reload this visit) ----
  const blank = (): PreChoice => ({ date: state.today, code: next.code, mode: null, swaps: {} });
  const [choiceState, setChoiceState] = useState<PreChoice>(() => {
    const stored = readPreChoice(state.today, next.code) ?? blank();
    const asked = params.get("mode");
    return asked === "short" || asked === "full" || asked === "travel" ? { ...stored, mode: asked } : stored;
  });
  const choice = choiceState.date === state.today && choiceState.code === next.code ? choiceState : blank();
  const updateChoice = (patch: Partial<PreChoice>) => {
    const v = { ...choice, ...patch };
    setChoiceState(v);
    writePreChoice(v);
  };
  const shortAvailable = next.short_minutes != null;
  const recommendShort = next.recommended_mode === "short" && shortAvailable;
  const preMode: SessionMode = choice.mode ?? (recommendShort ? "short" : "full");

  // ---- the plan on screen ----
  const preSwapsEmpty = Object.keys(choice.swaps).length === 0;
  const reuseNextPlan = !current && preMode === "full" && preSwapsEmpty;
  // A running session is planned as at its start, like the engine's own active plan: targets stay frozen past midnight.
  const planOpts: PlanOptions | null = current
    ? { code: current.program_day_id, mode: current.mode, swaps: current.swaps, sessionId: current.id, at: current.started_at }
    : !reuseNextPlan
      ? { code: preMode === "travel" ? "TRAVEL" : next.code, mode: preMode, swaps: choice.swaps }
      : null;
  const planned = usePlan(planOpts);
  const plan = planOpts ? planned.plan : next.plan;

  // Start was tapped: show the player. A running session always shows it.
  const [started, setStarted] = useState(false);
  const inPlayer = !!current || started;

  const startFromPlan = () => {
    if (!plan) return Promise.reject(new Error("no plan"));
    writePreChoice(null);
    return startSession({ code: plan.code, mode: plan.mode, swaps: current ? current.swaps : choice.swaps, flags: plan.flags }).then((s) => {
      setHeld(s);
      return s;
    });
  };

  // ---- check-in ----
  const checkin = useCheckin(state.today);
  const [skippedFor, setSkippedFor] = useState<string | null>(() => (readCheckinSkip(state.today) ? state.today : null));
  const checkinValue: CheckinScores | null = checkin ? { sleep: checkin.sleep, soreness: checkin.soreness, stress: checkin.stress, energy: checkin.energy } : null;

  // ---- already trained today ----
  const todaySessionId = useMemo(() => {
    if (!next.done_today) return null;
    const tz = ctx.settings.timezone;
    const mine = ctx.history.sessions
      .filter((s) => !s.deleted_at && s.ended_at && s.program_day_id !== "CARDIO" && localDate(s.started_at, tz) === state.today)
      .sort((a, b) => b.started_at.localeCompare(a.started_at));
    return mine[0]?.id ?? null;
  }, [next.done_today, state.today, ctx]);

  const onPreSwap = (pid: string, exerciseId: string | null) => {
    const swaps = { ...choice.swaps };
    if (exerciseId) swaps[pid] = exerciseId;
    else delete swaps[pid];
    updateChoice({ swaps });
  };

  // Cardio is running: one open session at a time, or the newer one hides the other.
  if (activeCardio && !current) {
    return (
      <div className="flex min-h-dvh flex-col pt-[env(safe-area-inset-top)]">
        <TopBar title="Workout" onBack={() => navigate("/")} />
        <Page className="flex-1 justify-center pb-24 text-center">
          <h1 className="m-0 font-display text-[40px] uppercase text-fg">Cardio is running</h1>
          <p className="m-0 text-[15px] leading-snug text-fg-dim">Save or discard it first. Then the workout is one tap away.</p>
          <Button variant="primary" size="md" block onClick={() => navigate("/cardio")}>
            Back to cardio
          </Button>
        </Page>
      </div>
    );
  }

  if (!current && next.done_today && !started) {
    return (
      <div className="flex min-h-dvh flex-col pt-[env(safe-area-inset-top)]">
        <TopBar title="Workout" onBack={() => navigate("/")} />
        <Page className="flex-1 justify-center pb-24 text-center">
          <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-volt text-night">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </div>
          <h1 className="m-0 font-display text-[40px] uppercase text-fg">Done for today</h1>
          <p className="m-0 text-[15px] leading-snug text-fg-dim">
            Next up is {workoutTitle(next.code, "full", next.plan.name)}, tomorrow or whenever it fits. One workout a day is the rule.
          </p>
          {todaySessionId && (
            <Button variant="secondary" size="md" block onClick={() => navigate(`/summary/${todaySessionId}`)}>
              See today's summary
            </Button>
          )}
          <Button variant="ghost" size="md" block onClick={() => navigate("/")}>
            Back to Today
          </Button>
        </Page>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="flex min-h-dvh flex-col pt-[env(safe-area-inset-top)]">
        <TopBar title="Workout" onBack={() => navigate("/")} />
        <Page>{planned.error ? <p className="text-[15px] text-fg-dim">This version could not be planned. Your log is safe.</p> : <Skeleton height={320} />}</Page>
      </div>
    );
  }

  if (inPlayer) {
    return (
      <Player
        plan={plan}
        session={current}
        start={startFromPlan}
        exercises={ctx.exercises}
        today={state.today}
        onPreSwap={onPreSwap}
        blockSwaps={ctx.settings.block_swaps}
        sound={sound}
        title={workoutTitle(plan.code, plan.mode, plan.name)}
        onFinished={(id) => navigate(`/summary/${id}`, { replace: true })}
        onExit={() => (current ? navigate("/") : setStarted(false))}
      />
    );
  }

  const modeOptions: { value: Choice; label: string }[] = [
    { value: "full", label: `Full ${next.est_minutes} min` },
    ...(shortAvailable ? [{ value: "short" as const, label: `Short ${next.short_minutes} min` }] : []),
    { value: "travel", label: "Travel" },
  ];
  const modeValue: Choice = preMode === "short" ? "short" : preMode === "travel" ? "travel" : "full";

  return (
    <div className="flex min-h-dvh flex-col pt-[env(safe-area-inset-top)]">
      <TopBar title="Workout" onBack={() => navigate("/")} />
      <Page className="gap-4 pt-0">
        <header className="px-1">
          <div className="gym-label">
            {plan.code === "TRAVEL" ? "Hotel gym or dumbbells" : `Session ${plan.code}`} · Week {state.block.training_week} of {state.block.block_weeks}
          </div>
          <h1 className="m-0 mt-2 font-display text-[46px] uppercase leading-[0.92] text-fg">{plan.code === "TRAVEL" ? "Travel workout" : plan.name}</h1>
          <p className="m-0 mt-2 text-[15px] leading-snug text-fg-dim">
            {plan.exercises.length} exercises · about {plan.est_minutes} min · {effortText(plan.exercises[0]?.target_rir ?? 2)}
          </p>
          {phaseLine(plan.phase) && <p className="m-0 mt-1 text-[13.5px] leading-snug text-fg-faint">{phaseLine(plan.phase)}</p>}
        </header>

        <SegmentedControl label="Version" options={modeOptions} value={modeValue} onChange={(mode) => updateChoice({ mode })} />
        {recommendShort && choice.mode == null && (
          <p className="m-0 -mt-1 px-1 text-[13.5px] leading-snug text-fg-dim">
            <span className="font-semibold text-fg">Short version picked for today.</span> {shortReason(next.recommended_rule_id)}
          </p>
        )}

        <AdjustmentBanner adjustments={plan.adjustments} />
        <SpacingWarnings warnings={plan.warnings} />

        <ExerciseList plan={plan} onSwap={onPreSwap} blockSwaps={ctx.settings.block_swaps} />

        {checkin !== undefined && (
          <CheckinCard
            key={state.today}
            startOpen={false}
            value={checkinValue}
            skipped={skippedFor === state.today}
            onSave={(scores) => void saveCheckin({ date: state.today, ...scores }).catch((e) => console.warn("[workout] check-in", e))}
            onSkip={() => {
              setSkippedFor(state.today);
              writeCheckinSkip(state.today);
            }}
          />
        )}
      </Page>

      <ShellDock>
        <Button variant="primary" size="lg" block className="shadow-[0_12px_32px_rgba(0,0,0,0.6)]" onClick={() => setStarted(true)}>
          Start workout
        </Button>
      </ShellDock>
    </div>
  );
}

export function TopBar({ title, onBack, right }: { title: string; onBack: () => void; right?: ReactNode }) {
  return (
    <div className="sticky z-20 flex h-14 items-center gap-1 bg-night/90 px-2 backdrop-blur-xl" style={{ top: "env(safe-area-inset-top)" }}>
      <button type="button" onClick={onBack} aria-label="Back" className="gym-press grid h-11 w-11 shrink-0 place-items-center rounded-full text-fg active:bg-raise">
        <BackIcon size={24} />
      </button>
      <div className="min-w-0 flex-1 truncate text-center text-[13px] font-semibold uppercase tracking-[0.08em] text-fg-dim">{title}</div>
      <div className="flex min-w-11 shrink-0 justify-end">{right}</div>
    </div>
  );
}

/** "3 × 5–8 · 60 kg", "2 × 30–45 s", "3 × 8–12 · pick a weight". */
export function prescriptionLine(ex: PlannedExercise): string {
  const range = fmtRangeAmount(ex.rep_min, ex.rep_max, ex);
  const first = ex.sets[0];
  const weight = first?.weight;
  const load =
    weight == null
      ? ex.bodyweight
        ? null
        : "pick a weight"
      : ex.bodyweight
        ? weight > 0
          ? fmtLoad(weight, { bodyweight: true })
          : null
        : `${fmtKg(weight)} kg${ex.per_hand ? " each" : ""}`;
  return `${ex.sets.length} × ${range}${load ? ` · ${load}` : ""}`;
}

function ExerciseList({ plan, onSwap, blockSwaps }: { plan: SessionPlan; onSwap: (pid: string, exerciseId: string | null) => void; blockSwaps: Record<string, string> }) {
  const openGuide = useGuide();
  const [swapFor, setSwapFor] = useState<string | null>(null);
  useEffect(() => setSwapFor(null), [plan.code, plan.mode]);

  return (
    <section aria-label="Exercises" className="overflow-hidden rounded-[20px] bg-card">
      <ul className="m-0 list-none divide-y divide-line/60 p-0">
        {plan.exercises.map((ex, i) => (
          <li key={`${ex.prescription_id}:${ex.exercise_id}`}>
            <div className="flex items-stretch">
              <button type="button" onClick={() => openGuide(ex.exercise_id)} aria-label={`How to do ${ex.name}`} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-3 pr-1 text-left active:bg-raise">
                <ExerciseDemo exerciseId={ex.exercise_id} name={ex.name} still className="h-[60px] w-[76px] shrink-0 rounded-[12px]" />
                <span className="min-w-0 flex-1">
                  <span className="gym-label block">
                    {i + 1}
                    {ex.superset_group && plan.rounds == null ? " · superset" : ""}
                    {ex.swapped ? " · swapped" : ""}
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-[16px] font-semibold leading-tight text-fg">{ex.name}</span>
                  <span className="mt-0.5 block text-[13.5px] tabular-nums leading-snug text-fg-dim">{prescriptionLine(ex)}</span>
                </span>
              </button>
              <button
                type="button"
                aria-label={`Swap ${ex.name}`}
                aria-expanded={swapFor === ex.prescription_id}
                onClick={() => setSwapFor((p) => (p === ex.prescription_id ? null : ex.prescription_id))}
                className={cx("grid w-12 shrink-0 place-items-center active:bg-raise", swapFor === ex.prescription_id ? "text-fg" : "text-fg-faint")}
              >
                <SwapIcon size={20} />
              </button>
            </div>
            {swapFor === ex.prescription_id && (
              <AlternativesPanel
                exercise={ex}
                onClose={() => setSwapFor(null)}
                onSelect={(id) => {
                  onSwap(ex.prescription_id, id === ex.primary_exercise_id && !blockSwaps[ex.prescription_id] ? null : id);
                  setSwapFor(null);
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
