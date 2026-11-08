import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Idempotent: applyD1Migrations records what it applied.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
