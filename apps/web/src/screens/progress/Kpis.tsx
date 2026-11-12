/** Four headline numbers: sessions vs target, sets per muscle vs band, cardio vs WHO, e1RM trend on main lifts. */
import type { EngineContext, EngineState } from "@gym/engine";
import { weekStatusText } from "../../components";
import { cx } from "../../lib/cx";
import { fmtRange } from "../../lib/format";
import { firstBandWeek } from "../plan/model";
import { e1rmTrend, volumeSummary, type E1rmSeries } from "./model";

function Tile({ label, value, unit, sub, go, className }: { label: string; value: string; unit?: string; sub: string; go?: boolean; className?: string }) {
  return (
    <div className={cx("flex min-h-[112px] flex-col justify-between gap-2 rounded-[20px] bg-card px-3.5 py-3.5", go && "ring-1 ring-volt/50", className)}>
      <span className="gym-label">{label}</span>
      <span className="font-display text-[30px] leading-none text-fg">
        {value}
        {unit && <span className="ml-1 font-sans text-[12px] font-medium text-fg-dim">{unit}</span>}
      </span>
      <span className={cx("text-[12px] leading-snug", go ? "text-volt" : "text-fg-dim")}>{sub}</span>
    </div>
  );
}

const pctText = (p: number) => `${p >= 0 ? "+" : "−"}${Math.abs(Math.round(p * 100))}%`;

export function Kpis({ state, ctx, e1rm }: { state: EngineState; ctx: EngineContext; e1rm: E1rmSeries[] }) {
  const week = state.current_week;
  const goals = ctx.config.week;
  const done = Math.min(week.strength_done, goals.strength_target) + Math.min(week.cardio_done, goals.cardio_target);
  const status = weekStatusText(week);
  const vs = volumeSummary(state, ctx);
  const vol = state.volume.find((v) => v.week_id === week.id);
  const who = Math.round(vol?.who_minutes ?? 0);
  const whoTarget = vol?.who_target ?? ctx.config.who.weekly_minutes;
  const trend = e1rmTrend(e1rm);
  const bandWeek = firstBandWeek(ctx.program, ctx.config.volume.band_phases);

  return (
    <div className="grid grid-cols-2 gap-2">
      <Tile
        label="This week"
        value={`${done} of ${goals.strength_target + goals.cardio_target}`}
        sub={
          status ??
          (week.strength_done >= goals.strength_floor
            ? "Minimum done"
            : week.strength_done === 0
              ? `Minimum is ${goals.strength_floor} workouts`
              : `${week.strength_done} of ${goals.strength_floor} workouts for the minimum`)
        }
        go={week.floor_reached}
      />
      {vs.band ? (
        <Tile
          label="Sets per muscle"
          value={`${vs.in_band} of ${vs.muscles}`}
          unit="on target"
          sub={vs.below || vs.above ? [vs.below ? `${vs.below} low` : null, vs.above ? `${vs.above} high` : null].filter(Boolean).join(" · ") : `All at ${fmtRange(vs.band.min, vs.band.max)} sets`}
          go={vs.in_band === vs.muscles}
        />
      ) : (
        <Tile
          label="Sets per muscle"
          value={String(vs.average)}
          unit="avg"
          sub={`Aim is ${fmtRange(ctx.config.volume.band_min, ctx.config.volume.band_max)} from week ${bandWeek ?? 5}`}
        />
      )}
      <Tile label="Active minutes" value={`${who}`} unit={`of ${whoTarget}`} sub={who >= whoTarget ? "Weekly minutes reached ✓" : `Cardio ${week.cardio_done} of ${goals.cardio_target} · walks count`} go={who >= whoTarget} />
      <Tile
        label="Strength"
        value={trend.pct == null ? "Soon" : pctText(trend.pct)}
        sub={trend.pct == null ? "Shows after two workouts per lift" : `Since your first workout · ${trend.lifts} main ${trend.lifts === 1 ? "lift" : "lifts"}`}
      />
    </div>
  );
}
