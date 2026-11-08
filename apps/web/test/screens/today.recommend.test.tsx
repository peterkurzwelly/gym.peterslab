/**
 * Today leads with next.recommended_mode, and stays calm when the engine fails.
 * The real engine runs underneath; computeState can be overridden per test.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type * as Engine from "@gym/engine";

const engineOverride = vi.hoisted(() => ({
  next: null as Record<string, unknown> | null,
  fail: false,
}));

vi.mock("@gym/engine", async (importOriginal) => {
  const real = await importOriginal<typeof Engine>();
  return {
    ...real,
    computeState: (ctx: Engine.EngineContext) => {
      if (engineOverride.fail) throw new Error("program.json is invalid");
      const state = real.computeState(ctx);
      return engineOverride.next ? { ...state, next: { ...state.next, ...engineOverride.next } } : state;
    },
  };
});

import { AppShell } from "../../src/components/AppShell";
import { db } from "../../src/data/db";
import { setClock } from "../../src/data/clock";
import * as repo from "../../src/data/repo";
import { TodayScreen } from "../../src/screens/Today";
import { resetRestForTests } from "../../src/screens/today/rest";
import { resetDb } from "../data/helpers";

let now = "2026-11-08T10:00:00.000Z";

function renderToday() {
  return render(
    <MemoryRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<TodayScreen />} />
        </Routes>
      </AppShell>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  await resetDb();
  now = "2026-11-08T10:00:00.000Z";
  setClock(() => now);
  try {
    window.sessionStorage.clear();
  } catch {
    /* ignore */
  }
  resetRestForTests();
  engineOverride.next = null;
  engineOverride.fail = false;
  await repo.ensureSettings();
  await repo.updateSettings({ remembered_weights: { back_squat: { weight: 100, reps: 5 } } });
});
afterEach(() => {
  cleanup();
  setClock(null);
});

const modeButton = (label: RegExp) => screen.getAllByRole("button").find((b) => b.getAttribute("aria-pressed") != null && label.test(b.textContent ?? ""))!;

describe("Today · recommended version", () => {
  it("preselects the ★ 30 min version with the reason, and full is one tap away", async () => {
    engineOverride.next = { recommended_mode: "short", recommended_rule_id: "plan.evening", recommended_reason: "After 19:00: the 30 min version counts fully." };
    renderToday();
    expect(await screen.findByText("After 19:00: the 30 min version counts fully.")).toBeTruthy();
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(3));
    expect(modeButton(/30 min/).getAttribute("aria-pressed")).toBe("true");
    // Travel stays one tap away.
    expect(modeButton(/Travel/).getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Full instead" }));
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(6));
    expect(modeButton(/30 min/).getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByText(/After 19:00/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Confirm Back squat set 1 of 2" }));
    await waitFor(async () => expect(await db.session.count()).toBe(1));
    expect((await db.session.toArray())[0]).toMatchObject({ mode: "full" });
  });

  it("starts the short session when the first set is logged in the recommended version", async () => {
    engineOverride.next = { recommended_mode: "short", recommended_rule_id: "event.never_miss_twice", recommended_reason: "Never miss twice: the 30 min version is enough today." };
    renderToday();
    fireEvent.click(await screen.findByRole("button", { name: "Confirm Back squat set 1 of 1" }));
    await waitFor(async () => expect(await db.session.count()).toBe(1));
    expect((await db.session.toArray())[0]).toMatchObject({ program_day_id: "A", mode: "short" });
  });

  it("the real engine leads with the 30 min version after the evening hour", async () => {
    now = "2026-11-09T18:30:00.000Z"; // Monday 19:30 in Stockholm, block week 1
    renderToday();
    await screen.findByText("Week 1 of 12");
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(3));
    expect(modeButton(/30 min/).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("After 19:00: the 30 min version counts fully.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Full instead" })).toBeTruthy();
  });
});

describe("Today · engine error", () => {
  it("shows a calm message and that the log is safe", async () => {
    const s = await repo.startSession({ code: "A", mode: "full" });
    await repo.logSet({ sessionId: s.id, prescriptionId: "A1", exerciseId: "back_squat", setIndex: 0, target: { weight: 60, reps: 8, rir: 3 }, weight: 60, reps: 8, rir: 3 });
    engineOverride.fail = true;
    renderToday();
    expect(await screen.findByText("Today could not be planned")).toBeTruthy();
    expect(await screen.findByText(/1 set saved/)).toBeTruthy();
    expect(screen.getByText(/Your log is safe on this phone/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save a backup" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/failed/i);
  });
});
