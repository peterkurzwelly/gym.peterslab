/** Hono app for everything under /api. */
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";
import pkg from "../package.json";
import { authenticate } from "./auth";
import type { AppEnv } from "./env";
import { IcsQuery, buildIcs } from "./ics";
import { SyncEnvelope, handleSync } from "./sync";
import { ImportEnvelope, ImportMode, buildExport, runImport } from "./transfer";

export const VERSION: string = pkg.version;
export const MAX_BODY_BYTES = 2 * 1024 * 1024;
/** A full backup outgrows 2 MB within a year of logging, and a replace import cannot be split up. */
export const MAX_IMPORT_BYTES = 16 * 1024 * 1024;

/**
 * Routes that skip auth (GET/HEAD only). /api/ics carries no stored data (it echoes its query into a calendar file)
 * and is opened with a plain navigation, which cannot add the sync key header. All of these stay rate limited.
 */
const PUBLIC_PATHS = new Set(["/api/health", "/api/auth/login", "/api/ics"]);

function issues(error: z.ZodError) {
  return error.issues.slice(0, 10).map((i) => ({ path: i.path.join("."), message: i.message }));
}

async function readJson(c: Context<AppEnv>): Promise<unknown> {
  const text = await c.req.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new HTTPException(400, { message: "invalid_json" });
  }
}

export const app = new Hono<AppEnv>().basePath("/api");

// Headers on every /api response, including errors.
app.use("*", async (c, next) => {
  await next();
  try {
    c.res.headers.set("Cache-Control", "no-store");
    c.res.headers.set("X-Content-Type-Options", "nosniff");
  } catch {
    // Immutable headers (should not happen for our own responses): copy the response.
    c.res = new Response(c.res.body, c.res);
    c.res.headers.set("Cache-Control", "no-store");
    c.res.headers.set("X-Content-Type-Options", "nosniff");
  }
});

// Rate limit per client IP. A limiter outage fails open; auth below still fails closed.
app.use("*", async (c, next) => {
  const limiter = c.env.RATE_LIMITER;
  if (limiter) {
    const key = c.req.header("CF-Connecting-IP") ?? "unknown";
    let success = true;
    try {
      ({ success } = await limiter.limit({ key }));
    } catch (err) {
      console.warn("rate limiter unavailable:", err instanceof Error ? err.message : err);
    }
    if (!success) return c.json({ error: "rate_limited" }, 429);
  }
  await next();
});

app.use("*", async (c, next) => {
  const method = c.req.method;
  if ((method === "GET" || method === "HEAD") && PUBLIC_PATHS.has(c.req.path)) return next();
  const result = await authenticate(c.req.raw, c.env);
  if (!result.ok) return c.json({ error: "unauthorized", reason: result.reason }, 401);
  c.set("auth", result.email ? { method: result.method, email: result.email } : { method: result.method });
  await next();
});

const tooLarge = (c: Context<AppEnv>) => c.json({ error: "payload_too_large" }, 413);
const defaultLimit = bodyLimit({ maxSize: MAX_BODY_BYTES, onError: tooLarge });
const importLimit = bodyLimit({ maxSize: MAX_IMPORT_BYTES, onError: tooLarge });
app.use("*", (c, next) => (c.req.path === "/api/import" ? importLimit : defaultLimit)(c, next));

app.get("/health", (c) => c.json({ ok: true, version: VERSION }));

app.get("/auth/check", (c) => c.json({ ok: true, ...c.get("auth") }));

// Navigating here (outside the service worker) lets Cloudflare Access renew an expired session.
app.get("/auth/login", (c) => c.redirect("/", 302));

app.post("/sync", async (c) => {
  const parsed = SyncEnvelope.safeParse(await readJson(c));
  if (!parsed.success) return c.json({ error: "invalid_request", issues: issues(parsed.error) }, 400);
  return c.json(await handleSync(c.env.DB, parsed.data));
});

app.get("/export", async (c) => {
  const file = await buildExport(c.env.DB);
  c.header("Content-Disposition", `attachment; filename=workout-os-export-${file.exported_at.slice(0, 10)}.json`);
  return c.json(file);
});

app.post("/import", async (c) => {
  const mode = ImportMode.safeParse(c.req.query("mode") ?? "merge");
  if (!mode.success) return c.json({ error: "invalid_request", issues: issues(mode.error) }, 400);
  const parsed = ImportEnvelope.safeParse(await readJson(c));
  if (!parsed.success) return c.json({ error: "invalid_request", issues: issues(parsed.error) }, 400);
  const result = await runImport(c.env.DB, parsed.data, mode.data);
  return c.json(result, result.ok ? 200 : 400);
});

app.get("/ics", async (c) => {
  const q = c.req.query();
  const parsed = IcsQuery.safeParse({
    title: q.title || undefined,
    start: q.start,
    minutes: q.minutes || undefined,
    notes: q.notes || undefined,
  });
  if (!parsed.success) return c.json({ error: "invalid_params", issues: issues(parsed.error) }, 400);
  const body = await buildIcs(parsed.data, new Date(), new URL("/", c.req.url).href);
  return c.body(body, 200, {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": "inline; filename=session.ics",
  });
});

app.notFound((c) => c.json({ error: "not_found" }, 404));

// Never leak stacks or messages from unexpected errors.
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    const status = err.status;
    return c.json({ error: status === 400 ? err.message || "bad_request" : "http_error" }, status);
  }
  console.error("api error:", err);
  return c.json({ error: "internal_error" }, 500);
});
