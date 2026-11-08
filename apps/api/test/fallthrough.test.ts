import { describe, expect, it } from "vitest";
import { call } from "./helpers";

// Only requests that matched no static asset reach the Worker outside /api.
describe("non-API fallthrough", () => {
  it("answers 404 for a missing file instead of the SPA page", async () => {
    const res = await call("/assets/index-OLDHASH.js");
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("still serves the app for a navigation to a deep link", async () => {
    const res = await call("/summary/01JABCDEF", { headers: { "Sec-Fetch-Mode": "navigate" } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("asset /summary/01JABCDEF");
  });

  it("hands extensionless paths to the assets fallback", async () => {
    const res = await call("/plan");
    expect(res.status).toBe(200);
  });
});
