/**
 * Progress tab (SPEC 4.3): weeks without a zero, four headline numbers, charts, engine flags and the Sunday review.
 * Charts are lazy loaded so Recharts never touches the Today bundle or the first paint here.
 */
import { lazy, Suspense, useMemo } from "react";
import { Card, Page, Pill, SectionHeader, ShellTitle, Skeleton } from "../components";
import { useEngine } from "../data";
import { weekdayOf } from "./plan/booking";
import { FlagsCard } from "./progress/Flags";
import { Kpis } from "./progress/Kpis";
import { buildChartData, mainLifts } from "./progress/model";
import { RepairsCard, StreakCard, TotalsCard } from "./progress/Streak";
import { SundayReview } from "./progress/SundayReview";

const ProgressCharts = lazy(() => import("./progress/Charts"));

function ChartsFallback() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      <Skeleton height={236} />
      <Skeleton height={300} />
      <Skeleton height={260} />
    </div>
  );
}

export function ProgressScreen() {
  const { ready, state, ctx, error } = useEngine();
  const lifts = useMemo(() => (ctx ? mainLifts(ctx) : []), [ctx]);
  const charts = useMemo(() => (state && ctx ? buildChartData(state, ctx, lifts) : null), [state, ctx, lifts]);

  if (!ready) {
    return (
      <Page>
        <Skeleton height={180} />
        <Skeleton height={240} />
      </Page>
    );
  }
  if (error || !state || !ctx || !charts) {
    return (
      <Page>
        <Pill>Could not load progress right now. Your log is safe.</Pill>
      </Page>
    );
  }

  const sunday = weekdayOf(state.today) === 0 || state.nudges.some((n) => n.kind === "sunday_review");
  const review = <SundayReview state={state} ctx={ctx} prominent={sunday} mainLiftIds={lifts.map((l) => l.exercise_id)} />;

  return (
    <Page className="gap-6">
      <ShellTitle>
        <span className="text-paper">Progress</span>
        <span className="text-paper-faint">
          {" "}
          · {state.streak.weeks_without_zero} of {state.block.block_weeks}
        </span>
      </ShellTitle>

      {sunday && (
        <section className="flex flex-col gap-3" aria-label="Sunday review">
          {review}
        </section>
      )}

      <section className="flex flex-col gap-3" aria-labelledby="progress-streak">
        <SectionHeader index="01">
          <span id="progress-streak">Consistency</span>
        </SectionHeader>
        <StreakCard state={state} />
        <RepairsCard state={state} ctx={ctx} />
        <TotalsCard state={state} />
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="progress-week">
        <SectionHeader index="02" right={`Week ${state.current_week.training_week}`}>
          <span id="progress-week">This week</span>
        </SectionHeader>
        <Kpis state={state} ctx={ctx} e1rm={charts.e1rm} />
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="progress-charts">
        <SectionHeader index="03">
          <span id="progress-charts">Over time</span>
        </SectionHeader>
        {charts.has_history ? (
          <Suspense fallback={<ChartsFallback />}>
            <ProgressCharts data={charts} />
          </Suspense>
        ) : (
          <Card label="Charts" meta="After the first sessions">
            <p className="m-0 text-[13.5px] leading-snug text-paper-dim">No history yet, and that is fine. These fill in as you train:</p>
            <ul className="m-0 mt-2 list-none p-0 text-[13px] leading-relaxed text-paper">
              <li>· e1RM per main lift</li>
              <li>· Weekly sets per muscle</li>
              <li>· Cardio and walking vs WHO {ctx.config.who.weekly_minutes} min</li>
              <li>· Check-in average per week</li>
            </ul>
          </Card>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="progress-flags">
        <SectionHeader index="04">
          <span id="progress-flags">Flags</span>
        </SectionHeader>
        <FlagsCard flags={state.flags} />
      </section>

      {!sunday && (
        <section className="flex flex-col gap-3" aria-labelledby="progress-review">
          <SectionHeader index="05">
            <span id="progress-review">Sunday review</span>
          </SectionHeader>
          {review}
        </section>
      )}
    </Page>
  );
}
