import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { chunkJson } from "../src/store";
import { post, resetDb, sync } from "./helpers";
import { fixtures } from "./fixtures";

beforeEach(resetDb);

describe("chunkJson", () => {
  it("splits into valid JSON arrays under the size cap and keeps every item in order", () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ i, pad: "x".repeat(i * 3) }));
    const chunks = chunkJson(items, 500);
    expect(chunks.length).toBeGreaterThan(1);
    const back = chunks.flatMap((c) => {
      expect(c.json.length).toBeLessThanOrEqual(500);
      const arr = JSON.parse(c.json) as unknown[];
      expect(arr).toHaveLength(c.count);
      return arr;
    });
    expect(back).toEqual(items);
  });

  it("an oversized single item gets its own chunk; empty input gives no chunks", () => {
    expect(chunkJson([{ a: "x".repeat(100) }], 10)).toHaveLength(1);
    expect(chunkJson([])).toEqual([]);
  });
});

describe("large writes", () => {
  it("a push spanning several statements keeps unique, dense revs", async () => {
    const pad = "y".repeat(600);
    const decisions = Array.from({ length: 1500 }, (_, i) =>
      fixtures.decision({ id: `dec_${String(i).padStart(4, "0")}`, explanation: pad }),
    );
    const res = await sync({ changes: { decision: decisions, checkin: [fixtures.checkin()] }, limit: 2000 });
    expect(res.accepted).toBe(1501);
    expect(res.changes.decision).toHaveLength(1500);
    expect(res.cursor).toBe(1501);
    const { results } = await env.DB.prepare(`SELECT rev FROM decision ORDER BY rev`).all<{ rev: number }>();
    // checkin comes first in SYNC_TABLES order, so it holds rev 1.
    expect(results.map((r) => r.rev)).toEqual(Array.from({ length: 1500 }, (_, i) => i + 2));
  });

  it("import accepts a backup larger than 2 MB, sync does not", async () => {
    const pad = "z".repeat(900);
    const decisions = Array.from({ length: 2600 }, (_, i) => fixtures.decision({ id: `big_${i}`, explanation: pad }));
    const file = { format: "workout-os-export", version: 1, exported_at: "2026-11-08T00:00:00.000Z", tables: { decision: decisions } };
    expect(JSON.stringify(file).length).toBeGreaterThan(2 * 1024 * 1024);

    const tooBig = await post("/api/sync", { client_id: "c", cursor: 0, changes: { decision: decisions } });
    expect(tooBig.status).toBe(413);

    const res = await post("/api/import?mode=replace", file);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { counts: { decision: { written: number } } };
    expect(body.counts.decision.written).toBe(2600);
    const count = await env.DB.prepare(`SELECT COUNT(*) AS n, COUNT(DISTINCT rev) AS r FROM decision`).first<{ n: number; r: number }>();
    expect(count).toEqual({ n: 2600, r: 2600 });
  });
});
