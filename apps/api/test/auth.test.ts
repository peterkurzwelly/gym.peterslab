import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey } from "jose";
import { env } from "cloudflare:workers";
import { normalizeTeamDomain, safeEqual } from "../src/auth";
import * as entry from "../src/index";
import { BASE, TOKEN, call, post, resetDb } from "./helpers";

const syncBody = { client_id: "t", cursor: 0, changes: {} };
const noAuth = { DEV_ALLOW_ALL: undefined };

beforeEach(resetDb);

describe("auth matrix", () => {
  it("nothing configured: /api/sync is 401 auth_not_configured", async () => {
    const res = await post("/api/sync", syncBody, noAuth);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized", reason: "auth_not_configured" });
  });

  it("nothing configured: GET /api/health stays public", async () => {
    const res = await call("/api/health", {}, noAuth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; version: string };
    expect(body.ok).toBe(true);
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("nothing configured: every other route is closed", async () => {
    for (const path of ["/api/auth/check", "/api/export", "/api/nope"]) {
      expect((await call(path, {}, noAuth)).status, path).toBe(401);
    }
    expect((await post("/api/import?mode=merge", {}, noAuth)).status).toBe(401);
    expect((await post("/api/ics?start=2026-11-10T17:00:00Z", {}, noAuth)).status).toBe(401); // only GET/HEAD are public
  });

  it("GET /api/ics is public: a plain navigation cannot send the sync key, and the file holds no stored data", async () => {
    const path = "/api/ics?title=Session%20B&start=2026-11-10T17:00:00Z&minutes=30";
    for (const overrides of [noAuth, { ...noAuth, SYNC_TOKEN: TOKEN }]) {
      const res = await call(path, {}, overrides);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/calendar; charset=utf-8");
      expect(await res.text()).toContain("SUMMARY:Session B");
    }
    expect((await call(path, { method: "HEAD" }, noAuth)).status).toBe(200);
    // Bad params are still a 400, not a leak of anything else.
    expect((await call("/api/ics?start=nope", {}, noAuth)).status).toBe(400);
  });

  it("GET /api/ics stays rate limited", async () => {
    const limiter = { limit: async () => ({ success: false }) } as unknown as RateLimit;
    const res = await call("/api/ics?start=2026-11-10T17:00:00Z", { headers: { "CF-Connecting-IP": "203.0.113.9" } }, { ...noAuth, RATE_LIMITER: limiter });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
  });

  it("token configured, no credentials: 401 missing_credentials", async () => {
    const res = await post("/api/sync", syncBody, { ...noAuth, SYNC_TOKEN: TOKEN });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ reason: "missing_credentials" });
  });

  it("valid bearer token passes", async () => {
    const res = await post("/api/sync", syncBody, { ...noAuth, SYNC_TOKEN: TOKEN }, { Authorization: `Bearer ${TOKEN}` });
    expect(res.status).toBe(200);
    const check = await call("/api/auth/check", { headers: { Authorization: `bearer ${TOKEN}` } }, { ...noAuth, SYNC_TOKEN: TOKEN });
    expect(await check.json()).toEqual({ ok: true, method: "token" });
  });

  it("wrong bearer token: 401 invalid_credentials", async () => {
    for (const bad of [`${TOKEN}x`, TOKEN.slice(0, -1), "nope", `Basic ${TOKEN}`]) {
      const header = bad.startsWith("Basic") ? bad : `Bearer ${bad}`;
      const res = await post("/api/sync", syncBody, { ...noAuth, SYNC_TOKEN: TOKEN }, { Authorization: header });
      expect(res.status, bad).toBe(401);
      expect(await res.json()).toMatchObject({ reason: "invalid_credentials" });
    }
  });

  it("a too short SYNC_TOKEN counts as not configured", async () => {
    const res = await post("/api/sync", syncBody, { ...noAuth, SYNC_TOKEN: "short" }, { Authorization: "Bearer short" });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ reason: "auth_not_configured" });
  });

  it('DEV_ALLOW_ALL only opens on exactly "true"', async () => {
    const ok = await call("/api/auth/check", {}, { DEV_ALLOW_ALL: "true" });
    expect(await ok.json()).toEqual({ ok: true, method: "dev" });
    for (const v of ["TRUE", "1", "yes", ""]) {
      expect((await call("/api/auth/check", {}, { DEV_ALLOW_ALL: v })).status, v).toBe(401);
    }
  });

  it("GET /api/auth/login redirects to / without auth", async () => {
    const res = await call("/api/auth/login", { redirect: "manual" }, noAuth);
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("Location")!, BASE).pathname).toBe("/");
  });

  it("safeEqual compares exactly", async () => {
    expect(await safeEqual("abc", "abc")).toBe(true);
    expect(await safeEqual("abc", "abd")).toBe(false);
    expect(await safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("normalizeTeamDomain", () => {
  it.each([
    ["peterslab.cloudflareaccess.com", "peterslab.cloudflareaccess.com"],
    ["https://PetersLab.cloudflareaccess.com/", "peterslab.cloudflareaccess.com"],
    ["https://peterslab.cloudflareaccess.com/cdn-cgi/access/certs", "peterslab.cloudflareaccess.com"],
    ["peterslab.cloudflareaccess.com/", "peterslab.cloudflareaccess.com"],
    ["peterslab", "peterslab.cloudflareaccess.com"],
    ["  ", null],
    [undefined, null],
    ["bad host!", null],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeTeamDomain(input)).toBe(expected);
  });
});

describe("Cloudflare Access JWT", () => {
  const TEAM = "peterslab.cloudflareaccess.com";
  const AUD = "0123456789abcdef-aud";
  const access = { ...noAuth, ACCESS_TEAM_DOMAIN: `https://${TEAM}/`, ACCESS_AUD: AUD };
  let privateKey: CryptoKey;
  let otherKey: CryptoKey;
  let certsUp = true;
  const fetchSpy = vi.spyOn(globalThis, "fetch");

  beforeAll(async () => {
    const pair = await generateKeyPair("RS256", { extractable: true });
    privateKey = pair.privateKey;
    otherKey = (await generateKeyPair("RS256")).privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
    fetchSpy.mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === `https://${TEAM}/cdn-cgi/access/certs` && certsUp) return Response.json({ keys: [jwk] });
      return new Response("unavailable", { status: 503 });
    });
  });
  afterAll(() => fetchSpy.mockRestore());

  function sign(opts: { key?: CryptoKey; aud?: string; iss?: string; exp?: string | number; email?: string } = {}) {
    return new SignJWT({ email: opts.email ?? "peter@example.com", type: "app" })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(opts.iss ?? `https://${TEAM}`)
      .setAudience(opts.aud ?? AUD)
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? "1h")
      .sign(opts.key ?? privateKey);
  }

  it("valid header token passes and reports the email", async () => {
    const res = await call("/api/auth/check", { headers: { "Cf-Access-Jwt-Assertion": await sign() } }, access);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, method: "access", email: "peter@example.com" });
  });

  it("valid CF_Authorization cookie passes", async () => {
    const cookie = `other=1; CF_Authorization=${await sign()}; x=y`;
    const res = await post("/api/sync", syncBody, access, { Cookie: cookie });
    expect(res.status).toBe(200);
  });

  it("bare team name config works too", async () => {
    const res = await call(
      "/api/auth/check",
      { headers: { "Cf-Access-Jwt-Assertion": await sign() } },
      { ...access, ACCESS_TEAM_DOMAIN: "peterslab" },
    );
    expect(res.status).toBe(200);
  });

  it.each([
    ["wrong audience", { aud: "someone-else" }],
    ["wrong issuer", { iss: "https://evil.cloudflareaccess.com" }],
    ["expired", { exp: Math.floor(Date.now() / 1000) - 3600 }],
  ])("%s: 401 invalid_credentials", async (_name, opts) => {
    const res = await call("/api/auth/check", { headers: { "Cf-Access-Jwt-Assertion": await sign(opts) } }, access);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ reason: "invalid_credentials" });
  });

  it("signed by another key: 401", async () => {
    const res = await call("/api/auth/check", { headers: { "Cf-Access-Jwt-Assertion": await sign({ key: otherKey }) } }, access);
    expect(res.status).toBe(401);
  });

  it("garbage token: 401", async () => {
    const res = await call("/api/auth/check", { headers: { "Cf-Access-Jwt-Assertion": "not.a.jwt" } }, access);
    expect(res.status).toBe(401);
  });

  it("access configured, no credentials: 401 missing_credentials", async () => {
    const res = await call("/api/auth/check", {}, access);
    expect(await res.json()).toMatchObject({ reason: "missing_credentials" });
  });

  it("only ACCESS_AUD without team domain is not configured", async () => {
    const res = await call("/api/auth/check", { headers: { "Cf-Access-Jwt-Assertion": await sign() } }, { ...noAuth, ACCESS_AUD: AUD });
    expect(await res.json()).toMatchObject({ reason: "auth_not_configured" });
  });

  it("certs endpoint down fails closed (new team host, nothing cached)", async () => {
    certsUp = false;
    try {
      const res = await call(
        "/api/auth/check",
        { headers: { "Cf-Access-Jwt-Assertion": await sign() } },
        { ...access, ACCESS_TEAM_DOMAIN: "otherteam.cloudflareaccess.com" },
      );
      expect(res.status).toBe(401);
    } finally {
      certsUp = true;
    }
  });

  it("token fallback still works when Access is configured", async () => {
    const res = await call(
      "/api/auth/check",
      { headers: { Authorization: `Bearer ${TOKEN}` } },
      { ...access, SYNC_TOKEN: TOKEN },
    );
    expect(await res.json()).toEqual({ ok: true, method: "token" });
  });
});

describe("middleware", () => {
  it("sets no-store and nosniff on success, 401 and 404", async () => {
    for (const [path, overrides, status] of [
      ["/api/health", noAuth, 200],
      ["/api/export", noAuth, 401],
      ["/api/nope", {}, 404],
    ] as const) {
      const res = await call(path, {}, overrides);
      expect(res.status, path).toBe(status);
      expect(res.headers.get("Cache-Control"), path).toBe("no-store");
      expect(res.headers.get("X-Content-Type-Options"), path).toBe("nosniff");
    }
  });

  it("unknown /api route returns JSON 404", async () => {
    const res = await call("/api/nope");
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("rate limits by CF-Connecting-IP with a JSON 429", async () => {
    const keys: string[] = [];
    const limiter = {
      limit: async ({ key }: { key: string }) => {
        keys.push(key);
        return { success: false };
      },
    } as RateLimit;
    const res = await call("/api/health", { headers: { "CF-Connecting-IP": "203.0.113.7" } }, { RATE_LIMITER: limiter });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(keys).toEqual(["203.0.113.7"]);
  });

  it("works with the real rate limit binding", async () => {
    const res = await call("/api/health", { headers: { "CF-Connecting-IP": "203.0.113.8" } }, { RATE_LIMITER: env.RATE_LIMITER });
    expect(res.status).toBe(200);
  });

  it("a broken limiter fails open (auth still applies)", async () => {
    const limiter = { limit: async () => { throw new Error("down"); } } as unknown as RateLimit;
    expect((await call("/api/health", {}, { RATE_LIMITER: limiter })).status).toBe(200);
    expect((await call("/api/export", {}, { ...noAuth, RATE_LIMITER: limiter })).status).toBe(401);
  });

  it("caps bodies at 2 MB with 413 (content-length)", async () => {
    const big = "x".repeat(2 * 1024 * 1024 + 1);
    const res = await call("/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: big });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "payload_too_large" });
  });

  it("caps streamed bodies without content-length", async () => {
    const chunk = new Uint8Array(512 * 1024).fill(120);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 5) return controller.close();
        sent++;
        controller.enqueue(chunk);
      },
    });
    const res = await call("/api/sync", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    expect(res.status).toBe(413);
  });

  it("malformed JSON is a 400", async () => {
    const res = await call("/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: "{nope" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
  });

  it("unexpected errors are a bare 500 without details", async () => {
    const brokenDb = {
      prepare() {
        throw new Error("SECRET internal detail");
      },
      batch() {
        throw new Error("SECRET internal detail");
      },
    } as unknown as D1Database;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post("/api/sync", { ...syncBody, changes: { training_week: [] } }, { DB: brokenDb });
    errors.mockRestore();
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "internal_error" });
    expect(text).not.toContain("SECRET");
  });

  it("the Worker entry has only a default export (workerd treats named exports as entrypoints)", () => {
    expect(Object.keys(entry)).toEqual(["default"]);
  });

  it("non /api paths fall through to static assets", async () => {
    // File-like paths only reach the Worker when the file is missing: see fallthrough.test.ts.
    for (const path of ["/", "/plan", "/apix"]) {
      const res = await call(path, {}, noAuth);
      expect(await res.text(), path).toBe(`asset ${path}`);
    }
  });
});
