/**
 * Progress tab: leaner (weight trend and habits), stronger (headline numbers and charts), consistent (weeks trained),
 * engine flags and the weekly review.
 * Charts are lazy loaded so Recharts never touches the Today bundle or the first paint here.
 */
import { lazy, Suspense, useMemo } from "react";
import { Card, Page, PageTitle, Pill, SectionHeader, ShellTitle, Skeleton } from "../components";
import { useBody, useEngine, useSettings } from "../data";
import { weekdayOf } from "./plan/booking";
import { BodySection } from "./progress/Body";
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
  const body = useBody();
  const settings = useSettings();
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
    <Page className="gap-7">
      <ShellTitle>
        <span className="text-fg-dim">
          Week {state.current_week.training_week} of {state.block.block_weeks}
        </span>
      </ShellTitle>
      <PageTitle eyebrow="Leaner · stronger · consistent">Progress</PageTitle>

      {sunday && (
        <section className="flex flex-col gap-3" aria-label="Weekly review">
          {review}
        </section>
      )}

      {body && settings && (
        <section className="flex flex-col gap-3" aria-labelledby="progress-body">
          <SectionHeader>
            <span id="progress-body">Leaner</span>
          </SectionHeader>
          <BodySection body={body} settings={settings} />
        </section>
      )}

      <section className="flex flex-col gap-3" aria-labelledby="progress-charts">
        <SectionHeader right={`Week ${state.current_week.training_week}`}>
          <span id="progress-charts">Stronger</span>
        </SectionHeader>
        <Kpis state={state} ctx={ctx} e1rm={charts.e1rm} />
        {charts.has_history ? (
          <Suspense fallback={<ChartsFallback />}>
            <ProgressCharts data={charts} />
          </Suspense>
        ) : (
          <Card label="Charts" meta="After the first workouts">
            <p className="m-0 text-[13.5px] leading-snug text-fg-dim">Nothing to draw yet, and that is fine. These fill in as you train:</p>
            <ul className="m-0 mt-2 list-none p-0 text-[13.5px] leading-relaxed text-fg">
              <li>· Estimated max on your main lifts</li>
              <li>· Weekly sets per muscle</li>
              <li>· Cardio and walking minutes</li>
              <li>· How you felt, week by week</li>
            </ul>
          </Card>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="progress-streak">
        <SectionHeader>
          <span id="progress-streak">Consistent</span>
        </SectionHeader>
        <StreakCard state={state} />
        <RepairsCard state={state} ctx={ctx} />
        <TotalsCard state={state} />
      </section>

      {state.flags.length > 0 && (
        <section className="flex flex-col gap-3" aria-labelledby="progress-flags">
          <SectionHeader>
            <span id="progress-flags">Heads up</span>
          </SectionHeader>
          <FlagsCard flags={state.flags} />
        </section>
      )}

      {!sunday && (
        <section className="flex flex-col gap-3" aria-labelledby="progress-review">
          <SectionHeader>
            <span id="progress-review">Weekly review</span>
          </SectionHeader>
          {review}
        </section>
      )}
    </Page>
  );
}
