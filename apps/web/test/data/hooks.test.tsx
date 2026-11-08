import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import type { EngineContext, EngineState } from "@gym/engine";

vi.mock("@gym/engine", async () => (await import("./engineMock")).engineMock);

import { db } from "../../src/data/db";
import * as repo from "../../src/data/repo";
import { useEngine, usePlan, useSessionLogs, useSessionSummary } from "../../src/data/hooks";
import { engineMock, makeDecision, resetEngineMock } from "./engineMock";
import { resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
  resetEngineMock();
  engineMock.planSession.mockClear();
});
afterEach(() => cleanup());

describe("useEngine", () => {
  it("creates settings on first open and recomputes after writes", async () => {
    const { result } = renderHook(() => useEngine());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.error).toBeNull();
    await waitFor(async () => expect(await db.settings.get("settings")).toBeDefined());

    await act(async () => {
      await repo.startSession({ code: "A", mode: "full" });
    });
    await waitFor(() =>
      expect((result.current.state as unknown as { sessions_seen: number }).sessions_seen).toBe(1),
    );
  });

  it("returns the engine error instead of throwing", async () => {
    engineMock.computeState.mockImplementation(() => {
      throw new Error("bad config");
    });
    const { result } = renderHook(() => useEngine());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.state).toBeNull();
    expect(result.current.error?.message).toBe("bad config");
    expect(result.current.ctx).not.toBeNull();
  });

  it("persists auto finished sessions and their decisions once", async () => {
    const s = await repo.startSession({ code: "A", mode: "full" });
    const ended = "2026-11-08T12:00:00.000Z";
    engineMock.computeState.mockImplementation(
      (ctx: EngineContext) =>
        ({
          auto_finished: ctx.history.sessions.filter((x) => !x.ended_at).map((x) => ({ session_id: x.id, ended_at: ended })),
          decisions: [makeDecision(s.id, "back_squat"), makeDecision("OTHER", "bench_press")],
        }) as unknown as EngineState,
    );
    const { result } = renderHook(() => useEngine());
    await waitFor(async () => expect((await db.session.get(s.id))?.ended_at).toBe(ended));
    await waitFor(async () => expect(await db.decision.count()).toBe(1));
    expect(result.current.error).toBeNull();
    const sessionWrites = (await db.outbox.toArray()).filter((e) => e.table === "session");
    expect(sessionWrites).toHaveLength(2); // start + auto finish, not repeated
  });
});

describe("derived hooks", () => {
  it("usePlan memoizes by value and passes options through", async () => {
    const { result, rerender } = renderHook(() => usePlan({ code: "B", mode: "short" }));
    await waitFor(() => expect(result.current.plan).not.toBeNull());
    const calls = engineMock.planSession.mock.calls.length;
    rerender();
    expect(engineMock.planSession.mock.calls.length).toBe(calls);
    expect(engineMock.planSession.mock.calls[0]![1]).toEqual({ code: "B", mode: "short" });
  });

  it("useSessionSummary returns null for unknown sessions and errors without throwing", async () => {
    const { result } = renderHook(() => useSessionSummary("NOPE"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.summary).toBeNull();

    const s = await repo.startSession({ code: "A", mode: "full" });
    engineMock.summarizeSession.mockImplementation(() => {
      throw new Error("no summary");
    });
    const second = renderHook(() => useSessionSummary(s.id));
    await waitFor(() => expect(second.result.current.error?.message).toBe("no summary"));
  });

  it("useSessionLogs lists live sets without deleted ones", async () => {
    const s = await repo.startSession({ code: "A", mode: "full" });
    const { result } = renderHook(() => useSessionLogs(s.id));
    await waitFor(() => expect(result.current?.session?.id).toBe(s.id));
    let setId = "";
    await act(async () => {
      setId = (await repo.logSet({
        sessionId: s.id, prescriptionId: "A1", exerciseId: "back_squat", setIndex: 0,
        target: { weight: 60, reps: 8, rir: 3 }, weight: 60, reps: 8, rir: 3,
      })).id;
    });
    await waitFor(() => expect(result.current?.sets).toHaveLength(1));
    await act(async () => {
      await repo.deleteSet(setId);
    });
    await waitFor(() => expect(result.current?.sets).toHaveLength(0));
  });
});
