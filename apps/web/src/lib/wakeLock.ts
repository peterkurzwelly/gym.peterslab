/**
 * Screen Wake Lock for the interval timer. iOS Safari 16.4+ supports it in home screen apps.
 * The lock is dropped whenever the page is hidden, so we re-acquire on visibilitychange.
 */
import { useEffect } from "react";

interface Sentinel {
  release(): Promise<void>;
  released?: boolean;
}

export function wakeLockSupported(): boolean {
  return typeof navigator !== "undefined" && "wakeLock" in navigator;
}

export async function requestWakeLock(): Promise<Sentinel | null> {
  if (!wakeLockSupported()) return null;
  try {
    const nav = navigator as unknown as { wakeLock: { request(type: "screen"): Promise<Sentinel> } };
    return await nav.wakeLock.request("screen");
  } catch {
    return null; // denied, low battery, or page hidden
  }
}

/** Hold the screen awake while `active` is true. */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !wakeLockSupported()) return;
    let sentinel: Sentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (document.visibilityState !== "visible") return;
      if (sentinel && !sentinel.released) return;
      const s = await requestWakeLock();
      if (cancelled) void s?.release();
      else sentinel = s;
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [active]);
}
