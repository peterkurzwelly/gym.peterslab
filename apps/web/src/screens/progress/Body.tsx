/**
 * The body half of Progress: is the weight trend moving the right way, at the right speed.
 * Every number comes from the engine's BodyState; the chart is lazy loaded with the other charts.
 */
import type { BodyState } from "@gym/engine";
import type { Settings } from "@gym/schema";
import { lazy, Suspense, useState } from "react";
import { Button, Skeleton } from "../../components";
import { cx } from "../../lib/cx";
import { fmtInt } from "../../lib/format";
import { BodyCard } from "../home/BodyCard";
import { ProfileSheet, WeightSheet } from "../home/BodySheets";
import { plain } from "../../lib/plain";

const WeightTrendChart = lazy(() => import("./Charts").then((m) => ({ default: m.WeightTrendChart })));

const signed = (n: number, digits = 1) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(digits)}`;

const PACE_LABEL: Record<BodyState["pace"], string> = {
  setup: "Set up",
  collecting: "Collecting",
  on_pace: "On pace",
  slow: "Slower than plan",
  fast: "Faster than plan",
  off_goal: "Off course",
};

function Figure({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-raise px-3 py-2.5">
      <div className="gym-label truncate">{label}</div>
      <div className="mt-1 truncate font-display text-[26px] leading-none text-fg">
        {value}
        {unit && <span className="ml-1 font-sans text-[11.5px] font-medium text-fg-dim">{unit}</span>}
      </div>
    </div>
  );
}

function Habit({ label, value, of, color }: { label: string; value: string; of?: string; color: string }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline gap-1 font-display text-[24px] leading-none text-fg">
        <span aria-hidden className="mr-1 inline-block h-2 w-2 shrink-0 self-center rounded-full" style={{ background: color }} />
        {value}
        {of && <span className="font-sans text-[12px] font-medium text-fg-faint">{of}</span>}
      </div>
      <div className="mt-1 truncate text-[12px] text-fg-dim">{label}</div>
    </div>
  );
}

export function BodySection({ body, settings }: { body: BodyState; settings: Settings }) {
  const [open, setOpen] = useState<null | "weight" | "profile">(null);

  // Nothing to chart until the targets exist: show the same setup card as Today.
  if (!body.profile_complete) return <BodyCard body={body} settings={settings} />;

  // The engine's current weight: the trend, or the last weigh-in when the trend is older than it.
  const shown = body.current_weight ?? body.latest_weight;
  const reached = body.weeks_to_goal === 0;
  const goal = settings.goal_weight_kg;
  const toGoal = goal != null && shown != null ? shown - goal : null;
  const days = new Date(`${body.today}T00:00:00Z`).getUTCDay();
  const daysSoFar = days === 0 ? 7 : days;
  const good = body.pace === "on_pace";

  return (
    <>
      <section className="overflow-hidden rounded-[20px] bg-card" aria-label="Body weight">
        <div className="px-4 pt-4">
          <div className="flex items-center justify-between gap-3">
            <span className="gym-label" style={{ color: "var(--color-body)" }}>
              {body.current_is_trend ? "Weight · 7 day trend" : "Weight · latest"}
            </span>
            <span className={cx("rounded-full px-2.5 py-1 text-[11.5px] font-semibold", good ? "bg-volt text-night" : "bg-raise text-fg-dim")}>{PACE_LABEL[body.pace]}</span>
          </div>
          <p className="m-0 mt-2 flex items-baseline gap-2">
            <span className="font-display text-[64px] leading-[0.95] text-fg">{shown != null ? shown.toFixed(1) : "·"}</span>
            <span className="text-[15px] font-medium text-fg-dim">kg</span>
          </p>
          <p className={cx("m-0 mt-2 text-[14.5px] leading-snug", good ? "text-volt" : "text-fg-dim")}>{plain(body.pace_text)}</p>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <Figure label="Total" value={body.change_kg != null ? signed(body.change_kg) : "·"} unit="kg" />
            <Figure label="Per week" value={body.rate_kg_per_week != null ? signed(body.rate_kg_per_week, 2) : "·"} unit="kg" />
            {goal != null ? (
              <Figure
                label={body.weeks_to_goal != null && body.weeks_to_goal > 0 ? "Goal in" : reached ? "Goal" : "To goal"}
                value={body.weeks_to_goal != null && body.weeks_to_goal > 0 ? String(body.weeks_to_goal) : reached ? "Done" : toGoal != null ? Math.abs(toGoal).toFixed(1) : "·"}
                unit={body.weeks_to_goal != null && body.weeks_to_goal > 0 ? "wk" : reached ? "" : "kg"}
              />
            ) : (
              <Figure label="Waist" value={body.waist ? body.waist.latest.toFixed(1) : "·"} unit="cm" />
            )}
          </div>
        </div>

        <div className="px-4 pb-1 pt-4">
          <Suspense fallback={<Skeleton height={196} />}>
            <WeightTrendChart series={body.series} goal={goal} />
          </Suspense>
        </div>

        {body.waist && (
          <p className="m-0 border-t border-line/60 px-4 py-3 text-[13.5px] text-fg-dim">
            Waist <span className="font-semibold tabular-nums text-fg">{body.waist.latest.toFixed(1)} cm</span>
            {body.waist.change_cm !== 0 && <> · {signed(body.waist.change_cm)} cm since the first measurement</>}
          </p>
        )}

        <div className="flex gap-2 border-t border-line/60 p-3">
          <Button variant="secondary" size="md" className="flex-1" onClick={() => setOpen("weight")}>
            {body.weighed_today ? "Change today's weight" : "Log today's weight"}
          </Button>
          <Button variant="ghost" size="md" onClick={() => setOpen("profile")}>
            Goal
          </Button>
        </div>
      </section>

      <section className="rounded-[20px] bg-card p-4" aria-label="Habits this week">
        <div className="flex items-center justify-between gap-3">
          <span className="gym-label">This week so far</span>
          <span className="text-[12.5px] font-semibold tabular-nums text-fg-dim">{body.targets.kcal != null ? `${fmtInt(body.targets.kcal)} kcal a day` : ""}</span>
        </div>
        <div className="mt-3 flex gap-3">
          <Habit label="Protein days" value={String(body.week.protein_days)} of={`/ ${daysSoFar}`} color="var(--color-fuel)" />
          <Habit label="Steps a day" value={body.week.steps_avg != null ? fmtInt(body.week.steps_avg) : "·"} color="var(--color-move)" />
          <Habit label="Weigh-ins" value={String(body.week.weigh_ins)} of={`/ ${daysSoFar}`} color="var(--color-body)" />
        </div>
        <p className="m-0 mt-3 text-[13px] leading-snug text-fg-dim">{plain(body.targets.reason)}</p>
      </section>

      <WeightSheet open={open === "weight"} onClose={() => setOpen(null)} body={body} />
      <ProfileSheet open={open === "profile"} onClose={() => setOpen(null)} settings={settings} body={body} />
    </>
  );
}
