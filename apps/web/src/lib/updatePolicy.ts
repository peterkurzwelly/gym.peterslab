/**
 * When the page may reload onto a new service worker version, and when it may look for one.
 * index.html wires this to virtual:pwa-register; the rules live here so they are testable.
 *
 * Rules: reload only at an app open, before the first tap, and never while a session is open
 * (strength or cardio). An app open is a cold start, or a return after the app was hidden longer than
 * a rest period. A version found mid-session waits for the next app open after the session.
 */

/** Hidden at least this long, then shown again: that is an app open. Well beyond a long rest. */
export const OPEN_AFTER_HIDDEN_MS = 20 * 60_000;
/** Look for a new version at most this often, and only at an app open. */
export const CHECK_EVERY_MS = 5 * 60_000;

// ---------- "a session is open" flag (sessionStorage, written by Today) ----------

const SESSION_OPEN_KEY = "gym.session-open";

function store(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Today marks the running session here (strength or cardio); null when none is open. */
export function markSessionOpen(sessionId: string | null): void {
  try {
    if (sessionId) store()?.setItem(SESSION_OPEN_KEY, sessionId);
    else store()?.removeItem(SESSION_OPEN_KEY);
  } catch {
    /* storage is a nicety */
  }
}

export function isSessionOpen(): boolean {
  try {
    return !!store()?.getItem(SESSION_OPEN_KEY);
  } catch {
    return false;
  }
}

// ---------- the policy ----------

export interface UpdatePolicyDeps {
  reload: () => void;
  /** Ask the service worker registration to look for a new version. */
  update: () => void;
  now?: () => number;
  sessionOpen?: () => boolean;
  online?: () => boolean;
}

export interface UpdatePolicy {
  /** A tap or key press: Peter is using the app. */
  touch(): void;
  /** A new version is active (onNeedReload). */
  needReload(): void;
  hidden(): void;
  visible(): void;
  readonly pendingReload: boolean;
}

export function createUpdatePolicy(deps: UpdatePolicyDeps): UpdatePolicy {
  const now = deps.now ?? (() => Date.now());
  const sessionOpen = deps.sessionOpen ?? isSessionOpen;
  const online = deps.online ?? (() => typeof navigator === "undefined" || navigator.onLine !== false);
  let touched = false;
  let pending = false;
  let hiddenAt = 0;
  let lastCheck = now();

  return {
    touch() {
      touched = true;
    },
    needReload() {
      if (!touched && !sessionOpen()) deps.reload();
      else pending = true;
    },
    hidden() {
      hiddenAt = now();
    },
    visible() {
      if (!hiddenAt || now() - hiddenAt < OPEN_AFTER_HIDDEN_MS) return;
      hiddenAt = 0;
      // Back to a running session (rest, music app, locked phone): no reload, no update check.
      if (sessionOpen()) return;
      touched = false;
      if (pending) {
        pending = false;
        deps.reload();
        return;
      }
      if (now() - lastCheck > CHECK_EVERY_MS && online()) {
        lastCheck = now();
        deps.update();
      }
    },
    get pendingReload() {
      return pending;
    },
  };
}
