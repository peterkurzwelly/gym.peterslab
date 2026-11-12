/**
 * Today: the next workout up front, the week at a glance, and the daily fat loss levers.
 * Renders from Dexie immediately. The engine owns every number.
 */
import { localDate, type EngineContext, type EngineState } from "@gym/engine";
import type { Settings } from "@gym/schema";
import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button, CheckIcon, ClockIcon, ExerciseDemo, HeartIcon, Page, ShellTitle, describeCardioTotal, useGuide, type WeekGoals } from "../components";
import { useEngine, useSettings } from "../data";
import { useBody } from "../data";
import { cx } from "../lib/cx";
import { phaseLine } from "../lib/effort";
import { BodyCard } from "./home/BodyCard";
import { EngineError, TodaySkeleton } from "./today/Calm";
import { workoutTitle } from "./Workout";

export function HomeScreen() {
  const { ready, state, ctx, error } = useEngine();
  const settings = useSettings();
  if (!ready) return <TodaySkeleton />;
  if (error || !state || !ctx) return <EngineError detail={error?.message ?? null} />;
  return <HomeReady state={state} ctx={ctx} settings={settings ?? null} />;
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function longDate(date: string, weekStart: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const diff = Math.round((Date.UTC(y, m - 1, d) - Date.parse(`${weekStart}T00:00:00Z`)) / 86_400_000);
  return `${WEEKDAYS[((diff % 7) + 7) % 7]} ${d} ${MONTHS[m - 1]}`;
}

function HomeReady({ state, ctx, settings }: { state: EngineState; ctx: EngineContext; settings: Settings | null }) {
  const navigate = useNavigate();
  const openGuide = useGuide();
  const body = useBody();
  useEffect(() => {
    window.scrollTo?.(0, 0);
  }, []);

  const next = state.next;
  const week = state.current_week;
  const block = state.block;
  const goals: WeekGoals = ctx.config.week;
  const active = state.active?.session ?? null;
  const activeStrength = active && active.program_day_id !== "CARDIO" ? active : null;
  const activeCardio = active && active.program_day_id === "CARDIO" ? active : null;
  const plan = state.active && activeStrength ? state.active.plan : next.plan;

  const todaySessionId = useMemo(() => {
    if (!next.done_today) return null;
    const tz = ctx.settings.timezone;
    const mine = ctx.history.sessions
      .filter((s) => !s.deleted_at && s.ended_at && s.program_day_id !== "CARDIO" && localDate(s.started_at, tz) === state.today)
      .sort((a, b) => b.started_at.localeCompare(a.started_at));
    return mine[0]?.id ?? null;
  }, [next.done_today, state.today, ctx]);

  const activeId = active?.id ?? null;
  // What happened on each day of this week.
  const days = useMemo(() => {
    const tz = ctx.settings.timezone;
    const byDate = new Map<string, { strength: string | null; cardio: boolean; live: boolean }>();
    for (const s of ctx.history.sessions) {
      // A workout still open shows as an outline until it is finished.
      const live = !s.ended_at && s.id === activeId;
      if (s.deleted_at || (!s.ended_at && !live)) continue;
      const d = localDate(s.started_at, tz);
      if (d < week.start_date || d > week.end_date) continue;
      const cur = byDate.get(d) ?? { strength: null, cardio: false, live: false };
      if (s.program_day_id === "CARDIO") {
        if (!live) cur.cardio = true;
      } else {
        cur.strength = s.program_day_id === "TRAVEL" ? "T" : s.program_day_id;
        cur.live = live;
      }
      byDate.set(d, cur);
    }
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(week.start_date, i);
      return { date, letter: WEEKDAYS[i]![0]!, ...(byDate.get(date) ?? { strength: null, cardio: false, live: false }) };
    });
  }, [ctx, week.start_date, week.end_date, activeId]);

  const strengthLeft = Math.max(0, goals.strength_target - week.strength_done);
  const floorLeft = Math.max(0, goals.strength_floor - week.strength_done);
  const weekLine = week.target_reached
    ? "Full week done. Anything more is a bonus."
    : week.floor_reached
      ? `Minimum done. ${strengthLeft > 0 ? `${strengthLeft} more ${strengthLeft === 1 ? "workout" : "workouts"} makes it a full week.` : "One cardio makes it a full week."}`
      : week.strength_done === 0
        ? // The streak only needs one session in the week (ENGINE_RULES 8); the minimum is the weekly goal.
          `${floorLeft} ${floorLeft === 1 ? "workout is" : "workouts are"} this week's minimum.${floorLeft > 1 ? " Even one keeps the streak alive." : ""}`
        : `${floorLeft} more ${floorLeft === 1 ? "workout reaches" : "workouts reach"} this week's minimum.`;

  const cardioLine = describeCardioTotal(state.cardio);

  const nudge = !activeStrength && !next.done_today ? (state.nudges.find((n) => n.kind === "never_miss_twice" || n.kind === "comeback" || n.kind === "break_resume" || n.kind === "long_break") ?? null) : null;
  const recommendShort = next.recommended_mode === "short" && next.short_minutes != null;
  const cardioDone = state.cardio.counts_as === "bonus";

  return (
    <>
      <ShellTitle>
        <span className="text-fg-dim">{longDate(state.today, week.start_date)}</span>
      </ShellTitle>

      <Page className="gap-3">
        {/* where you are in the 12 weeks */}
        <div className="px-1 pb-1">
          <div className="flex items-end justify-between gap-3">
            <h1 className="m-0 font-display text-[44px] uppercase leading-[0.92] text-fg">
              Week {Math.min(block.training_week, block.block_weeks)}
              <span className="text-fg-faint"> / {block.block_weeks}</span>
            </h1>
            <div className="pb-1 text-right">
              <div className="font-display text-[22px] leading-none text-volt">{state.streak.weeks_without_zero}</div>
              <div className="gym-label mt-1">Week streak</div>
            </div>
          </div>
          <div className="mt-3 flex gap-1" aria-hidden>
            {block.dots.map((d, i) => (
              <span key={i} className={cx("h-[5px] flex-1 rounded-full", d === "target" || d === "floor" ? "bg-volt" : d === "current" ? "bg-fg" : d === "below_floor" ? "bg-fg-faint" : "bg-raise-2")} />
            ))}
          </div>
        </div>

        {/* the workout */}
        <section className="gym-hero overflow-hidden rounded-[24px]" aria-label="Workout">
          <div className="p-5 pb-4">
            {activeStrength ? (
              <>
                <div className="gym-label !text-volt">In progress</div>
                <h2 className="m-0 mt-2 font-display text-[40px] uppercase leading-[0.95] text-fg">{workoutTitle(plan.code, plan.mode, plan.name)}</h2>
                <p className="m-0 mt-2 text-[14.5px] text-fg-dim">Your sets are saved. Pick up where you left off.</p>
              </>
            ) : next.done_today ? (
              <>
                <div className="gym-label flex items-center gap-1.5 !text-volt">
                  <CheckIcon size={14} strokeWidth={3} /> Done today
                </div>
                <h2 className="m-0 mt-2 font-display text-[40px] uppercase leading-[0.95] text-fg">Workout logged</h2>
                <p className="m-0 mt-2 text-[14.5px] leading-snug text-fg-dim">
                  Next up: {workoutTitle(next.code, "full", next.plan.name)}, tomorrow or whenever it fits. Now eat your protein and get your steps.
                </p>
              </>
            ) : (
              <>
                <div className="gym-label">Next workout · Session {next.code}</div>
                <h2 className="m-0 mt-2 font-display text-[40px] uppercase leading-[0.95] text-fg">{plan.name}</h2>
                <p className="m-0 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14.5px] text-fg-dim">
                  <span>{plan.exercises.length} exercises</span>
                  <span className="inline-flex items-center gap-1">
                    <ClockIcon size={15} /> about {next.est_minutes} min
                  </span>
                </p>
                {nudge ? <p className="m-0 mt-2 text-[14px] leading-snug text-fg">{nudge.kind === "never_miss_twice" ? `Keep it rolling. Even the ${next.short_minutes ?? 30} min version is enough today.` : nudge.text}</p> : phaseLine(plan.phase) && <p className="m-0 mt-2 text-[13.5px] leading-snug text-fg-faint">{phaseLine(plan.phase)}</p>}
              </>
            )}
          </div>

          {!next.done_today && (
            <div className="gym-scroll-x flex gap-2 px-5 pb-4">
              {plan.exercises.map((ex) => (
                <button key={`${ex.prescription_id}:${ex.exercise_id}`} type="button" onClick={() => openGuide(ex.exercise_id)} aria-label={`How to do ${ex.name}`} className="gym-press w-[104px] shrink-0 text-left">
                  <ExerciseDemo exerciseId={ex.exercise_id} name={ex.name} still className="h-[72px] w-[104px] rounded-[14px]" />
                  <span className="mt-1.5 block truncate text-[12px] font-medium text-fg-dim">{ex.name}</span>
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2 px-5 pb-5">
            {activeStrength ? (
              <Button variant="primary" size="lg" block onClick={() => navigate("/workout")}>
                Resume workout
              </Button>
            ) : next.done_today ? (
              todaySessionId && (
                <Button variant="secondary" size="md" block onClick={() => navigate(`/summary/${todaySessionId}`)}>
                  See today's summary
                </Button>
              )
            ) : (
              <>
                <Button variant="primary" size="lg" block onClick={() => navigate(recommendShort ? "/workout?mode=short" : "/workout")}>
                  {recommendShort ? `Start · ${next.short_minutes} min version` : "Start workout"}
                </Button>
                {next.short_minutes != null && (
                  <button type="button" onClick={() => navigate(recommendShort ? "/workout?mode=full" : "/workout?mode=short")} className="min-h-11 self-center px-3 text-[14px] font-medium text-fg-dim active:text-fg">
                    {recommendShort ? `Full ${next.est_minutes} min instead` : `Short on time? ${next.short_minutes} min version`}
                  </button>
                )}
              </>
            )}
          </div>
        </section>

        {/* the week */}
        <section className="rounded-[20px] bg-card p-4" aria-label="This week">
          <div className="flex items-center justify-between gap-3">
            <span className="gym-label">This week</span>
            <span className="text-[12.5px] font-semibold tabular-nums text-fg-dim">
              {Math.min(week.strength_done, goals.strength_target)} of {goals.strength_target} workouts · {Math.min(week.cardio_done, goals.cardio_target)} of {goals.cardio_target} cardio
            </span>
          </div>
          <div className="mt-3 grid grid-cols-7 gap-1.5">
            {days.map((d) => {
              const isToday = d.date === state.today;
              return (
                <div key={d.date} className="flex flex-col items-center gap-1.5">
                  <span className={cx("text-[11px] font-semibold", isToday ? "text-fg" : "text-fg-faint")}>{d.letter}</span>
                  <span
                    className={cx(
                      "relative grid h-10 w-10 place-items-center rounded-full font-display text-[18px]",
                      d.strength && d.live ? "border-2 border-volt text-volt" : d.strength ? "bg-volt text-night" : d.cardio ? "bg-move text-night" : isToday ? "border-2 border-fg/70 text-fg" : "bg-raise text-fg-faint",
                    )}
                    aria-label={`${d.date}${d.strength ? `: session ${d.strength}${d.live ? ", in progress" : ""}` : ""}${d.cardio ? ": cardio" : ""}`}
                  >
                    {d.strength ?? (d.cardio ? <HeartIcon size={18} strokeWidth={2} /> : "")}
                    {d.strength && d.cardio && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-card bg-move" />}
                  </span>
                </div>
              );
            })}
          </div>
          <p className={cx("m-0 mt-3 text-[13.5px] leading-snug", week.floor_reached ? "text-volt" : "text-fg-dim")}>{weekLine}</p>
        </section>

        {/* fuel and move */}
        {body && settings && <BodyCard body={body} settings={settings} />}

        {/* cardio */}
        <section className="flex items-center gap-3 rounded-[20px] bg-card p-4" aria-label="Cardio">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-move/15 text-move">
            <HeartIcon size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-fg">{activeCardio ? "Cardio in progress" : cardioDone ? "Cardio done this week" : "Cardio this week"}</div>
            <div className="truncate text-[13px] text-fg-dim">
              {cardioLine}
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => navigate("/cardio")}>
            {activeCardio ? "Resume" : cardioDone ? "Bonus" : "Start"}
          </Button>
        </section>
      </Page>
    </>
  );
}
