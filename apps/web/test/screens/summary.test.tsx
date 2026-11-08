/**
 * Summary screen against the real engine: a week 1 calibration session reads "Start at 25 kg × 5 next time",
 * bodyweight and timed work never show "0 kg", and Done sits in the dock (bottom third).
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { computeState } from "@gym/engine";
import { AppShell } from "../../src/components/AppShell";
import { finishSession, loadContext, logSet, setClock, startSession } from "../../src/data";
import * as repo from "../../src/data/repo";
import { SummaryScreen } from "../../src/screens/Summary";
import { resetDb } from "../data/helpers";

let now = "2026-11-09T16:00:00.000Z";

beforeEach(async () => {
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  await resetDb();
  now = "2026-11-09T16:00:00.000Z";
  setClock(() => now);
  await repo.ensureSettings();
});
afterEach(() => {
  cleanup();
  setClock(null);
});

/** Session A of week 1, no remembered weights: every barbell lift picked at 20 kg, all as prescribed. */
async function calibrationSessionA(): Promise<string> {
  const ctx = await loadContext();
  const plan = computeState(ctx).next.plan;
  const s = await startSession({ code: plan.code, mode: plan.mode, flags: plan.flags });
  for (const ex of plan.exercises) {
    for (const set of ex.sets) {
      await logSet({
        sessionId: s.id,
        prescriptionId: ex.prescription_id,
        exerciseId: ex.exercise_id,
        setIndex: set.index,
        target: { weight: set.weight, reps: set.reps, rir: set.rir },
        weight: set.weight ?? 20,
        reps: set.reps,
        rir: set.rir,
      });
    }
  }
  now = "2026-11-09T17:00:00.000Z";
  await finishSession(s.id);
  return s.id;
}

function renderSummary(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/summary/${id}`]}>
      <AppShell>
        <Routes>
          <Route path="/summary/:sessionId" element={<SummaryScreen />} />
          <Route path="/" element={<p>today</p>} />
        </Routes>
      </AppShell>
    </MemoryRouter>,
  );
}

describe("Summary", () => {
  it("names the starting weight after calibration and shows timed bodyweight work without kg", async () => {
    const id = await calibrationSessionA();
    const { container } = renderSummary(id);
    expect(await screen.findByText("Session A done.")).toBeTruthy();
    const nextTime = screen.getByRole("heading", { name: "Next time" }).closest("section")!;
    const squat = within(nextTime).getByText("Back squat").closest("li")!;
    expect(within(squat).getByText(/^Start at \d+(\.\d+)? kg × \d+ next time$/)).toBeTruthy();
    expect(squat.textContent).not.toMatch(/aim \d/);

    const plank = within(nextTime).getByText("Plank").closest("li")!;
    expect(plank.textContent).not.toMatch(/0 kg/);
    expect(within(plank).getByText(/^Next: 45 s$/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/\b0 kg/);
  });

  it("puts Done in the dock, above the tab bar", async () => {
    const id = await calibrationSessionA();
    renderSummary(id);
    await screen.findByText("Session A done.");
    const done = screen.getByRole("button", { name: "Done" });
    expect(done.closest("main")).toBeNull();
    fireEvent.click(done);
    expect(await screen.findByText("today")).toBeTruthy();
  });
});
