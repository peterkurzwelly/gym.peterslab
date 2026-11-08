/**
 * The end of a rest, wherever Peter is in the app. The dock's RestTimer only exists on Today, so this
 * watcher (mounted once, in App) beeps and flashes on Plan, Progress or Settings too, and a small chip in
 * the header shows the rest left and leads back to Today.
 */
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { fmtClock } from "../../lib/format";
import { secondsLeft, useNow } from "../../lib/timers";
import { endRest, useAnyRest } from "./rest";

/** Fires endRest at the end of the running rest. Renders nothing. */
export function RestWatcher({ sound = true }: { sound?: boolean }) {
  const rest = useAnyRest();
  const endsAt = rest?.endsAt ?? null;
  useEffect(() => {
    if (endsAt == null) return;
    let timer: number | undefined;
    // Short hops instead of one long timeout: background throttling can stretch a long one.
    const check = () => {
      const left = endsAt - Date.now();
      if (left > 0) timer = window.setTimeout(check, Math.min(left, 1000));
      else endRest(sound);
    };
    check();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      window.clearTimeout(timer);
      check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [endsAt, sound]);
  return null;
}

/** "Rest 1:23" in the header on the other tabs. Tap: back to Today. */
export function RestChip() {
  const rest = useAnyRest();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const show = !!rest && pathname !== "/";
  const now = useNow(show, 500);
  if (!rest || !show) return null;
  const left = fmtClock(secondsLeft(rest.endsAt, now));
  return (
    <button
      type="button"
      onClick={() => navigate("/")}
      aria-label={`Rest, ${left} left. Back to Today`}
      className="gym-press mr-1 flex h-11 shrink-0 items-center gap-1.5 rounded-[3px] px-2 font-mono text-[12px] uppercase tracking-[0.1em] text-paper active:bg-ink-3"
    >
      <span className="text-paper-faint">Rest</span>
      <span className="tabular-nums">{left}</span>
    </button>
  );
}
