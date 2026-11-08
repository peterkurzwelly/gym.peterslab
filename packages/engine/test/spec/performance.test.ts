/** The engine runs on every render of the Today screen, on an iPhone: a full block of history must stay fast. */
import { describe, expect, it } from "vitest";
import { computeState } from "../../src/index";
import { makeCtx, upTo } from "./helpers";
import { T, TWELVE_WEEKS_HISTORY } from "./fixtures/twelve-weeks";

const BUDGET_MS = 100;
const RUNS = 5;

describe("performance", () => {
  it(`computeState on the twelve-week fixture: median of ${RUNS} runs under ${BUDGET_MS} ms`, () => {
    const ctx = makeCtx({ now: T.end, history: upTo(TWELVE_WEEKS_HISTORY, T.end) });
    computeState(ctx); // warm up the JIT and module caches
    const times: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now();
      const s = computeState(ctx);
      times.push(performance.now() - t0);
      expect(s.weeks.length).toBe(13);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(RUNS / 2)]!;
    expect(median, `runs: ${times.map((t) => t.toFixed(1)).join(", ")} ms`).toBeLessThan(BUDGET_MS);
  });
});
