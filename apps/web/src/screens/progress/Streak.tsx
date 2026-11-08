/** Weeks without a zero (the headline), runs, repairs and cumulative totals. */
import type { EngineContext, EngineState, WeekState } from "@gym/engine";
import { useState } from "react";
import { Button, Card } from "../../components";
import { repairWeek } from "../../data";
import { cx } from "../../lib/cx";
import { fmtInt, fmtWeekRange } from "../../lib/format";

function Figure({ label, value, unit, className }: { label: string; value: string; unit?: string; className?: string }) {
  return (
    <div className={cx("flex flex-col gap-0.5", className)}>
      <span className="text-[11px] uppercase tracking-[0.12em] text-paper-faint">{label}</span>
      <span className="text-[20px] font-semibold leading-tight text-paper [font-variant-numeric:normal]">
        {value}
        {unit && <span className="ml-1 text-[12px] font-normal text-paper-dim">{unit}</span>}
      </span>
    </div>
  );
}

export function StreakCard({ state }: { state: EngineState }) {
  const s = state.streak;
  const weeks = state.block.block_weeks;
  return (
    <Card label="Weeks without a zero" meta={state.block.extension_weeks > 0 ? `Block +${state.block.extension_weeks} wk` : undefined} tone={s.weeks_without_zero > 0 && s.current_run > 0 ? "go" : "default"}>
      <p className="m-0 flex items-baseline gap-2" aria-label={`Weeks without a zero: ${s.weeks_without_zero} of ${weeks}`}>
        <span aria-hidden className="font-display text-[64px] leading-[0.95] tracking-[-0.02em] text-paper [font-variant-numeric:normal]">
          {s.weeks_without_zero}
        </span>
        <span aria-hidden className="font-display text-[28px] leading-none text-paper-dim">of {weeks}</span>
      </p>
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line/70 pt-3">
        <Figure label="Floor weeks" value={String(s.floor_weeks)} />
        <Figure label="Target weeks" value={String(s.target_weeks)} />
        <Figure label="Current run" value={String(s.current_run)} unit={s.current_run === 1 ? "week" : "weeks"} />
        <Figure label="Best run" value={String(s.best_run)} unit={s.best_run === 1 ? "week" : "weeks"} />
      </div>
      {s.weeks_without_zero === 0 && (
        <p className="m-0 mt-3 text-[12.5px] leading-snug text-paper-dim">The first session of a week makes it count. Two strength sessions reach the floor.</p>
      )}
    </Card>
  );
}

function RepairRow({ week, ctx }: { week: WeekState; ctx: EngineContext }) {
  const [busy, setBusy] = useState(false);
  const run = async (on: boolean) => {
    setBusy(true);
    try {
      await repairWeek(week.id, on);
    } finally {
      setBusy(false);
    }
  };
  const windowWeeks = ctx.config.week.repair.window_weeks;
  return (
    <li className="flex min-h-12 items-center justify-between gap-3 border-t border-line/70 py-2">
      <span className="min-w-0">
        <span className="block text-[14px] text-paper">Week of {fmtWeekRange(week.start_date, week.end_date)}</span>
        <span className="block text-[12px] text-paper-faint">
          {week.repaired ? "Repaired · streak kept" : week.can_repair ? "Paused week" : `Paused week · one repair per ${windowWeeks} weeks is in use`}
        </span>
      </span>
      {week.repaired ? (
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(false)}>
          Undo
        </Button>
      ) : week.can_repair ? (
        <Button variant="primary" size="sm" disabled={busy} onClick={() => void run(true)}>
          Repair
        </Button>
      ) : null}
    </li>
  );
}

export function RepairsCard({ state, ctx }: { state: EngineState; ctx: EngineContext }) {
  const zeros = state.weeks.filter((w) => w.status === "zero").reverse();
  if (!zeros.length) return null;
  const { window_weeks, max_per_window } = ctx.config.week.repair;
  return (
    <Card label="Repairs" meta={`${state.streak.repairs_used} used`}>
      <p className="m-0 text-[13px] leading-snug text-paper-dim">
        A repair is a streak freeze: a paused week counts toward weeks without a zero. Allowed {max_per_window === 1 ? "once" : `${max_per_window} times`} per {window_weeks} weeks. The block still runs a week longer.
      </p>
      <ul className="m-0 mt-2 list-none p-0">
        {zeros.map((w) => (
          <RepairRow key={w.id} week={w} ctx={ctx} />
        ))}
      </ul>
    </Card>
  );
}

export function TotalsCard({ state }: { state: EngineState }) {
  const t = state.totals;
  return (
    <Card label="Since day one" meta="Never resets">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Figure label="Sessions" value={fmtInt(t.sessions)} />
        <Figure label="Sets" value={fmtInt(t.sets)} />
        <Figure label="Cardio" value={fmtInt(t.cardio_minutes)} unit="min" />
        <Figure label="Lifted" value={fmtInt(t.kg_lifted)} unit="kg" />
      </div>
      {t.walking_minutes > 0 && <p className="m-0 mt-3 text-[12.5px] text-paper-dim">Plus {fmtInt(t.walking_minutes)} min walking.</p>}
    </Card>
  );
}
