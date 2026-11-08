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

/**
 * Existing files are served before the Worker runs, so a file-like path that gets here is missing
 * (for example an old hashed chunk after a deploy). It must be a 404: the SPA fallback would answer
 * 200 with index.html, which a service worker could cache in place of JavaScript.
 */
function isMissingFile(request: Request, pathname: string): boolean {
  return request.headers.get("Sec-Fetch-Mode") !== "navigate" && /\.[a-z0-9]+$/i.test(pathname);
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    const { pathname } = new URL(request.url);
    if (isApiPath(pathname)) return app.fetch(request, env, ctx);
    if (isMissingFile(request, pathname)) {
      return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
