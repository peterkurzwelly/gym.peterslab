/**
 * Timestamp based timing. Timers store absolute times (endsAt, startedAt) and derive what they show
 * from Date.now(), so they are right after iOS suspends a backgrounded home screen app.
 */
import { useEffect, useState } from "react";

/** Current time in ms, re-rendered every `intervalMs` while `active`, and on return to the foreground. */
export function useNow(active = true, intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, intervalMs]);
  return now;
}

/** Whole seconds left until `endsAt` (ms), rounded up so "0:01" shows until the very end. */
export function secondsLeft(endsAt: number, now: number): number {
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

/** Accept ms epoch or ISO string. */
export function toMs(t: number | string): number {
  return typeof t === "number" ? t : Date.parse(t);
}

export interface SegmentLike {
  seconds: number;
}

export interface SegmentPosition {
  index: number; // -1 before start, segments.length when finished
  elapsedInSegment: number; // seconds
  remainingInSegment: number; // seconds
  total: number; // total seconds of all segments
  done: boolean;
}

/** Where `elapsed` seconds fall in a list of segments. */
export function segmentAt(segments: readonly SegmentLike[], elapsed: number): SegmentPosition {
  const total = segments.reduce((s, x) => s + x.seconds, 0);
  let acc = 0;
  for (let i = 0; i < segments.length; i++) {
    const len = segments[i]!.seconds;
    if (elapsed < acc + len) {
      return { index: i, elapsedInSegment: elapsed - acc, remainingInSegment: acc + len - elapsed, total, done: false };
    }
    acc += len;
  }
  return { index: segments.length, elapsedInSegment: 0, remainingInSegment: 0, total, done: true };
}
