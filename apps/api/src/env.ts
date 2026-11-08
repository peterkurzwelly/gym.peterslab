/** Worker bindings. Names match wrangler.jsonc. */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Optional so local tooling without the binding still works. */
  RATE_LIMITER?: RateLimit;
  /** Cloudflare Access team domain, bare host ("team.cloudflareaccess.com"), URL or team name. */
  ACCESS_TEAM_DOMAIN?: string;
  /** Access application audience tag (comma separated list allowed). */
  ACCESS_AUD?: string;
  /** Worker secret. Bearer token fallback for when Access is not in the way. */
  SYNC_TOKEN?: string;
  /** "true" only in local .dev.vars. Never set in wrangler.jsonc. */
  DEV_ALLOW_ALL?: string;
}

export type AuthInfo = { method: "access" | "token" | "dev"; email?: string };

export type AppEnv = { Bindings: Env; Variables: { auth: AuthInfo } };
