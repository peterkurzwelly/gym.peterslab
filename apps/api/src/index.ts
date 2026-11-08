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

const notFound = () =>
  new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (isApiPath(pathname)) return app.fetch(request, env, ctx);
    const res = await env.ASSETS.fetch(request);
    // wrangler.jsonc routes /assets/* here too. A missing hashed file (an old chunk after a deploy) gets the
    // SPA fallback from the assets service, i.e. 200 index.html, which a service worker could cache as
    // JavaScript. Answer 404 instead.
    if (pathname.startsWith("/assets/") && (res.headers.get("Content-Type") ?? "").startsWith("text/html")) return notFound();
    return res;
  },
} satisfies ExportedHandler<Env>;
