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
  className?: string;
}

/** Dock bar: elapsed time, sets done, Finish. */
export function FinishBar({ startedAt, setsDone, setsTotal, onFinish, disabled, className }: FinishBarProps) {
  const now = useNow(true, 1000);
  const elapsed = Math.max(0, (now - toMs(startedAt)) / 1000);
  return (
    <div className={cx("flex items-center gap-3 rounded-[4px] border border-line bg-ink-2 py-2 pl-4 pr-2 shadow-[0_8px_24px_rgba(0,0,0,0.45)]", className)}>
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[20px] font-semibold leading-tight tabular-nums text-paper">{fmtClock(elapsed)}</div>
        <div className="text-[11px] uppercase tracking-[0.12em] text-paper-faint">
          {setsDone}
          {setsTotal != null ? ` of ${setsTotal}` : ""} sets
        </div>
      </div>
      <Button variant="primary" size="lg" onClick={onFinish} disabled={disabled} className="px-7">
        Finish
      </Button>
    </div>
  );
}
