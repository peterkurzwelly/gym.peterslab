/**
 * Short beeps through Web Audio, plus vibration where it exists.
 * iOS only lets audio start inside a user gesture, so `installAudioUnlock` creates and resumes the
 * AudioContext on the first tap. After that, timers can beep on their own.
 */

type Ctx = AudioContext;
let ctx: Ctx | null = null;
let enabled = true;
let installed = false;

function getCtor(): (new () => Ctx) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: new () => Ctx; webkitAudioContext?: new () => Ctx };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Create or resume the context. Safe to call often; must run inside a gesture the first time on iOS. */
export function unlockAudio(): void {
  const Ctor = getCtor();
  if (!Ctor) return;
  try {
    if (!ctx) ctx = new Ctor();
    if (ctx.state === "suspended") void ctx.resume();
    // A silent one sample buffer fully unlocks output on older iOS.
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch {
    // Audio is a nicety. Never break the UI over it.
  }
}

/** Unlock audio on the first pointer or key gesture. Idempotent. Returns a cleanup. */
export function installAudioUnlock(target: Window | undefined = typeof window === "undefined" ? undefined : window): () => void {
  if (!target || installed) return () => {};
  installed = true;
  const events = ["pointerdown", "touchend", "keydown"] as const;
  const handler = () => {
    unlockAudio();
    if (ctx && ctx.state === "running") remove();
  };
  const remove = () => {
    events.forEach((e) => target.removeEventListener(e, handler, true));
    installed = false;
  };
  events.forEach((e) => target.addEventListener(e, handler, true));
  return remove;
}

/** Global mute, mirrors settings.sound. */
export function setSoundEnabled(on: boolean): void {
  enabled = on;
}

export interface BeepOptions {
  freq?: number;
  ms?: number;
  volume?: number;
}

/** One sine beep with a short attack and release so it does not click. */
export function beep({ freq = 880, ms = 140, volume = 0.3 }: BeepOptions = {}): void {
  if (!enabled || !ctx) return;
  try {
    if (ctx.state === "suspended") void ctx.resume();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.01);
    gain.gain.setValueAtTime(volume, t + ms / 1000 - 0.03);
    gain.gain.linearRampToValueAtTime(0, t + ms / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + ms / 1000 + 0.02);
  } catch {
    /* ignore */
  }
}

/** Countdown tick (3, 2, 1). */
export const beepShort = () => beep({ freq: 880, ms: 120 });
/** Segment change or rest over. */
export const beepLong = () => beep({ freq: 1320, ms: 600, volume: 0.35 });

/** Vibrate where supported (Android). iPhone Safari has no vibration API, so this is a no-op there. */
export function vibrate(pattern: number | number[] = [200, 100, 200]): void {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    try {
      navigator.vibrate(pattern);
    } catch {
      /* ignore */
    }
  }
}
