/** This week: sessions done, next in line, cardio still open. */
import type { EngineContext, EngineState } from "@gym/engine";
import { Link } from "react-router-dom";
import { Card, ChevronIcon, weekDoneText, weekStatusText, type WeekGoals } from "../../components";
import { cx } from "../../lib/cx";
import { fmtApproxMin, fmtMinutes, fmtRelativeDate, fmtWeekRange } from "../../lib/format";
import { sessionLabel, weekSessions } from "./model";

export function ThisWeek({ state, ctx, goals }: { state: EngineState; ctx: EngineContext; goals: WeekGoals }) {
  const week = state.current_week;
  const rows = weekSessions(week, ctx, state.active?.session.id ?? null);
  const status = weekStatusText(week);
  const next = state.next;
  const day = ctx.program.days.find((d) => d.code === next.code);
  const short = next.recommended_mode === "short";
  const cardioOpen = week.cardio_done < goals.cardio_target;
  const notStarted = state.today < week.start_date;
  const tone = week.target_reached ? "go-strong" : week.floor_reached ? "go" : "default";

  return (
    <Card label={`Week ${week.training_week} · ${fmtWeekRange(week.start_date, week.end_date)}`} meta={week.phase_label} tone={tone}>
      <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-[15px] text-paper">
        <span>{weekDoneText(week, goals)}</span>
        {status && (
          <span className="whitespace-nowrap">
            <span className="mr-2 text-paper-faint">·</span>
            <span className="font-medium text-go">{status}</span>
          </span>
        )}
      </p>
      {(week.floor_reached ? week.to_target_text : week.to_floor_text) && (
        <p className="m-0 mt-1 text-[13px] leading-snug text-paper-dim">{week.floor_reached ? week.to_target_text : week.to_floor_text}</p>
      )}

      <div className="mt-4 text-[11px] uppercase tracking-[0.14em] text-paper-faint">Done</div>
      {rows.length === 0 ? (
        <p className="m-0 mt-1.5 text-[13px] leading-snug text-paper-dim">
          {notStarted ? `The block starts ${fmtRelativeDate(week.start_date, state.today)}.` : "Nothing logged yet. The next session is whenever it fits."}
        </p>
      ) : (
        <ul className="m-0 mt-1 list-none divide-y divide-line/70 p-0">
          {rows.map((r) => (
            <li key={r.id} className="flex min-h-11 items-center justify-between gap-3 py-2">
              <span className="min-w-0 text-[14px] text-paper">
                <span className="text-paper-dim">{fmtRelativeDate(r.date, state.today)} · </span>
                {sessionLabel(r.code, r.mode)}
              </span>
              <span className="shrink-0 text-[12px] text-paper-dim">
                {r.active ? "In progress" : r.code === "CARDIO" ? fmtMinutes(r.cardio_minutes) : `${r.sets} sets`}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 text-[11px] uppercase tracking-[0.14em] text-paper-faint">Next in line</div>
      <Link
        to="/"
        className="gym-press -mx-2 mt-1 flex min-h-12 items-center gap-3 rounded-[3px] px-2 py-2 text-left no-underline active:bg-ink-3"
        aria-label={`Next: Session ${next.code}. Open Today`}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] text-paper">
            Session {next.code}
            {day && <span className="text-paper-dim"> · {day.name}</span>}
          </span>
          <span className="mt-0.5 block text-[12.5px] leading-snug text-paper-dim">
            {next.done_today ? next.reason : short ? `★ 30 min version · ${next.short_minutes ?? 30} min` : `${fmtApproxMin(next.est_minutes)}${next.short_minutes ? ` · ★ ${next.short_minutes} min version` : ""}`}
          </span>
          {short && next.recommended_reason && !next.done_today && (
            <span className="mt-0.5 block text-[12.5px] leading-snug text-paper">{next.recommended_reason}</span>
          )}
        </span>
        <ChevronIcon size={18} className="shrink-0 text-paper-faint" />
      </Link>
      {cardioOpen && (
        <p className={cx("m-0 mt-1 text-[12.5px] leading-snug text-paper-dim")}>
          Cardio · {state.cardio.kind === "intervals" && state.cardio.intervals ? `${state.cardio.intervals.count} × ${state.cardio.intervals.hard_min} min hard` : "easy"} · {fmtApproxMin(state.cardio.total_min)} · any day
        </p>
      )}
      <p className="m-0 mt-1 text-[12.5px] leading-snug text-paper-faint">Travelling? The travel version counts toward the floor.</p>
    </Card>
  );
}
