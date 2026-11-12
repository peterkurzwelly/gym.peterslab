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
  /**
   * Beep, flash and vibrate at zero (default). Today passes false: an app wide watcher owns the alert there,
   * so it also fires on the other tabs, and this bar only reports onDone.
   */
  alert?: boolean;
  className?: string;
}

/** Skip the alert if we only notice the end this late (app came back from the background). */
const LATE_ALERT_MS = 3000;

export function RestTimer({ startedAt, endsAt, label, onAdd, onSkip, onDone, sound = true, alert = true, className }: RestTimerProps) {
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
    if (alert && now - end < LATE_ALERT_MS) {
      if (sound) beepLong();
      flashScreen();
      vibrate([250, 120, 250]);
    }
    onDoneRef.current();
  }, [now, end, sound, alert]);

  return (
    <div className={cx("relative overflow-hidden rounded-[24px] bg-card shadow-[0_12px_32px_rgba(0,0,0,0.6)]", className)} role="timer" aria-label={`Rest, ${fmtClock(left)} left`}>
      <div aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-raise-2">
        <div className="h-full origin-left bg-volt" style={{ transform: `scaleX(${fraction})` }} />
      </div>
      <div className="flex items-center gap-2 py-2.5 pl-4 pr-2.5">
        <div className="min-w-0 flex-1">
          <div className="gym-label truncate">Rest{label ? ` · then ${label}` : ""}</div>
          <div className="mt-0.5 font-display text-[40px] leading-none tabular-nums text-fg" aria-hidden>
            {fmtClock(left)}
          </div>
        </div>
        <button type="button" onClick={() => onAdd(30)} className="gym-press h-12 shrink-0 rounded-full bg-raise px-4 text-[14px] font-semibold tabular-nums text-fg active:bg-raise-2">
          +30 s
        </button>
        <button type="button" onClick={onSkip} className="gym-press h-12 shrink-0 rounded-full px-3 text-[14px] font-semibold text-fg-dim active:bg-raise">
          Skip
        </button>
      </div>
    </div>
  );
}
