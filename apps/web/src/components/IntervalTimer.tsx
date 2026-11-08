/**
 * 4x4 style interval timer. Timestamp based (start time + paused total), so it survives backgrounding.
 * 3-2-1 beeps before each change and a long beep on it. Keeps the screen awake while running.
 */
import type { CardioPlan } from "@gym/engine";
import { useEffect, useRef, useState } from "react";
import { cx } from "../lib/cx";
import { fmtClock } from "../lib/format";
import { beepLong, beepShort } from "../lib/sound";
import { segmentAt, useNow } from "../lib/timers";
import { useWakeLock } from "../lib/wakeLock";
import { Button } from "./Button";
import { PauseIcon, PlayIcon } from "./Icons";

export interface IntervalResult {
  minutes: number;
  hardMinutes: number;
}

export interface IntervalTimerProps {
  plan: CardioPlan;
  onComplete: (result: IntervalResult) => void;
  sound?: boolean;
  className?: string;
}

interface Run {
  startedAt: number;
  pausedAt: number | null;
  pausedMs: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Minutes done in total and at hard intensity after `elapsed` seconds. */
export function intervalProgress(plan: CardioPlan, elapsed: number): IntervalResult {
  let acc = 0;
  let hard = 0;
  for (const seg of plan.segments) {
    const done = Math.max(0, Math.min(seg.seconds, elapsed - acc));
    if (seg.kind === "hard") hard += done;
    acc += seg.seconds;
  }
  const total = Math.min(elapsed, acc);
  return { minutes: round1(total / 60), hardMinutes: round1(hard / 60) };
}

export function IntervalTimer({ plan, onComplete, sound = true, className }: IntervalTimerProps) {
  const [run, setRun] = useState<Run | null>(null);
  const [finished, setFinished] = useState<IntervalResult | null>(null);
  const running = run != null && run.pausedAt == null && !finished;
  const now = useNow(running, 200);
  useWakeLock(running);

  const elapsed = run ? Math.max(0, ((run.pausedAt ?? now) - run.startedAt - run.pausedMs) / 1000) : 0;
  const pos = segmentAt(plan.segments, elapsed);
  const seg = plan.segments[Math.min(pos.index, plan.segments.length - 1)];
  const nextSeg = plan.segments[pos.index + 1];
  const shownLeft = run ? pos.remainingInSegment : (plan.segments[0]?.seconds ?? 0);

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const beeped = useRef(new Set<string>());
  const lastElapsed = useRef(0);
  const lastIndex = useRef(0);

  // Beeps and completion, derived from elapsed time on every tick.
  useEffect(() => {
    if (!running) return;
    const jumped = elapsed - lastElapsed.current > 2; // came back from the background: stay quiet
    lastElapsed.current = elapsed;

    if (pos.done) {
      if (sound && !jumped) beepLong();
      const result = intervalProgress(plan, pos.total);
      setFinished(result);
      onCompleteRef.current(result);
      return;
    }
    if (pos.index !== lastIndex.current) {
      if (sound && !jumped && pos.index > lastIndex.current) beepLong();
      lastIndex.current = pos.index;
    }
    const sec = Math.ceil(pos.remainingInSegment);
    const key = `${pos.index}:${sec}`;
    if (sec >= 1 && sec <= 3 && !beeped.current.has(key)) {
      beeped.current.add(key);
      if (sound && !jumped) beepShort();
    }
  }, [running, elapsed, pos.done, pos.index, pos.remainingInSegment, pos.total, plan, sound]);

  const start = () => {
    beeped.current.clear();
    lastElapsed.current = 0;
    lastIndex.current = 0;
    setFinished(null);
    setRun({ startedAt: Date.now(), pausedAt: null, pausedMs: 0 });
  };
  const pause = () => setRun((r) => (r && r.pausedAt == null ? { ...r, pausedAt: Date.now() } : r));
  const resume = () => setRun((r) => (r && r.pausedAt != null ? { ...r, pausedMs: r.pausedMs + Date.now() - r.pausedAt, pausedAt: null } : r));
  const endNow = () => {
    const result = intervalProgress(plan, elapsed);
    setFinished(result);
    onCompleteRef.current(result);
  };

  const isHard = seg?.kind === "hard";
  const totalS = pos.total;

  if (finished) {
    return (
      <div className={cx("flex flex-col items-center gap-2 py-8 text-center", className)}>
        <div className="text-[11px] uppercase tracking-[0.16em] text-paper-faint">Cardio</div>
        <div className="font-display text-[52px] leading-none text-paper">Done</div>
        <p className="text-[15px] tabular-nums text-paper-dim">
          {fmtClock(finished.minutes * 60)} total{finished.hardMinutes > 0 ? ` · ${finished.hardMinutes} min hard` : ""}
        </p>
      </div>
    );
  }

  return (
    <div className={cx("flex flex-col gap-5", className)}>
      <div className="flex items-baseline justify-between text-[11px] uppercase tracking-[0.14em] text-paper-faint">
        <span>{plan.kind === "intervals" && plan.intervals ? `Intervals · ${plan.intervals.count} × ${plan.intervals.hard_min} min` : "Easy cardio"}</span>
        <span className="tabular-nums">
          {fmtClock(Math.min(elapsed, totalS))} / {fmtClock(totalS)}
        </span>
      </div>

      <div className="flex flex-col items-center gap-1 py-2 text-center" aria-live="polite">
        <div className={cx("font-display text-[56px] leading-none", isHard ? "text-paper" : "text-paper-dim")}>{seg?.label ?? "Ready"}</div>
        <div className="font-mono text-[84px] font-semibold leading-none tabular-nums tracking-[-0.04em] text-paper" role="timer" aria-label={`${fmtClock(shownLeft)} left in ${seg?.label ?? "segment"}`}>
          {fmtClock(shownLeft)}
        </div>
        <div className="mt-2 min-h-5 text-[13px] text-paper-dim">{nextSeg ? `Next · ${nextSeg.label} · ${fmtClock(nextSeg.seconds)}` : run ? "Last segment" : ""}</div>
        {isHard && <p className="mt-1 max-w-[30ch] text-[12px] leading-snug text-paper-faint">{plan.hard_description}</p>}
      </div>

      <SegmentBar plan={plan} elapsed={elapsed} />

      <div className="flex gap-2">
        {!run && (
          <Button variant="primary" size="lg" block icon={<PlayIcon size={20} />} onClick={start}>
            Start
          </Button>
        )}
        {run && running && (
          <Button variant="secondary" size="lg" className="flex-1" icon={<PauseIcon size={20} />} onClick={pause}>
            Pause
          </Button>
        )}
        {run && !running && (
          <Button variant="primary" size="lg" className="flex-1" icon={<PlayIcon size={20} />} onClick={resume}>
            Resume
          </Button>
        )}
        {run && (
          <Button variant="ghost" size="lg" onClick={endNow}>
            End
          </Button>
        )}
      </div>
    </div>
  );
}

/** Segments drawn to scale: hard segments solid, easy ones hairline. */
function SegmentBar({ plan, elapsed }: { plan: CardioPlan; elapsed: number }) {
  let acc = 0;
  return (
    <div className="flex h-3 w-full gap-[2px]" aria-hidden>
      {plan.segments.map((s, i) => {
        const done = Math.max(0, Math.min(1, (elapsed - acc) / s.seconds));
        acc += s.seconds;
        return (
          <div key={i} className={cx("relative h-full overflow-hidden rounded-[1px]", s.kind === "hard" ? "bg-paper/25" : "bg-line")} style={{ flexGrow: s.seconds, flexBasis: 0 }}>
            <div className={cx("absolute inset-y-0 left-0", s.kind === "hard" ? "bg-paper" : "bg-paper-faint")} style={{ width: `${done * 100}%` }} />
          </div>
        );
      })}
    </div>
  );
}
