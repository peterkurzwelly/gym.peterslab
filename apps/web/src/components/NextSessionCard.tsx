import type { CardioPlan, NextSession } from "@gym/engine";
import { fmtApproxMin } from "../lib/format";
import { Button } from "./Button";
import { Card } from "./Card";
import { CheckIcon } from "./Icons";
import { SpacingWarnings } from "./SpacingWarnings";

export interface NextSessionCardProps {
  next: NextSession;
  cardio: CardioPlan;
  /** Cardio target for this week already met. */
  cardioDone: boolean;
  /** Start the next strength session. Buttons are hidden when omitted. */
  onStart?: (mode: "full" | "short") => void;
  onStartCardio?: () => void;
  className?: string;
}

/** "4 × 2 min hard / 2 min easy" or "30 min easy". */
export function describeCardio(plan: CardioPlan): string {
  if (plan.kind === "intervals" && plan.intervals) {
    const { count, hard_min, easy_min } = plan.intervals;
    return `${count} × ${hard_min} min hard / ${easy_min} min easy`;
  }
  return `${plan.total_min} min easy`;
}

/** describeCardio plus the total, without saying the minutes twice ("30 min easy", "4 × 2 min hard / 2 min easy · 26 min"). */
export function describeCardioTotal(plan: CardioPlan): string {
  const text = describeCardio(plan);
  return text.includes(`${plan.total_min} min`) ? text : `${text} · ${plan.total_min} min`;
}

export function NextSessionCard({ next, cardio, cardioDone, onStart, onStartCardio, className }: NextSessionCardProps) {
  const sessionName = `Session ${next.code}`;
  // The engine's done_today reason starts with "Done for today." which is already the headline.
  const doneReason = next.reason.replace(/^Done for today\.\s*/, "");

  return (
    <Card className={className} label={next.done_today ? "Today" : "Next in line"} meta={next.plan.phase_label}>
      {next.done_today ? (
        <>
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-full border border-fg/40 text-fg">
              <CheckIcon size={20} />
            </span>
            <div className="font-display text-[38px] leading-none text-fg">Done for today</div>
          </div>
          <p className="mt-3 text-[14px] leading-snug text-fg-dim">{doneReason}</p>
        </>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <div className="font-display text-[44px] leading-none text-fg">{sessionName}</div>
            <div className="shrink-0 text-[14px] text-fg-dim">{fmtApproxMin(next.est_minutes)}</div>
          </div>
          <p className="mt-1.5 text-[14px] text-fg-dim">{next.name}</p>
          <p className="mt-2 text-[12px] leading-snug text-fg-faint">{next.reason}</p>
          {next.short_minutes != null && (
            <p className="mt-1 text-[12px] text-fg-faint">★ 30 min version available · {fmtApproxMin(next.short_minutes)}</p>
          )}
          {onStart && (
            <div className="mt-4 flex gap-2">
              <Button variant="primary" size="lg" className="flex-1" onClick={() => onStart("full")}>
                Start {next.code}
              </Button>
              {next.short_minutes != null && (
                <Button variant="secondary" size="lg" className="shrink-0 px-4" onClick={() => onStart("short")} aria-label={`Start the 30 min version of session ${next.code}`}>
                  ★ 30 min
                </Button>
              )}
            </div>
          )}
        </>
      )}

      <div className="mt-4 border-t border-line pt-3">
        {cardioDone ? (
          <p className="flex items-center gap-2 text-[13px] text-fg-dim">
            <CheckIcon size={16} /> Cardio done this week
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[11px] uppercase tracking-[0.08em] text-fg-faint">
                Cardio · {cardio.counts_as === "target" ? "counts toward target" : "bonus"}
              </span>
              <span className="shrink-0 text-[13px] text-fg-dim">{fmtApproxMin(cardio.total_min)}</span>
            </div>
            <p className="text-[15px] text-fg">{describeCardio(cardio)}</p>
            <p className="text-[12px] leading-snug text-fg-faint">{cardio.reason}</p>
            <SpacingWarnings warnings={cardio.warnings} />
            {onStartCardio && (
              <Button variant="secondary" size="md" block onClick={onStartCardio}>
                Start cardio
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
