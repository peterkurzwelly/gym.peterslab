import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig(async () => {
  const migrations = await readD1Migrations(here("./migrations"));
  return {
    plugins: [
      cloudflareTest({
        main: "./src/index.ts",
        // Bindings are declared here instead of reusing wrangler.jsonc, so tests do not need a built PWA.
        // ASSETS and the auth vars are passed per request by test/helpers.ts.
        miniflare: {
          compatibilityDate: "2026-08-01",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: ["DB"],
          ratelimits: { RATE_LIMITER: { namespace_id: "1701", simple: { limit: 10_000, period: 60 } } },
          bindings: { ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "", TEST_MIGRATIONS: migrations },
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts"],
      setupFiles: ["./test/setup.ts"],
    },
  };
});
