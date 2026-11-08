/**
 * Settings helpers: plain text for sync states, the sync key test, small formatters and file saving.
 * No engine numbers here; this is wording and plumbing only.
 */
import type { SyncStatus } from "../../data";
import { getMeta } from "../../data/db";

// ---------- sync wording ----------

/** The sync state in plain words. Calm: data is always safe on the phone. */
export function syncStateText(status: SyncStatus): string {
  switch (status.state) {
    case "syncing":
      return "Syncing now";
    case "offline":
      return "Offline. Changes wait on this phone";
    case "auth_required":
      return status.lastError === "Sign in again to sync" ? "Cloudflare Access wants a fresh sign in" : "Needs the sync key";
    case "error":
      return "Server busy. It retries on its own";
    default:
      return status.lastSyncAt ? "Up to date" : "Not synced yet";
  }
}

export function pendingText(pending: number): string {
  if (pending <= 0) return "Nothing waiting";
  return `${pending} ${pending === 1 ? "change" : "changes"} waiting`;
}

/** "just now", "4 min ago", "2 h ago", "yesterday 18:04", "3 Nov 18:04". */
export function fmtAgo(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "never";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  const d = new Date(t);
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (h < 12) return `${h} h ago`;
  const today = new Date(now);
  const yesterday = new Date(now - 86_400_000);
  if (d.toDateString() === today.toDateString()) return `today ${hhmm}`;
  if (d.toDateString() === yesterday.toDateString()) return `yesterday ${hhmm}`;
  const month = d.toLocaleString("en-GB", { month: "short" });
  return `${d.getDate()} ${month} ${hhmm}`;
}

/** 1536 → "1.5 KB", 2_400_000 → "2.3 MB". */
export function fmtBytes(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "unknown";
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`;
}

/** 19 → "19:00". */
export const fmtHour = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** 0.6 → "60%". */
export const fmtPct = (p: number) => `${Math.round(p * 100)}%`;

// ---------- sync key test ----------

export type KeyTestOutcome = "ok" | "dev" | "access" | "rejected" | "missing" | "not_configured" | "signin" | "offline" | "error";

export interface KeyTestResult {
  outcome: KeyTestOutcome;
  /** true when sync will work with this key. */
  ok: boolean;
  text: string;
}

const TEXT: Record<KeyTestOutcome, string> = {
  ok: "Key accepted. Sync is on.",
  access: "Signed in through Cloudflare Access. Sync is on.",
  dev: "Local dev server. It accepts every request.",
  rejected: "The server does not know this key. Check for a missing character.",
  missing: "No key yet. Paste it above.",
  not_configured: "The server has no sync key set yet.",
  signin: "Cloudflare Access wants a fresh sign in.",
  offline: "No connection right now. Try again when online.",
  error: "The server did not answer properly. Try again later.",
};

const result = (outcome: KeyTestOutcome, text = TEXT[outcome]): KeyTestResult => ({
  outcome,
  ok: outcome === "ok" || outcome === "dev" || outcome === "access",
  text,
});

/**
 * GET /api/auth/check with the typed key, or the key stored on this device when none is typed.
 * Never throws.
 */
export async function testSyncKey(typed: string | null, fetchFn: typeof fetch = globalThis.fetch?.bind(globalThis)): Promise<KeyTestResult> {
  let key = typed?.trim() || null;
  if (!key) {
    try {
      key = (await getMeta<string>("sync_key")) ?? null;
    } catch {
      key = null;
    }
  }
  const headers: Record<string, string> = { Accept: "application/json" };
  if (key) headers.Authorization = `Bearer ${key}`;

  let res: Response;
  try {
    res = await fetchFn("/api/auth/check", { method: "GET", headers, credentials: "same-origin", redirect: "manual", cache: "no-store" });
  } catch {
    return result("offline");
  }
  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) return result("signin");

  let body: { ok?: boolean; method?: string; reason?: string } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* empty or not JSON */
  }
  if (res.ok && body.ok) {
    if (body.method === "dev") return result("dev");
    if (body.method === "access") return result("access");
    return result("ok");
  }
  if (res.status === 401 || res.status === 403) {
    if (body.reason === "auth_not_configured") return result("not_configured");
    if (body.reason === "missing_credentials" || !key) return result("missing");
    return result("rejected");
  }
  if (res.status === 429) return result("error", "Too many tries. Wait a minute and test again.");
  return result("error", `The server answered ${res.status}. Try again later.`);
}

// ---------- files ----------

const isIos = () =>
  typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

/** Saves JSON as a file: the share sheet on iPhone ("Save to Files"), a download elsewhere. */
export async function saveJsonFile(name: string, data: unknown): Promise<"shared" | "downloaded" | "cancelled"> {
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
  if (isIos() && typeof File !== "undefined" && navigator.share && navigator.canShare) {
    const file = new File([blob], name, { type: "application/json" });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return "shared";
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return "cancelled";
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}

/** Total rows in an export, soft deleted ones included. */
export function exportRowCount(file: { tables: Record<string, unknown[] | undefined> }): number {
  return Object.values(file.tables).reduce((n, rows) => n + (rows?.length ?? 0), 0);
}
