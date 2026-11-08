/**
 * Floating rest bar for the dock. Driven by absolute timestamps so it stays right after the app was
 * backgrounded. At zero: a beep, a short orange flash, and vibration where it exists. onDone fires once
 * per endsAt.
 */
import { useEffect, useRef } from "react";
import { cx } from "../lib/cx";
import { flashScreen } from "../lib/flash";
import { fmtClock } from "../lib/format";
import { beepLong, vibrate } from "../lib/sound";
import { secondsLeft, toMs, useNow } from "../lib/timers";

export interface RestTimerProps {
  /** When the rest started (ms epoch or ISO). */
  startedAt: number | string;
  /** When the rest ends (ms epoch or ISO). Changing it (e.g. +30 s) re-arms the alert. */
  endsAt: number | string;
  /** What comes next, e.g. "Bench press · set 2". */
  label?: string;
  onAdd: (seconds: number) => void;
  onSkip: () => void;
  onDone: () => void;
  /** Mirrors settings.sound. */
  sound?: boolean;
  className?: string;
}

/** Skip the alert if we only notice the end this late (app came back from the background). */
const LATE_ALERT_MS = 3000;

export function RestTimer({ startedAt, endsAt, label, onAdd, onSkip, onDone, sound = true, className }: RestTimerProps) {
  const start = toMs(startedAt);
  const end = toMs(endsAt);
  const now = useNow(true, 250);
  const left = secondsLeft(end, now);
  const total = Math.max(1, end - start);
  const fraction = Math.min(1, Math.max(0, (end - now) / total));

  const firedFor = useRef<number | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (now < end || firedFor.current === end) return;
    firedFor.current = end;
    if (now - end < LATE_ALERT_MS) {
      if (sound) beepLong();
      flashScreen();
      vibrate([250, 120, 250]);
    }
    onDoneRef.current();
  }, [now, end, sound]);

  return (
    <div
      className={cx("relative overflow-hidden rounded-[4px] border border-line bg-ink-2 shadow-[0_8px_24px_rgba(0,0,0,0.45)]", className)}
      role="timer"
      aria-label={`Rest, ${fmtClock(left)} left`}
    >
      <div aria-hidden className="absolute inset-x-0 top-0 h-[2px] bg-line">
        <div className="h-full origin-left bg-paper" style={{ transform: `scaleX(${fraction})` }} />
      </div>
      <div className="flex items-center gap-2 py-2 pl-4 pr-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[10.5px] uppercase tracking-[0.14em] text-paper-faint">Rest{label ? ` · ${label}` : ""}</div>
          <div className="font-mono text-[34px] font-semibold leading-[1.1] tabular-nums tracking-[-0.02em] text-paper" aria-hidden>
            {fmtClock(left)}
          </div>
        </div>
        <button type="button" onClick={() => onAdd(30)} className="gym-press h-12 shrink-0 rounded-[3px] border border-line px-3 font-mono text-[13px] tabular-nums text-paper active:bg-ink-3">
          +30 s
        </button>
        <button type="button" onClick={onSkip} className="gym-press h-12 shrink-0 rounded-[3px] px-3 font-mono text-[12px] uppercase tracking-[0.1em] text-paper-dim active:bg-ink-3">
          Skip
        </button>
      </div>
    </div>
  );
}
