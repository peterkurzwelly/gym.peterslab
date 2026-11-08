/**
 * Progress tab against the real engine and Dexie (fake-indexeddb), charts included (Recharts in jsdom).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { computeState, planSession } from "@gym/engine";
import { db, finishSession, loadContext, logCardio, logSet, logWalk, saveCheckin, setClock, startCardioSession, startSession } from "../../src/data";
import { ProgressScreen } from "../../src/screens/Progress";
import { resetDb } from "../data/helpers";

let clock = "2026-11-08T10:00:00.000Z";
const at = (iso: string) => {
  clock = iso;
};

async function strength(startIso: string) {
  at(startIso);
  const ctx = await loadContext(startIso);
  const code = computeState(ctx).next.code;
  const plan = planSession(ctx, { code, mode: "full" });
  const s = await startSession({ code, mode: "full", flags: plan.flags });
  let t = Date.parse(startIso);
  for (const ex of plan.exercises) {
    for (const set of ex.sets) {
      t += 120_000;
      at(new Date(t).toISOString());
      await logSet({
        sessionId: s.id,
        prescriptionId: ex.prescription_id,
        exerciseId: ex.exercise_id,
        setIndex: set.index,
        target: { weight: set.weight, reps: set.reps, rir: set.rir },
        weight: set.weight ?? (ex.bodyweight ? 0 : 40),
        reps: ex.calibration ? ex.rep_max : set.reps,
        rir: set.rir,
      });
    }
  }
  at(new Date(t + 300_000).toISOString());
  await finishSession(s.id);
}

async function cardio(startIso: string) {
  at(startIso);
  const s = await startCardioSession();
  await logCardio({ sessionId: s.id, modality: "bike", minutes: 26, hardMinutes: 8, intensity: "hard", source: "timer" });
  at(new Date(Date.parse(startIso) + 30 * 60_000).toISOString());
  await finishSession(s.id);
}

function renderProgress() {
  return render(
    <MemoryRouter initialEntries={["/progress"]}>
      <ProgressScreen />
    </MemoryRouter>,
  );
}

beforeAll(() => {
  // Recharts measures its container; jsdom has no ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(async () => {
  await resetDb();
  setClock(() => clock);
  at("2026-11-08T10:00:00.000Z");
});

afterEach(() => {
  cleanup();
  setClock(null);
});

describe("Progress · first day (Sunday 8 Nov, block starts Monday)", () => {
  it("shows 0 of 12 calmly, leads with the Sunday review and books week 1", async () => {
    const { container } = renderProgress();
    await screen.findByLabelText("Weeks without a zero: 0 of 12");
    expect(screen.getByText("Two minutes for the week.")).toBeTruthy();
    expect(screen.getByText(/The block starts Mon 9 Nov/)).toBeTruthy();
    expect(screen.getByText("Book your two floor sessions")).toBeTruthy();
    const ics = [...container.querySelectorAll<HTMLAnchorElement>('a[href^="/api/ics"]')].map((a) => a.getAttribute("href")!);
    expect(ics[0]).toContain("start=2026-11-09T07%3A00%3A00%2B01%3A00");
    // No history: one calm card instead of four empty charts, no flags.
    expect(screen.getByText(/No history yet, and that is fine/)).toBeTruthy();
    expect(screen.getByText("No flags. Nothing needs a change right now.")).toBeTruthy();
    expect(container.querySelector(".recharts-wrapper")).toBeNull();
    // Copy rules: no red words.
    expect(container.textContent).not.toMatch(/failed|missed/i);
  });
});

describe("Progress · with history", () => {
  it("shows the streak, totals, charts and a repair for the paused week", { timeout: 20_000 }, async () => {
    // Week 1 (9 Nov): A, B, cardio. Week 2: paused. Week 3 (23 Nov): A today. Now: Sunday 29 Nov.
    await saveCheckin({ date: "2026-11-09", sleep: 4, soreness: 4, stress: 3, energy: 4 });
    await strength("2026-11-09T06:00:00.000Z");
    await strength("2026-11-11T06:00:00.000Z");
    await cardio("2026-11-14T09:00:00.000Z");
    at("2026-11-12T11:00:00.000Z");
    await logWalk("2026-11-12", 40);
    await strength("2026-11-25T06:00:00.000Z");
    at("2026-11-29T09:00:00.000Z");

    const { container } = renderProgress();
    await screen.findByLabelText(/Weeks without a zero: \d+ of 12/);
    const state = computeState(await loadContext("2026-11-29T09:00:00.000Z"));
    expect(screen.getByLabelText(`Weeks without a zero: ${state.streak.weeks_without_zero} of 12`)).toBeTruthy();
    expect(state.weeks[1]!.status).toBe("zero");

    // Totals that never reset.
    expect(screen.getByText("Since day one")).toBeTruthy();
    expect(screen.getAllByText(String(state.totals.sessions)).length).toBeGreaterThan(0);

    // Sunday review: this week's floor is not reached yet. The comeback session holds loads, so nothing moved up.
    expect(screen.getByText("Two minutes for the week.")).toBeTruthy();
    expect(screen.getByText(/^Not yet\. /)).toBeTruthy();
    expect(screen.getByText(/No weights went up this week/)).toBeTruthy();
    // Last week was paused: calm words.
    fireEvent.click(screen.getByRole("radio", { name: "Last week" }));
    await screen.findByText("Paused week. The block extends, nothing to catch up.");

    // Charts load lazily and render.
    // The chart chunk is a dynamic import; the first transform of Recharts can take a while under a parallel run.
    await waitFor(() => expect(container.querySelector('[aria-label="Weekly fractional sets per muscle"]')).not.toBeNull(), { timeout: 10_000 });
    expect(screen.getAllByText("e1RM per main lift").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Show table").length).toBeGreaterThanOrEqual(3);

    // Repair the paused week (streak freeze), then undo.
    fireEvent.click(screen.getByRole("button", { name: "Repair" }));
    await waitFor(async () => expect((await db.training_week.get(state.weeks[1]!.id))?.repaired).toBe(true));
    await screen.findByText("Repaired · streak kept");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(async () => expect((await db.training_week.get(state.weeks[1]!.id))?.repaired).toBe(false));
  });
});

describe("Progress · Sunday review", () => {
  it("lists what moved up this week, main lifts first", async () => {
    await strength("2026-11-09T06:00:00.000Z"); // A: back squat, bench press
    await strength("2026-11-11T06:00:00.000Z"); // B: trap bar deadlift, overhead press
    at("2026-11-15T09:00:00.000Z");
    renderProgress();
    await screen.findByText("What moved up");
    expect(screen.getByText("Yes. Floor reached, the week counts.")).toBeTruthy();
    const items = screen.getAllByRole("listitem").filter((li) => li.textContent?.startsWith("↑"));
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]!.textContent).toMatch(/Back squat|Bench press|deadlift|overhead press/i);
    expect(items[0]!.textContent).toMatch(/\+\d+(\.\d+)? kg/);
  });
});
