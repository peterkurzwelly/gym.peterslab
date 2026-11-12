/**
 * Sunday review (2 minutes): floor hit? target hit? what moved up? then book the two floor sessions.
 * Prominent on Sundays; reachable any day.
 */
import type { EngineContext, EngineState, WeekState } from "@gym/engine";
import { useState, type ReactNode } from "react";
import { Card, CheckIcon, SegmentedControl } from "../../components";
import { cx } from "../../lib/cx";
import { fmtKgDelta, fmtLocalDate, fmtWeekRange } from "../../lib/format";
import { BookFloor } from "../plan/BookFloor";
import { weekdayOf } from "../plan/booking";
import { defaultReviewWeek, movedUp } from "./model";
import { plain } from "../../lib/plain";

function Answer({ q, children, yes }: { q: string; children: ReactNode; yes?: boolean }) {
  return (
    <div className="flex items-start gap-3 border-t border-line/70 py-3">
      <span className={cx("mt-[1px] grid h-6 w-6 shrink-0 place-items-center rounded-full border", yes ? "border-volt text-volt" : "border-fg-faint/70 text-fg-faint")} aria-hidden>
        {yes ? <CheckIcon size={15} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      </span>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-[0.08em] text-fg-faint">{q}</div>
        <p className={cx("m-0 mt-0.5 text-[14px] leading-snug", yes ? "text-volt" : "text-fg")}>{children}</p>
      </div>
    </div>
  );
}

function floorText(w: WeekState): string {
  if (w.floor_reached) return "Yes. Minimum done, the week counts.";
  if (w.status === "zero") return w.repaired ? "Paused week, repaired. The streak holds." : "Paused week. The block extends, nothing to catch up.";
  if (w.is_complete) return "Not this time. It still counts as a trained week.";
  return `Not yet. ${plain(w.to_floor_text) ?? "Two workouts reach it"}.`;
}

function targetText(w: WeekState): string {
  if (w.target_reached) return "Yes. Target reached.";
  if (!w.floor_reached) return "Minimum first. A full week is upside.";
  if (w.is_complete) return "The minimum was the week. A full week is upside.";
  return `Not yet. ${plain(w.to_target_text) ?? "The minimum already counts"}.`;
}

const UPS_SHOWN = 5;

export function SundayReview({ state, ctx, prominent, mainLiftIds = [] }: { state: EngineState; ctx: EngineContext; prominent: boolean; mainLiftIds?: readonly string[] }) {
  const [open, setOpen] = useState(prominent);
  const [allUps, setAllUps] = useState(false);
  const prev = state.weeks.length > 1 ? state.weeks[state.weeks.length - 2]! : null;
  const [which, setWhich] = useState<"this" | "last">(() => defaultReviewWeek(state, weekdayOf(state.today)));
  const week = which === "last" && prev ? prev : state.current_week;
  const started = state.today >= week.start_date;
  const ups = movedUp(state, ctx, week, mainLiftIds);
  const shownUps = allUps ? ups : ups.slice(0, UPS_SHOWN);

  if (!open) {
    return (
      <Card label="Sunday review" meta="2 minutes">
        <p className="m-0 text-[13px] leading-snug text-fg-dim">Minimum, full week, what moved up, then book next week. Best on Sundays, fine any day.</p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="gym-press mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-fg/35 text-[12px] uppercase tracking-[0.08em] text-fg active:bg-raise"
        >
          Open the review
        </button>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Card label="Sunday review" meta={fmtWeekRange(week.start_date, week.end_date)} tone={prominent ? "raised" : "default"}>
        <h2 className="m-0 font-display text-[30px] font-normal leading-[1.05] text-fg">{prominent ? "Two minutes for the week." : "The week in two minutes."}</h2>
        {prev && (
          <SegmentedControl
            className="mt-3"
            label="Week to review"
            value={which}
            onChange={setWhich}
            options={[
              { value: "this", label: "This week" },
              { value: "last", label: "Last week" },
            ]}
          />
        )}
        <div className="mt-3">
          {!started ? (
            <Answer q="Block">The block starts {fmtLocalDate(week.start_date)}. Book the first two sessions below and the week is set.</Answer>
          ) : (
            <>
              <Answer q="Minimum done?" yes={week.floor_reached}>
                {floorText(week)}
              </Answer>
              <Answer q="Target hit?" yes={week.target_reached}>
                {targetText(week)}
              </Answer>
              <div className="border-t border-line/70 py-3">
                <div className="text-[11px] uppercase tracking-[0.08em] text-fg-faint">What moved up</div>
                {ups.length === 0 ? (
                  <p className="m-0 mt-0.5 text-[14px] leading-snug text-fg-dim">No weights went up this week. Same weight, more reps is how it moves.</p>
                ) : (
                  <>
                    <ul className="m-0 mt-1 list-none p-0">
                      {shownUps.map((u) => (
                        <li key={u.decision_id} className="flex min-h-8 items-baseline gap-2 py-0.5 text-[14px] leading-snug" title={plain(u.text)}>
                          <span aria-hidden className="text-fg-faint">↑</span>
                          <span className="min-w-0 flex-1 text-fg">{u.delta == null ? plain(u.text) : u.name}</span>
                          {u.delta != null && <span className="shrink-0 tabular-nums text-fg-dim">{fmtKgDelta(u.delta)} kg</span>}
                        </li>
                      ))}
                    </ul>
                    {ups.length > UPS_SHOWN && (
                      <button type="button" onClick={() => setAllUps((a) => !a)} className="min-h-11 text-[12px] uppercase tracking-[0.08em] text-fg-dim">
                        {allUps ? "Show fewer" : `Show ${ups.length - UPS_SHOWN} more`}
                      </button>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </Card>
      <BookFloor state={state} ctx={ctx} label="Then" />
    </div>
  );
}
