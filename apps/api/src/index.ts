/**
 * Worker entry for gym.peterslab.app: Hono API under /api, everything else is the PWA (static assets).
 * wrangler.jsonc routes only /api/* here (run_worker_first); the ASSETS fallthrough is a safety net.
 * Only the default export lives here: workerd treats every named export of the main module as an entrypoint.
 */
import { app } from "./app";
import type { Env } from "./env";

export type { Env } from "./env";

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    if (isApiPath(new URL(request.url).pathname)) return app.fetch(request, env, ctx);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
