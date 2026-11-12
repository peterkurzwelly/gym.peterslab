/**
 * Program: what each session contains (with a how-to for every exercise), how the 12 weeks run,
 * this week with the calendar booking, and the edits. Renders engine state only.
 */
import type { EngineContext, EngineState, PlanOptions } from "@gym/engine";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, ChevronIcon, ExerciseDemo, Page, PageTitle, Pill, SectionHeader, SegmentedControl, ShellTitle, Skeleton, VideoIcon, useGuide, type WeekGoals } from "../components";
import { useEngine, usePlan } from "../data";
import { effortText, phaseLine } from "../lib/effort";
import { BlockSheet } from "./plan/BlockSheet";
import { BookFloor } from "./plan/BookFloor";
import { EditBlock } from "./plan/EditBlock";
import { blockRows, groupByPhase } from "./plan/model";
import { ThisWeek } from "./plan/ThisWeek";
import { WeeklyTargets } from "./plan/WeeklyTargets";
import { prescriptionLine } from "./Workout";

export function ProgramScreen() {
  const { ready, state, ctx, error } = useEngine();
  const groups = useMemo(() => (state && ctx ? groupByPhase(blockRows(state, ctx.program)) : []), [state, ctx]);

  if (!ready) {
    return (
      <Page>
        <Skeleton height={28} width="40%" />
        <Skeleton height={420} />
      </Page>
    );
  }
  if (error || !state || !ctx) {
    return (
      <Page>
        <Pill>Could not plan right now. Your log is safe.</Pill>
      </Page>
    );
  }

  const goals: WeekGoals = ctx.config.week;
  const block = state.block;

  return (
    <Page className="gap-7">
      <ShellTitle>
        <span className="text-fg-dim">{block.complete ? "Block done" : `Week ${block.training_week} of ${block.block_weeks}`}</span>
      </ShellTitle>
      <PageTitle eyebrow={`${block.block_weeks} weeks · three sessions in rotation`}>Program</PageTitle>

      <Sessions state={state} ctx={ctx} />

      <section className="flex flex-col gap-3" aria-labelledby="program-how">
        <SectionHeader>
          <span id="program-how">How it works</span>
        </SectionHeader>
        <HowItWorks goals={goals} />
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="plan-week">
        <SectionHeader>
          <span id="plan-week">This week</span>
        </SectionHeader>
        <ThisWeek state={state} ctx={ctx} goals={goals} />
        <BookFloor state={state} ctx={ctx} />
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="plan-block">
        <SectionHeader right={block.extension_weeks > 0 ? `+${block.extension_weeks} wk` : `${block.block_weeks} weeks`}>
          <span id="plan-block">The 12 weeks</span>
        </SectionHeader>
        <BlockSheet groups={groups} goals={goals} extensionWeeks={block.extension_weeks} />
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="plan-targets">
        <SectionHeader>
          <span id="plan-targets">Weekly targets</span>
        </SectionHeader>
        <WeeklyTargets state={state} ctx={ctx} />
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="plan-edit">
        <SectionHeader>
          <span id="plan-edit">Edit</span>
        </SectionHeader>
        <EditBlock state={state} ctx={ctx} />
      </section>
    </Page>
  );
}

type Tab = "A" | "B" | "C" | "TRAVEL";

/** The sessions of the rotation: every exercise with a photo, the prescription for this week and a how-to. */
function Sessions({ state, ctx }: { state: EngineState; ctx: EngineContext }) {
  const navigate = useNavigate();
  const openGuide = useGuide();
  const codes = useMemo(() => ctx.program.days.filter((d) => d.code !== "CARDIO").map((d) => d.code as Tab), [ctx.program]);
  const [tab, setTab] = useState<Tab>(state.next.code as Tab);
  const opts = useMemo<PlanOptions>(() => ({ code: tab, mode: tab === "TRAVEL" ? "travel" : "full" }), [tab]);
  const { plan } = usePlan(opts);
  const isNext = tab === state.next.code;
  const options = [...codes.filter((c) => c !== "TRAVEL").map((c) => ({ value: c, label: c })), { value: "TRAVEL" as Tab, label: "Travel" }];

  return (
    <section className="flex flex-col gap-3" aria-label="Sessions">
      <SegmentedControl label="Session" options={options} value={tab} onChange={setTab} />
      {!plan ? (
        <Skeleton height={420} />
      ) : (
        <div className="overflow-hidden rounded-[20px] bg-card">
          <div className="p-4 pb-3">
            <div className="gym-label">
              {tab === "TRAVEL" ? "Hotel gym or dumbbells" : `Session ${tab}`}
              {isNext && <span className="text-volt"> · next in line</span>}
            </div>
            <h2 className="m-0 mt-1.5 font-display text-[34px] uppercase leading-[0.95] text-fg">{tab === "TRAVEL" ? "Travel workout" : plan.name}</h2>
            <p className="m-0 mt-2 text-[14px] leading-snug text-fg-dim">
              About {plan.est_minutes} min · {effortText(plan.exercises[0]?.target_rir ?? 2)}. {phaseLine(plan.phase)}
            </p>
          </div>
          <ul className="m-0 list-none divide-y divide-line/60 border-t border-line/60 p-0">
            {plan.exercises.map((ex, i) => (
              <li key={`${ex.prescription_id}:${ex.exercise_id}`}>
                <button type="button" onClick={() => openGuide(ex.exercise_id)} aria-label={`How to do ${ex.name}`} className="flex w-full items-center gap-3 py-2.5 pl-3 pr-3 text-left active:bg-raise">
                  <span className="relative shrink-0">
                    <ExerciseDemo exerciseId={ex.exercise_id} name={ex.name} still className="h-[64px] w-[80px] rounded-[12px]" />
                    <span aria-hidden className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full border-2 border-card bg-fg text-night">
                      <VideoIcon size={13} strokeWidth={2.25} />
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="gym-label block truncate">
                      {i + 1}
                      {ex.starred && tab !== "TRAVEL" ? " · short version too" : ""}
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-[16px] font-semibold leading-tight text-fg">{ex.name}</span>
                    <span className="mt-0.5 block text-[13.5px] tabular-nums leading-snug text-fg-dim">{prescriptionLine(ex)}</span>
                  </span>
                  <ChevronIcon size={18} className="shrink-0 text-fg-faint" />
                </button>
              </li>
            ))}
          </ul>
          {isNext && !state.next.done_today && (
            <div className="border-t border-line/60 p-3">
              <Button variant="primary" size="md" block onClick={() => navigate("/workout")}>
                Open this workout
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function HowItWorks({ goals }: { goals: WeekGoals }) {
  const items: { title: string; body: string }[] = [
    {
      title: "What gets you ripped",
      body: "Three things at once. Lift, so your body keeps its muscle. Eat a little under what you burn with plenty of protein, so the loss is fat. Walk every day, because it burns without wearing you down. Then repeat for 12 weeks. No single workout matters as much as not stopping.",
    },
    {
      title: "The weekly deal",
      body: `${goals.strength_target} workouts and ${goals.cardio_target} cardio is a full week. ${goals.strength_floor} workouts is the minimum and keeps the streak. No fixed days: you always do the next session in line, whenever it fits. Missed a day? It is gone. Never do two in one day to catch up.`,
    },
    {
      title: "How the weights go up",
      body: "Every exercise has a rep range, say 5 to 8. Keep the weight until every set reaches the top of the range, then the app adds weight and you start again at the bottom. You never have to decide: the next target is always on screen with the reason.",
    },
    {
      title: "How hard to push",
      body: "\"Leave 3 in the tank\" means stop when you could still do three more good reps. Weeks 1 to 4 are easy on purpose. Weeks 5 to 7 leave two. Week 8 is a recovery week. Weeks 9 to 11 are the hard ones. Week 12 shows what you built.",
    },
    {
      title: "Short on time",
      body: "The short version is the main lifts only, one set less, about 30 minutes. It counts fully. A short workout always beats a skipped one.",
    },
  ];
  return (
    <div className="overflow-hidden rounded-[20px] bg-card">
      {items.map((it, i) => (
        <details key={it.title} className="group border-line/60 [&:not(:first-child)]:border-t" open={i === 0}>
          <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-3 px-4 text-[15.5px] font-semibold text-fg [&::-webkit-details-marker]:hidden">
            {it.title}
            <ChevronIcon size={18} className="shrink-0 text-fg-faint transition-transform duration-150 group-open:rotate-90" />
          </summary>
          <p className="m-0 px-4 pb-4 text-[14.5px] leading-relaxed text-fg-dim">{it.body}</p>
        </details>
      ))}
    </div>
  );
}
