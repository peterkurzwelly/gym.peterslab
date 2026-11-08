/**
 * Service worker updates (src/lib/updatePolicy.ts, used by index.html) and the precache guard
 * (public/sw-guard.js, imported by the generated service worker).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHECK_EVERY_MS, OPEN_AFTER_HIDDEN_MS, createUpdatePolicy, isSessionOpen, markSessionOpen } from "../../src/lib/updatePolicy";

function harness(sessionOpen = false) {
  let t = 1_000_000;
  const open = { value: sessionOpen };
  const reload = vi.fn();
  const update = vi.fn();
  const policy = createUpdatePolicy({ reload, update, now: () => t, sessionOpen: () => open.value, online: () => true });
  const advance = (ms: number) => {
    t += ms;
  };
  const hideFor = (ms: number) => {
    policy.hidden();
    advance(ms);
    policy.visible();
  };
  return { policy, reload, update, advance, hideFor, open };
}

describe("update policy", () => {
  it("reloads at an untouched cold open", () => {
    const h = harness();
    h.policy.needReload();
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it("never reloads mid-session, not even after a long lock or a trip to the music app", () => {
    const h = harness(true);
    h.policy.needReload(); // a version found while the session is open
    expect(h.reload).not.toHaveBeenCalled();
    expect(h.policy.pendingReload).toBe(true);
    h.hideFor(40_000);
    h.hideFor(OPEN_AFTER_HIDDEN_MS + 1);
    expect(h.reload).not.toHaveBeenCalled();
    // No update check mid-session either: a new worker would activate and ask for a reload.
    h.advance(CHECK_EVERY_MS * 3);
    h.hideFor(OPEN_AFTER_HIDDEN_MS + 1);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("a rest-length hide is not an app open; the pending reload waits for the next real open after the session", () => {
    const h = harness();
    h.policy.touch();
    h.policy.needReload();
    expect(h.reload).not.toHaveBeenCalled();
    h.hideFor(40_000); // locked the phone during a rest
    expect(h.reload).not.toHaveBeenCalled();
    h.hideFor(OPEN_AFTER_HIDDEN_MS + 1);
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it("looks for a new version at an app open, at most every few minutes, and only outside a session", () => {
    const h = harness();
    h.advance(CHECK_EVERY_MS + 1);
    h.hideFor(OPEN_AFTER_HIDDEN_MS + 1);
    expect(h.update).toHaveBeenCalledTimes(1);
    h.hideFor(OPEN_AFTER_HIDDEN_MS + 1);
    expect(h.update).toHaveBeenCalledTimes(2); // 20 min later is past the check interval
    h.open.value = true;
    h.hideFor(OPEN_AFTER_HIDDEN_MS + 1);
    expect(h.update).toHaveBeenCalledTimes(2);
  });

  it("the session flag lives in sessionStorage", () => {
    markSessionOpen("s1");
    expect(isSessionOpen()).toBe(true);
    markSessionOpen(null);
    expect(isSessionOpen()).toBe(false);
  });
});

describe("sw-guard (precache)", () => {
  const code = readFileSync(resolve(__dirname, "../../public/sw-guard.js"), "utf8");
  const html = () => new Response("<!doctype html><title>Workout OS</title>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

  function load(respond: (url: string) => Response) {
    const self = {
      location: new URL("https://gym.peterslab.app/sw.js"),
      fetch: vi.fn(async (input: RequestInfo | URL) => respond(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)),
    } as unknown as { fetch: typeof fetch; location: URL };
    new Function("self", code)(self);
    return self;
  }

  afterEach(() => vi.restoreAllMocks());

  it("turns index.html served for a missing hashed chunk into a 404, so the install fails cleanly", async () => {
    const self = load(() => html());
    const res = await self.fetch("/assets/index-abc123.js");
    expect(res.status).toBe(404);
    expect((await self.fetch(new Request("https://gym.peterslab.app/assets/index-abc123.css"))).status).toBe(404);
    expect((await self.fetch("/pwa-192x192.png")).status).toBe(404);
  });

  it("leaves real assets, HTML pages, navigations and other origins alone", async () => {
    const js = load(() => new Response("export{}", { status: 200, headers: { "content-type": "text/javascript" } }));
    expect((await js.fetch("/assets/index-abc123.js")).status).toBe(200);
    const pages = load(() => html());
    expect((await pages.fetch("/index.html?__WB_REVISION__=1")).status).toBe(200);
    expect((await pages.fetch("/")).status).toBe(200);
    expect((await pages.fetch("/plan")).status).toBe(200);
    expect((await pages.fetch("/assets/x.js", { mode: "navigate" } as RequestInit)).status).toBe(200);
    expect((await pages.fetch("https://cdn.example.com/lib.js")).status).toBe(200);
  });
});
