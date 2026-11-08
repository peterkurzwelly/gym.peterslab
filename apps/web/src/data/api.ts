/**
 * Thin fetch wrapper for /api: same-origin credentials (Cloudflare Access cookie), manual redirects
 * (an expired Access session answers with a redirect to its login page), optional sync key.
 */
import { db, getMeta, type WorkoutDb } from "./db";

export type ApiFailure = "auth_required" | "offline" | "error";

export class ApiError extends Error {
  constructor(
    readonly kind: ApiFailure,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiOptions {
  fetch?: typeof fetch;
  database?: WorkoutDb;
  /** Only used for small bodies while the page is being hidden. */
  keepalive?: boolean;
  signal?: AbortSignal;
}

// keepalive requests are capped at 64 KiB by browsers; leave headroom.
const KEEPALIVE_MAX_BYTES = 60_000;

/** Calls an /api route and returns parsed JSON, or throws ApiError with a kind the UI can show. */
export async function apiJson(
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
  opts: ApiOptions = {},
): Promise<unknown> {
  const doFetch = opts.fetch ?? globalThis.fetch?.bind(globalThis);
  if (!doFetch) throw new ApiError("offline", "No network available");

  const headers: Record<string, string> = { Accept: "application/json" };
  const syncKey = await getMeta<string>("sync_key", opts.database ?? db);
  if (syncKey) headers.Authorization = `Bearer ${syncKey}`;

  let body: string | undefined;
  if (init.body !== undefined) {
    body = JSON.stringify(init.body);
    headers["Content-Type"] = "application/json";
  }
  const keepalive = !!opts.keepalive && (body?.length ?? 0) < KEEPALIVE_MAX_BYTES;

  let res: Response;
  try {
    res = await doFetch(path, {
      method: init.method ?? "GET",
      headers,
      body,
      credentials: "same-origin",
      redirect: "manual",
      keepalive,
      signal: opts.signal,
    });
  } catch {
    throw new ApiError("offline", "Offline");
  }

  if (res.status === 401 || res.status === 403) {
    throw new ApiError("auth_required", syncKey ? "Sync key not accepted" : "Add your sync key in Settings", res.status);
  }
  // Redirect (Cloudflare Access login) or opaque redirect from redirect: "manual".
  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
    throw new ApiError("auth_required", "Sign in again to sync", res.status || null);
  }
  if (!res.ok) {
    throw new ApiError("error", `Server answered ${res.status}`, res.status);
  }
  try {
    return await res.json();
  } catch {
    throw new ApiError("error", "Unexpected response from server", res.status);
  }
}
