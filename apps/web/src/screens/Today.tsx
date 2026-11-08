/**
 * Today (SPEC 4.1). Renders from Dexie immediately; the next session's sets are loggable at open and
 * the first confirmed set starts the session. Order: week · nudges · next · check-in · adjustments ·
 * version buttons · exercises. The engine owns every number; this screen only renders and logs.
 */
import { localDate, type EngineContext, type EngineState, type Nudge, type PlanOptions } from "@gym/engine";
import type { Session, SessionMode, Settings } from "@gym/schema";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AdjustmentBanner,
  Button,
  CheckinCard,
  ModeBar,
  NextSessionCard,
  NudgeCard,
  Page,
  ShellTitle,
  Skeleton,
  SpacingWarnings,
  WeekCard,
  type CheckinScores,
} from "../components";
import { saveCheckin, startCardioSession, startSession, useCheckin, useEngine, usePlan, useSettings } from "../data";
import { markSessionOpen } from "../lib/updatePolicy";
import { CardioPanel } from "./today/CardioPanel";
import { EngineError, TodaySkeleton } from "./today/Calm";
import { CheckinPrompt, PlanHeading, RecommendNote, SessionHeader, WeekStrip, sessionTitle } from "./today/parts";
import { StrengthSession } from "./today/StrengthSession";
import { readCheckinSkip, readPreChoice, writeCheckinSkip, writePreChoice, type PreChoice } from "./today/storage";

export function TodayScreen() {
  const { ready, state, ctx, error } = useEngine();
  const settings = useSettings();
  if (!ready) return <TodaySkeleton />;
  if (error || !state || !ctx) return <EngineError detail={error?.message ?? null} />;
  return <TodayReady state={state} ctx={ctx} settings={settings ?? null} />;
}

/**
 * Break nudges only say that loads are eased (the plan and its banner already carry it). Their engine action
 * is the full session, which would override a ★ 30 min recommendation at exactly the comeback moment.
 */
const INFO_ONLY: ReadonlySet<Nudge["kind"]> = new Set(["break_resume", "long_break"]);

/** Nudges without a session action link to where they are acted on. */
const NUDGE_LINKS: Partial<Record<Nudge["kind"], { label: string; to: string }>> = {
  book_floor: { label: "Book them", to: "/plan" },
  sunday_review: { label: "Open the review", to: "/progress" },
  block_complete: { label: "See the block", to: "/plan" },
};

function scrollToId(id: string, block: ScrollLogicalPosition = "start") {
  window.setTimeout(() => {
    const el = document.getElementById(id);
    if (!el || typeof el.scrollIntoView !== "function") return;
    el.style.scrollMarginTop = "56px";
    el.style.scrollMarginBottom = "calc(var(--shell-bottom, 160px) + 8px)";
    el.scrollIntoView({ block, behavior: "smooth" });
  }, 40);
}

function scrollToExercises() {
  scrollToId("today-exercises");
}

function TodayReady({ state, ctx, settings }: { state: EngineState; ctx: EngineContext; settings: Settings | null }) {
  const navigate = useNavigate();
  // Arriving from another screen (e.g. the summary): start at the top. A running session then lands on its next set.
  useEffect(() => {
    // Block body: in newer browsers scrollTo returns a promise, which an effect must not return.
    window.scrollTo?.(0, 0);
  }, []);
  const next = state.next;
  const goals = ctx.config.week;
  const sound = settings?.sound ?? true;

  const active = state.active?.session ?? null;
  const activeStrength = active && active.program_day_id !== "CARDIO" ? active : null;
  const activeCardio = active && active.program_day_id === "CARDIO" ? active : null;
  // Tells the service worker update code that a session is open: no reload onto a new version mid-workout.
  const activeId = active?.id ?? null;
  useEffect(() => markSessionOpen(activeId), [activeId]);

  // ---- choices before the first set: version and swaps (local, survive a reload this visit) ----
  const blank = (): PreChoice => ({ date: state.today, code: next.code, mode: null, swaps: {} });
  const [choiceState, setChoiceState] = useState<PreChoice>(() => readPreChoice(state.today, next.code) ?? blank());
  const choice = choiceState.date === state.today && choiceState.code === next.code ? choiceState : blank();
  const updateChoice = (patch: Partial<PreChoice>) => {
    const v = { ...choice, ...patch };
    setChoiceState(v);
    writePreChoice(v);
  };
  const shortAvailable = next.short_minutes != null;
  const recommendShort = next.recommended_mode === "short" && shortAvailable;
  const preMode: SessionMode = choice.mode ?? (recommendShort ? "short" : "full");
  const [swapping, setSwapping] = useState(false);

  // ---- cardio ----
  // The cardio session started from this screen, until the engine reports it as active.
  const [cardioSession, setCardioSession] = useState<Session | null>(null);
  const [cardioStarting, setCardioStarting] = useState(false);
  const cardioOpen = cardioSession != null;
  const showCardio = !!activeCardio || cardioOpen;
  const closeCardio = () => setCardioSession(null);
  const openCardio = async () => {
    if (cardioStarting) return;
    setCardioStarting(true);
    try {
      // Starting now gives the summary a real duration, and a reload finds the session again.
      setCardioSession(await startCardioSession());
      window.setTimeout(() => document.getElementById("today-cardio")?.scrollIntoView?.({ block: "start", behavior: "smooth" }), 60);
    } catch (e) {
      console.warn("[today] cardio start", e);
    } finally {
      setCardioStarting(false);
    }
  };

  // ---- the plan on screen ----
  const showStrength = !!activeStrength || (!next.done_today && !showCardio);
  const preSwapsEmpty = Object.keys(choice.swaps).length === 0;
  // next.plan is the full version already planned by computeState: reuse it when nothing differs.
  const reuseNextPlan = !activeStrength && preMode === "full" && preSwapsEmpty;
  const planOpts: PlanOptions | null = activeStrength
    ? { code: activeStrength.program_day_id, mode: activeStrength.mode, swaps: activeStrength.swaps, sessionId: activeStrength.id }
    : showStrength && !reuseNextPlan
      ? { code: preMode === "travel" ? "TRAVEL" : next.code, mode: preMode, swaps: choice.swaps }
      : null;
  const planned = usePlan(planOpts);
  const plan = planOpts ? planned.plan : showStrength ? next.plan : null;

  const startFromPlan = () => {
    if (!plan) return Promise.reject(new Error("no plan"));
    writePreChoice(null);
    return startSession({ code: plan.code, mode: plan.mode, swaps: activeStrength ? activeStrength.swaps : choice.swaps, flags: plan.flags });
  };

  // ---- check-in ----
  const checkin = useCheckin(state.today);
  const [skippedFor, setSkippedFor] = useState<string | null>(() => (readCheckinSkip(state.today) ? state.today : null));
  // Not checked in yet: the dock says so before the first set, since the card sits below the fold and a
  // check-in saved before the session starts is the one that adjusts it (readiness flags at start).
  const checkinPending = checkin === null && skippedFor !== state.today;
  const checkinValue: CheckinScores | null = checkin ? { sleep: checkin.sleep, soreness: checkin.soreness, stress: checkin.stress, energy: checkin.energy } : null;

  // ---- done for today: link to today's summary ----
  const todaySessionId = useMemo(() => {
    if (!next.done_today) return null;
    const tz = ctx.settings.timezone;
    const mine = ctx.history.sessions
      .filter((s) => !s.deleted_at && s.ended_at && s.program_day_id !== "CARDIO" && localDate(s.started_at, tz) === state.today)
      .sort((a, b) => b.started_at.localeCompare(a.started_at));
    return mine[0]?.id ?? null;
  }, [next.done_today, state.today, ctx]);

  const onNudge = (n: Nudge) => {
    const link = NUDGE_LINKS[n.kind];
    if (link) return navigate(link.to);
    if (!n.action || INFO_ONLY.has(n.kind)) return;
    const mode: SessionMode = n.action.code === "TRAVEL" ? "travel" : n.action.mode;
    updateChoice({ mode });
    scrollToExercises();
  };

  const cardioTargetMet = state.cardio.counts_as === "bonus";
  // The card shows the code big; the day's name ("Squat + bench") reads better under it than "Session A" again.
  const nextShown = next.name === `Session ${next.code}` && next.plan.name ? { ...next, name: next.plan.name } : next;
  const inSession = !!activeStrength;
  const nudges = inSession || showCardio ? [] : state.nudges;

  return (
    <>
      {activeStrength && (
        <ShellTitle>
          <span className="text-paper">{sessionTitle(activeStrength.program_day_id, activeStrength.mode)}</span>
        </ShellTitle>
      )}
      {activeCardio && (
        <ShellTitle>
          <span className="text-paper">Cardio</span>
        </ShellTitle>
      )}

      <Page className="gap-3">
        {/* 1 · week */}
        {inSession ? <WeekStrip week={state.current_week} blockWeeks={state.block.block_weeks} goals={goals} /> : <WeekCard week={state.current_week} block={state.block} goals={goals} />}

        {/* 2 · nudges */}
        {nudges.map((n) => {
          const link = NUDGE_LINKS[n.kind];
          const sessionAction = !!n.action && !next.done_today && !INFO_ONLY.has(n.kind);
          return <NudgeCard key={`${n.rule_id}:${n.kind}`} nudge={n} actionLabel={link?.label} onAction={link || sessionAction ? onNudge : undefined} />;
        })}

        {/* 3 · next session, or the running session's header */}
        {activeStrength && plan ? (
          <SessionHeader session={activeStrength} plan={plan} swapping={swapping} onSwappingChange={setSwapping} />
        ) : !activeStrength && !showCardio ? (
          <NextSessionCard next={nextShown} cardio={state.cardio} cardioDone={cardioTargetMet} onStartCardio={cardioOpen ? undefined : () => void openCardio()} />
        ) : null}

        {!inSession && !showCardio && next.done_today && (
          <div className="flex flex-col gap-2">
            {todaySessionId && (
              <Button variant="secondary" size="md" block onClick={() => navigate(`/summary/${todaySessionId}`)}>
                See today's summary
              </Button>
            )}
          </div>
        )}
        {!inSession && !showCardio && cardioTargetMet && (
          <Button variant="ghost" size="sm" className="self-start" onClick={() => void openCardio()}>
            + Easy bonus cardio
          </Button>
        )}

        {/* cardio, inline */}
        {showCardio && (
          <div id="today-cardio">
            <CardioPanel
              plan={state.cardio}
              session={activeCardio ?? cardioSession}
              sound={sound}
              onClose={closeCardio}
              onSaved={(id) => {
                closeCardio();
                navigate(`/summary/${id}`);
              }}
            />
          </div>
        )}

        {/* 4 · check-in */}
        {!inSession && !showCardio && checkin !== undefined && (
          <div id="today-checkin">
            <CheckinCard
              key={state.today}
              value={checkinValue}
              skipped={skippedFor === state.today}
              onSave={(scores) => void saveCheckin({ date: state.today, ...scores }).catch((e) => console.warn("[today] check-in", e))}
              onSkip={() => {
                setSkippedFor(state.today);
                writeCheckinSkip(state.today);
              }}
            />
          </div>
        )}

        {/* 5 · what changed today */}
        {showStrength && plan && <AdjustmentBanner adjustments={plan.adjustments} />}
        {showStrength && plan && <SpacingWarnings warnings={plan.warnings} />}

        {/* 6 · version buttons (before the first set) */}
        {!inSession && showStrength && recommendShort && preMode === "short" && choice.mode == null && (
          <RecommendNote reason={next.recommended_reason ?? null} onFull={() => updateChoice({ mode: "full" })} />
        )}
        {!inSession && showStrength && (
          <ModeBar
            mode={preMode}
            swapping={swapping}
            shortAvailable={shortAvailable}
            travelAvailable
            onModeChange={(mode) => updateChoice({ mode })}
            onSwappingChange={setSwapping}
          />
        )}

        {/* 7 · exercises */}
        {showStrength && plan && (
          <div id="today-exercises" className="flex flex-col gap-3">
            <PlanHeading plan={plan} />
            <StrengthSession
              key="strength"
              plan={plan}
              session={activeStrength}
              start={startFromPlan}
              exercises={ctx.exercises}
              today={state.today}
              swapping={swapping}
              onPreSwap={(pid, exerciseId) => {
                const swaps = { ...choice.swaps };
                if (exerciseId) swaps[pid] = exerciseId;
                else delete swaps[pid];
                updateChoice({ swaps });
              }}
              blockSwaps={ctx.settings.block_swaps}
              sound={sound}
              onFinished={(id) => navigate(`/summary/${id}`)}
              dockPrompt={checkinPending ? <CheckinPrompt onOpen={() => scrollToId("today-checkin", "center")} /> : null}
            />
          </div>
        )}
        {showStrength && !plan && planOpts && (planned.error ? <PlanUnavailable error={planned.error} /> : <Skeleton height={320} />)}
      </Page>
    </>
  );
}

function PlanUnavailable({ error }: { error: Error }) {
  return (
    <div className="rounded-[3px] border border-line px-4 py-3 text-[14px] leading-snug text-paper">
      This version could not be planned. Your log is safe.
      <span className="mt-1 block text-[12px] text-paper-faint">{error.message}</span>
    </div>
  );
}
