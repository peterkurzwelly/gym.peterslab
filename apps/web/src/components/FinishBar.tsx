import { useEffect, useState } from "react";
import { cx } from "../lib/cx";
import { fmtClock } from "../lib/format";
import { toMs, useNow } from "../lib/timers";
import { Button } from "./Button";

export interface FinishBarProps {
  /** Session start (ms epoch or ISO). */
  startedAt: number | string;
  setsDone: number;
  setsTotal?: number;
  onFinish: () => void;
  disabled?: boolean;
  /**
   * Ask inline before finishing with sets still open (setsDone < setsTotal). Default true: a stray tap
   * near the rest timer must not end the session. No modal; the bar itself turns into the question.
   */
  confirmEarly?: boolean;
  className?: string;
}

const BAR = "rounded-[4px] border border-line bg-ink-2 shadow-[0_8px_24px_rgba(0,0,0,0.45)]";

/** Dock bar: elapsed time, sets done, Finish. With sets still open, the first tap asks "Finish with 1 of 12 sets?". */
export function FinishBar({ startedAt, setsDone, setsTotal, onFinish, disabled, confirmEarly = true, className }: FinishBarProps) {
  const now = useNow(true, 1000);
  const elapsed = Math.max(0, (now - toMs(startedAt)) / 1000);
  const [asking, setAsking] = useState(false);
  const early = confirmEarly && setsTotal != null && setsDone < setsTotal;

  // Logging another set (or removing one) answers the question for Peter: back to the plain bar.
  useEffect(() => setAsking(false), [setsDone]);

  if (asking && early) {
    return (
      <div className={cx(BAR, "px-4 py-3", className)} role="group" aria-label="Finish early">
        <p className="m-0 text-[14px] leading-snug text-paper">
          Finish with {setsDone} of {setsTotal} sets? <span className="text-paper-dim">Open sets are left out. Next time builds on what you logged.</span>
        </p>
        {/* Keep going sits where Finish was, so a second stray tap keeps the session. */}
        <div className="mt-3 flex gap-2">
          <Button variant="primary" size="lg" className="flex-1" onClick={onFinish} disabled={disabled}>
            Finish
          </Button>
          <Button variant="secondary" size="lg" className="flex-1" onClick={() => setAsking(false)}>
            Keep going
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cx(BAR, "flex items-center gap-3 py-2 pl-4 pr-2", className)}>
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[20px] font-semibold leading-tight tabular-nums text-paper">{fmtClock(elapsed)}</div>
        <div className="text-[11px] uppercase tracking-[0.12em] text-paper-faint">
          {setsDone}
          {setsTotal != null ? ` of ${setsTotal}` : ""} sets
        </div>
      </div>
      <Button variant="primary" size="lg" onClick={early ? () => setAsking(true) : onFinish} disabled={disabled} className="px-7">
        Finish
      </Button>
    </div>
  );
}
