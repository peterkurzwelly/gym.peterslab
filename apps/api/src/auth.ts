/**
 * /api auth. Fails closed: a request passes only with
 *   (a) a valid Cloudflare Access JWT (Cf-Access-Jwt-Assertion header or CF_Authorization cookie),
 *   (b) Authorization: Bearer <SYNC_TOKEN>, or
 *   (c) DEV_ALLOW_ALL === "true" (local .dev.vars only).
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { AuthInfo, Env } from "./env";

export type AuthFailReason = "auth_not_configured" | "missing_credentials" | "invalid_credentials";
export type AuthResult = ({ ok: true } & AuthInfo) | { ok: false; reason: AuthFailReason };

/** Shorter sync tokens are treated as not configured. */
export const MIN_TOKEN_LENGTH = 16;

/**
 * Accepts "team.cloudflareaccess.com", "https://team.cloudflareaccess.com/" or just "team".
 * Returns the bare lowercase host, or null when empty or malformed.
 */
export function normalizeTeamDomain(raw: string | undefined): string | null {
  let s = (raw ?? "").trim();
  if (!s) return null;
  if (s.includes("://")) {
    try {
      s = new URL(s).host;
    } catch {
      return null;
    }
  }
  s = s.split("/")[0]!.toLowerCase().replace(/\.+$/, "");
  if (!/^[a-z0-9.-]+$/.test(s)) return null;
  return s.includes(".") ? s : `${s}.cloudflareaccess.com`;
}

function audiences(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
}

// One JWKS fetcher per team host, kept for the isolate's lifetime (jose caches keys inside it).
const jwksByHost = new Map<string, JWTVerifyGetKey>();
function jwksFor(host: string): JWTVerifyGetKey {
  let jwks = jwksByHost.get(host);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${host}/cdn-cgi/access/certs`));
    jwksByHost.set(host, jwks);
  }
  return jwks;
}

async function verifyAccessJwt(token: string, host: string, aud: string[]): Promise<{ email?: string } | null> {
  try {
    const { payload } = await jwtVerify(token, jwksFor(host), {
      issuer: `https://${host}`,
      audience: aud,
      algorithms: ["RS256"],
    });
    return typeof payload.email === "string" ? { email: payload.email } : {};
  } catch (err) {
    // Bad signature, wrong aud/iss, expired, or the certs endpoint is unreachable: all fail closed.
    console.warn("access jwt rejected:", err instanceof Error ? err.name : "unknown");
    return null;
  }
}

/** Constant-time compare on SHA-256 digests, so length differences do not leak either. */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(da);
  const y = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

function cookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim() || null;
  }
  return null;
}

export async function authenticate(req: Request, env: Env): Promise<AuthResult> {
  const host = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN);
  const aud = audiences(env.ACCESS_AUD);
  const accessConfigured = host !== null && aud.length > 0;
  const token = env.SYNC_TOKEN ?? "";
  const tokenConfigured = token.length >= MIN_TOKEN_LENGTH;
  const dev = env.DEV_ALLOW_ALL === "true";

  const jwt = req.headers.get("Cf-Access-Jwt-Assertion") || cookie(req.headers.get("Cookie"), "CF_Authorization");
  const authorization = req.headers.get("Authorization");
  const bearer = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? "")?.[1] ?? null;

  if (accessConfigured && jwt) {
    const ok = await verifyAccessJwt(jwt, host, aud);
    if (ok) return { ok: true, method: "access", ...ok };
  }
  if (tokenConfigured && bearer && (await safeEqual(bearer, token))) return { ok: true, method: "token" };
  if (dev) return { ok: true, method: "dev" };

  if (!accessConfigured && !tokenConfigured) return { ok: false, reason: "auth_not_configured" };
  if (!jwt && !authorization) return { ok: false, reason: "missing_credentials" };
  return { ok: false, reason: "invalid_credentials" };
}
