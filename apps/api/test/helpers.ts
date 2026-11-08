import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { SYNC_TABLES, type SyncResponse } from "@gym/schema";
import worker, { type Env } from "../src/index";

export const BASE = "https://gym.test";
export const TOKEN = "test-sync-token-0123456789abcdef";

const fakeAssets = {
  fetch: async (input: RequestInfo | URL) =>
    new Response(`asset ${new URL(input instanceof Request ? input.url : String(input)).pathname}`),
} as unknown as Fetcher;

/** Bindings for one request. Defaults: dev auth on, no limiter (tests that need one pass it). */
export function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: env.DB,
    ASSETS: fakeAssets,
    ACCESS_TEAM_DOMAIN: "",
    ACCESS_AUD: "",
    DEV_ALLOW_ALL: "true",
    ...overrides,
  };
}

export async function call(path: string, init: RequestInit = {}, overrides: Partial<Env> = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(BASE + path, init), makeEnv(overrides), ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

export function post(path: string, body: unknown, overrides: Partial<Env> = {}, headers: Record<string, string> = {}) {
  return call(
    path,
    { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) },
    overrides,
  );
}

export async function sync(body: Record<string, unknown>, overrides: Partial<Env> = {}): Promise<SyncResponse> {
  const res = await post("/api/sync", { client_id: "test", cursor: 0, changes: {}, ...body }, overrides);
  if (res.status !== 200) throw new Error(`sync ${res.status}: ${await res.text()}`);
  return (await res.json()) as SyncResponse;
}

/** Empties every table and resets the global rev. */
export async function resetDb(): Promise<void> {
  await env.DB.batch([
    ...SYNC_TABLES.map((t) => env.DB.prepare(`DELETE FROM "${t}"`)),
    env.DB.prepare(`UPDATE sync_meta SET value = 0 WHERE key = 'rev'`),
  ]);
}
