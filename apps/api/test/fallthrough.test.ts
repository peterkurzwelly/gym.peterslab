import { describe, expect, it } from "vitest";
import { call } from "./helpers";

const htmlFallback = {
  fetch: async () => new Response("<!doctype html><title>Workout OS</title>", { headers: { "Content-Type": "text/html" } }),
} as unknown as Fetcher;
const jsAsset = {
  fetch: async () => new Response("export {}", { headers: { "Content-Type": "text/javascript" } }),
} as unknown as Fetcher;

// wrangler.jsonc routes /api/* and /assets/* to the Worker; everything else is served by the assets service.
describe("assets passthrough", () => {
  it("answers 404 when a hashed asset is missing and the assets service falls back to index.html", async () => {
    const res = await call("/assets/index-OLDHASH.js", {}, { ASSETS: htmlFallback });
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("passes an existing asset through unchanged", async () => {
    const res = await call("/assets/index-NEW.js", {}, { ASSETS: jsAsset });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("export {}");
  });

  it("keeps the SPA fallback for app routes", async () => {
    const res = await call("/summary/01JABCDEF", {}, { ASSETS: htmlFallback });
    expect(res.status).toBe(200);
  });
});
