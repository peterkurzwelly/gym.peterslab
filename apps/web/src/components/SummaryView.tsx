import type { SessionChange, SessionSummary } from "@gym/engine";
import { cx } from "../lib/cx";
import { fmtInt, fmtKg, fmtKgDelta, fmtMinutes } from "../lib/format";
import { Button } from "./Button";
import { SectionHeader } from "./SectionHeader";
import { WeekLine, type WeekGoals } from "./WeekCard";

export interface SummaryViewProps {
  summary: SessionSummary;
  onDone: () => void;
  /** Block length for "Week 3 of 12" in the week line. */
  blockWeeks?: number;
  goals?: WeekGoals;
  className?: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function sessionTitle(s: SessionSummary): string {
  if (s.code === "CARDIO") return "Cardio done.";
  if (s.code === "TRAVEL") return "Travel session done.";
  if (s.mode === "short") return `★ Session ${s.code} done.`;
  return `Session ${s.code} done.`;
}

/** The headline delta for a change: "+2.5 kg", "aim 8", "same". */
export function changeDelta(c: SessionChange): string {
  const { from, to } = c;
  if (!to) return "";
  if (from?.weight != null && to.weight != null && from.weight !== to.weight) return `${fmtKgDelta(to.weight - from.weight)} kg`;
  if (from && to.reps !== from.reps) return `aim ${to.reps}`;
  if (!from && to.weight != null) return `${fmtKg(to.weight)} kg`;
  return "same";
}

export function SummaryView({ summary, onDone, blockWeeks, goals, className }: SummaryViewProps) {
  const s = summary;
  return (
    <div className={cx("flex flex-col gap-5", className)}>
      <header>
        <div className="text-[11px] uppercase tracking-[0.16em] text-paper-faint">Summary</div>
        <h1 className="m-0 mt-1 font-display text-[46px] font-normal leading-[1.02] tracking-[-0.01em] text-paper">{sessionTitle(s)}</h1>
        <p className="mt-2 text-[14px] tabular-nums text-paper-dim">
          {fmtMinutes(s.duration_min)} · {s.sets_logged} sets
          {s.kg_lifted > 0 && ` · ${fmtInt(s.kg_lifted)} kg`}
        </p>
      </header>

      <div className="rounded-[3px] border border-line px-4 py-3">
        <WeekLine week={s.week} blockWeeks={blockWeeks} goals={goals} />
        {!s.week.floor_reached && s.week.to_floor_text && <p className="mt-1 text-[13px] text-paper-dim">{s.week.to_floor_text}</p>}
        {s.week.floor_reached && !s.week.target_reached && s.week.to_target_text && <p className="mt-1 text-[13px] text-paper-dim">{s.week.to_target_text}</p>}
      </div>

      {s.changes.length > 0 && (
        <section>
          <SectionHeader>Next time</SectionHeader>
          <ul className="m-0 mt-1 list-none divide-y divide-line/70 p-0">
            {s.changes.map((c) => (
              <li key={c.decision_id} className="py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 text-[15px] font-medium text-paper">{c.name}</span>
                  <span className="shrink-0 text-[15px] font-semibold tabular-nums text-paper">{changeDelta(c)}</span>
                </div>
                <p className="mt-1 text-[13px] leading-snug text-paper-dim">{c.explanation}</p>
                {c.to && c.to.weight != null && (
                  <p className="mt-0.5 text-[12px] tabular-nums text-paper-faint">
                    Next: {fmtKg(c.to.weight)} kg × {c.to.reps}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {s.prs.length > 0 && (
        <section>
          <SectionHeader>Personal bests</SectionHeader>
          <ul className="m-0 mt-1 list-none divide-y divide-line/70 p-0">
            {s.prs.map((p) => (
              <li key={p.exercise_id} className="py-3">
                <div className="text-[15px] font-medium text-paper">{p.name}</div>
                <div className="mt-0.5 text-[13px] tabular-nums text-paper-dim">
                  e1RM <span className="font-semibold text-paper">{fmtKg(round1(p.e1rm))}</span> kg
                  {p.previous_best != null && <span className="text-paper-faint"> · was {fmtKg(round1(p.previous_best))}</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Button variant="primary" size="lg" block onClick={onDone} className="mt-2">
        Done
      </Button>
    </div>
  );
}
