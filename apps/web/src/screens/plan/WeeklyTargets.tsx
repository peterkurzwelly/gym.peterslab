/** Weekly targets: fractional sets per muscle vs band, cardio, WHO minutes, walking with a quick log. */
import type { EngineContext, EngineState } from "@gym/engine";
import { useState, type ReactNode } from "react";
import { Button, Card } from "../../components";
import { deleteCardio, logWalk } from "../../data";
import { fmtRange, fmtScore } from "../../lib/format";
import { firstBandWeek, muscleLabel, walksOn } from "./model";
import { Caption, Meter, Pips } from "./ui";

const WALK_CHIPS = [10, 20, 30] as const;

function Line({ label, value, children }: { label: string; value: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13.5px] text-paper">{label}</span>
        <span className="shrink-0 text-[13px] tabular-nums text-paper-dim">{value}</span>
      </div>
      {children}
    </div>
  );
}

export function WeeklyTargets({ state, ctx }: { state: EngineState; ctx: EngineContext }) {
  const week = state.current_week;
  const vol = state.volume.find((v) => v.week_id === week.id) ?? null;
  const muscles = ctx.config.volume.tracked_muscles;
  const band = vol?.band ?? null;
  const cfgBand = { min: ctx.config.volume.band_min, max: ctx.config.volume.band_max };
  const bandWeek = firstBandWeek(ctx.program, ctx.config.volume.band_phases);
  const cardioTarget = ctx.config.week.cardio_target;
  const who = vol?.who_minutes ?? 0;
  const whoTarget = vol?.who_target ?? ctx.config.who.weekly_minutes;
  const todayWalks = walksOn(ctx.history.cardioLogs, state.today);
  const todayWalk = todayWalks.reduce((t, c) => t + c.minutes, 0);
  const [last, setLast] = useState<{ id: string; minutes: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const notStarted = state.today < week.start_date;

  const addWalk = async (minutes: number) => {
    setBusy(true);
    try {
      const row = await logWalk(state.today, minutes);
      setLast({ id: row.id, minutes });
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!last) return;
    setBusy(true);
    try {
      await deleteCardio(last.id);
      setLast(null);
    } finally {
      setBusy(false);
    }
  };

  const scaleMax = Math.max(cfgBand.max + 2, ...muscles.map((m) => vol?.by_muscle[m] ?? 0));

  return (
    <div className="flex flex-col gap-3">
      <Card label="Sets per muscle" meta={band ? `Band ${fmtRange(band.min, band.max)}` : "This week · reference"}>
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {muscles.map((m) => {
            const v = vol?.by_muscle[m] ?? 0;
            return (
              <li key={m} className="grid grid-cols-[88px_minmax(0,1fr)_40px] items-center gap-3">
                <span className="truncate text-[13px] text-paper">{muscleLabel(m)}</span>
                <Meter value={v} max={scaleMax} band={band} reached={!!band && v >= band.min} label={`${muscleLabel(m)} ${fmtScore(v)} sets`} />
                <span className="text-right text-[13px] tabular-nums text-paper-dim">{fmtScore(v)}</span>
              </li>
            );
          })}
        </ul>
        <p className="m-0 mt-3 text-[12px] leading-snug text-paper-faint">
          {band
            ? `Fractional sets this week: 1 per set for the main muscle, 0.5 for helpers. The bracket is the ${fmtRange(band.min, band.max)} band.`
            : `No band in the ${week.phase_label.toLowerCase()}. Band ${fmtRange(cfgBand.min, cfgBand.max)} starts${bandWeek ? ` in week ${bandWeek}` : " later"}. Shown for reference.`}
        </p>
      </Card>

      <Card label="Cardio and walking" meta={`WHO ${whoTarget} min`}>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13.5px] text-paper">Cardio sessions</span>
            <span className="flex items-center gap-3">
              <Pips done={week.cardio_done} target={cardioTarget} label={`${week.cardio_done} of ${cardioTarget} cardio sessions`} />
              <span className={week.cardio_done >= cardioTarget ? "text-[13px] font-medium text-go" : "text-[13px] tabular-nums text-paper-dim"}>
                {week.cardio_done >= cardioTarget ? `${week.cardio_done} of ${cardioTarget} ✓` : `${week.cardio_done} of ${cardioTarget}`}
              </span>
            </span>
          </div>
          <Line label="Moderate minutes" value={`${Math.round(who)} of ${whoTarget}`}>
            <Meter value={who} target={whoTarget} max={Math.max(whoTarget * 1.2, who)} reached={who >= whoTarget} label="Moderate minutes this week" />
          </Line>
          <p className="m-0 -mt-2 text-[12px] leading-snug text-paper-faint">Hard minutes count double. Walking counts.</p>

          <div className="border-t border-line/70 pt-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[13.5px] text-paper">Walking</span>
              <span className="text-[13px] tabular-nums text-paper-dim">
                {week.walking_minutes} min this week · {todayWalk} today
              </span>
            </div>
            <Caption className="mt-3">{notStarted ? "Log a walk (counts from Monday)" : "Log a walk today"}</Caption>
            <div className="mt-1.5 grid grid-cols-3 gap-1.5">
              {WALK_CHIPS.map((m) => (
                <Button key={m} size="sm" disabled={busy} onClick={() => void addWalk(m)} aria-label={`Log a ${m} minute walk`}>
                  +{m} min
                </Button>
              ))}
            </div>
            {last && (
              <div className="mt-2 flex min-h-11 items-center justify-between gap-3 text-[13px] text-paper-dim">
                <span>Walk logged · {last.minutes} min</span>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void undo()}>
                  Undo
                </Button>
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
