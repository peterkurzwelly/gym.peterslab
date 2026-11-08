/**
 * Today screen with the real engine over fake-indexeddb.
 * The acceptance path: cold open → the first set is logged with one tap, and that tap starts the session.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "../../src/components/AppShell";
import { db } from "../../src/data/db";
import { setClock } from "../../src/data/clock";
import * as repo from "../../src/data/repo";
import { TodayScreen } from "../../src/screens/Today";
import { SummaryScreen } from "../../src/screens/Summary";
import { resetRestForTests } from "../../src/screens/today/rest";
import { resetDb } from "../data/helpers";

// Sunday 8 Nov 2026, 11:00 in Stockholm: the day before the block starts. It must still offer Session A.
const T0 = "2026-11-08T10:00:00.000Z";
let now = T0;

function renderApp(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppShell>
        <Routes>
          <Route path="/" element={<TodayScreen />} />
          <Route path="/summary/:sessionId" element={<SummaryScreen />} />
        </Routes>
      </AppShell>
    </MemoryRouter>,
  );
}

async function sessions() {
  return (await db.session.toArray()).filter((s) => !s.deleted_at);
}
async function sets() {
  return (await db.set_log.toArray()).filter((s) => !s.deleted_at);
}

beforeEach(async () => {
  window.scrollTo = (() => {}) as typeof window.scrollTo; // jsdom has no layout
  await resetDb();
  now = T0;
  setClock(() => now);
  for (const store of [() => window.sessionStorage, () => window.localStorage]) {
    try {
      store()?.clear();
    } catch {
      /* Node's own localStorage stub may shadow jsdom's */
    }
  }
  resetRestForTests();
  await repo.ensureSettings();
});
afterEach(() => {
  cleanup();
  setClock(null);
});

describe("Today · cold open", () => {
  it("shows week 1 and Session A on an empty database, with the exercise cards on screen", async () => {
    renderApp();
    expect(await screen.findByText("Week 1 of 12")).toBeTruthy();
    expect(screen.getByText("Session A")).toBeTruthy();
    expect(screen.getByRole("article", { name: "Back squat" })).toBeTruthy();
    // No start gate: the first set is ready in the dock.
    const bar = screen.getByRole("group", { name: "Start with" });
    expect(within(bar).getByText("Back squat")).toBeTruthy();
    expect(await sessions()).toHaveLength(0);
  });

  it("one tap on the first set starts the session and logs the set", async () => {
    await repo.updateSettings({ remembered_weights: { back_squat: { weight: 100, reps: 5 } } });
    renderApp();
    const confirm = await screen.findByRole("button", { name: "Confirm Back squat set 1 of 2" });
    fireEvent.click(confirm);

    await waitFor(async () => expect(await sets()).toHaveLength(1));
    const [s] = await sessions();
    expect(s).toMatchObject({ program_day_id: "A", mode: "full", flags: [], swaps: {}, ended_at: null });
    const [set] = await sets();
    expect(set).toMatchObject({ session_id: s!.id, exercise_id: "back_squat", prescription_id: "A1", set_index: 0, weight: 60, reps: 8, rir: 3, target_weight: 60 });

    // The running session takes over: header, finish bar, rest timer for the squat's rest.
    expect(await screen.findByText(/In progress/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Finish" })).toBeTruthy();
    expect(screen.getByRole("timer", { name: /^Rest/ })).toBeTruthy();
    const rest = JSON.parse(window.sessionStorage.getItem("gym.today.rest")!);
    expect(rest.sessionId).toBe(s!.id);
    expect(rest.endsAt - rest.startedAt).toBe(180_000);
  });

  it("calibration: the first set opens the steppers, Done is the second tap", async () => {
    renderApp();
    fireEvent.click(await screen.findByRole("button", { name: "Pick weight for Back squat set 1 of 2" }));
    fireEvent.click(await screen.findByRole("button", { name: "Done" }));
    await waitFor(async () => expect(await sets()).toHaveLength(1));
    expect((await sets())[0]).toMatchObject({ exercise_id: "back_squat", weight: 20, reps: 8, target_weight: null });
    expect(await sessions()).toHaveLength(1);
  });

  it("the ★ 30 min version and swaps chosen before the first set go into the session", async () => {
    await repo.updateSettings({ remembered_weights: { back_squat: { weight: 100, reps: 5 } } });
    renderApp();
    fireEvent.click(await screen.findByRole("button", { name: /★ 30 min/ }));
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(3));
    expect(screen.queryByRole("article", { name: "Plank" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Swap\s*exercise/i }));
    const bench = screen.getByRole("article", { name: "Bench press" });
    fireEvent.click(within(bench).getByRole("button", { name: /Swap/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Dumbbell bench press/ }));
    await screen.findByRole("article", { name: "Dumbbell bench press" });

    fireEvent.click(screen.getByRole("button", { name: "Confirm Back squat set 1 of 1" }));
    await waitFor(async () => expect(await sets()).toHaveLength(1));
    expect((await sessions())[0]).toMatchObject({ mode: "short", swaps: { A2: "dumbbell_bench_press" } });
  });
});

describe("Today · during and after a session", () => {
  async function startWithOneSet() {
    await repo.updateSettings({ remembered_weights: { back_squat: { weight: 100, reps: 5 }, bench_press: { weight: 80, reps: 5 } } });
    const view = renderApp();
    fireEvent.click(await screen.findByRole("button", { name: "Confirm Back squat set 1 of 2" }));
    await screen.findByText(/In progress/);
    await within(screen.getByRole("article", { name: "Back squat" })).findByText("1/2");
    return view;
  }

  it("edits a done set, toggles pain and finishes into the summary, then never stacks", async () => {
    await startWithOneSet();
    const squat = screen.getByRole("article", { name: "Back squat" });

    // Next set highlighted; confirm it.
    fireEvent.click(within(squat).getByRole("button", { name: "Confirm set 2" }));
    await waitFor(async () => expect(await sets()).toHaveLength(2));

    // Edit set 1: +2.5 kg.
    fireEvent.click(within(squat).getByRole("button", { name: "Edit set 1" }));
    fireEvent.click(within(squat).getByRole("button", { name: "Increase weight" }));
    fireEvent.click(within(squat).getByRole("button", { name: "Done" }));
    await waitFor(async () => expect((await sets()).find((s) => s.set_index === 0)?.weight).toBe(62.5));
    expect(await sets()).toHaveLength(2);

    // Pain flags the logged sets of the exercise.
    fireEvent.click(within(squat).getByRole("switch", { name: /Pain/ }));
    await waitFor(async () => expect((await sets()).every((s) => s.pain_flag)).toBe(true));

    now = "2026-11-08T11:00:00.000Z";
    // Sets still open: the dock asks first (no modal), then finishes.
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    const ask = await screen.findByRole("group", { name: "Finish early" });
    expect((await sessions())[0]!.ended_at).toBeNull();
    fireEvent.click(within(ask).getByRole("button", { name: "Finish" }));
    expect(await screen.findByText("Session A done.")).toBeTruthy();
    expect((await sessions())[0]!.ended_at).not.toBeNull();
    expect(window.sessionStorage.getItem("gym.today.rest")).toBeNull();

    // Back to Today: done for today, cardio still offered, no exercise cards.
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByText("Done for today")).toBeTruthy();
    expect(screen.getByRole("button", { name: "See today's summary" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start cardio" })).toBeTruthy();
    expect(screen.queryByRole("article", { name: "Back squat" })).toBeNull();
  });

  it("a stray Finish tap with sets open asks inline; Keep going keeps the session running", async () => {
    await startWithOneSet();
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    const ask = await screen.findByRole("group", { name: "Finish early" });
    expect(within(ask).getByText(/Finish with 1 of \d+ sets\?/)).toBeTruthy();
    fireEvent.click(within(ask).getByRole("button", { name: "Keep going" }));
    expect(screen.queryByRole("group", { name: "Finish early" })).toBeNull();
    // Still logging: nothing ended, the next set is ready.
    expect((await sessions())[0]!.ended_at).toBeNull();
    expect(screen.getByText(/In progress/)).toBeTruthy();
    expect(within(screen.getByRole("article", { name: "Back squat" })).getByRole("button", { name: "Confirm set 2" })).toBeTruthy();
  });

  it("a set logged by mistake is removed from its editor", async () => {
    await startWithOneSet();
    const squat = screen.getByRole("article", { name: "Back squat" });
    fireEvent.click(within(squat).getByRole("button", { name: "Edit set 1" }));
    fireEvent.click(within(squat).getByRole("button", { name: "Remove set" }));
    await waitFor(async () => expect(await sets()).toHaveLength(0));
    expect((await db.set_log.toArray()).every((s) => s.deleted_at != null)).toBe(true);
    expect(await within(squat).findByText("0/2")).toBeTruthy();
    // The slot is open again and can be logged.
    fireEvent.click(within(squat).getByRole("button", { name: "Confirm set 1" }));
    await waitFor(async () => expect(await sets()).toHaveLength(1));
  });

  it("discard asks inline and removes the session", async () => {
    await startWithOneSet();
    fireEvent.click(screen.getByRole("button", { name: "Discard session" }));
    expect(screen.getByText(/The 1 logged set goes with it/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(async () => expect(await sessions()).toHaveLength(0));
    expect(await screen.findByRole("group", { name: "Start with" })).toBeTruthy();
  });

  it("a session left open is resumed with its sets and the rest timer after a reload", async () => {
    const view = await startWithOneSet();
    view.unmount();
    resetRestForTests();
    renderApp();
    expect(await screen.findByText(/In progress/)).toBeTruthy();
    const squat = screen.getByRole("article", { name: "Back squat" });
    expect(await within(squat).findByText("1/2")).toBeTruthy();
    expect(within(squat).getByRole("button", { name: "Confirm set 2" })).toBeTruthy();
    expect(screen.getByRole("timer", { name: /^Rest/ })).toBeTruthy();
  });
});

describe("Today · cardio", () => {
  it("logs cardio without the timer and lands on its summary", async () => {
    renderApp();
    fireEvent.click(await screen.findByRole("button", { name: "Start cardio" }));
    fireEvent.click(await screen.findByRole("button", { name: "Log without timer" }));
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Save cardio" }));
    });
    expect(await screen.findByText("Cardio done.")).toBeTruthy();
    const cardio = (await db.cardio_log.toArray()).filter((c) => !c.deleted_at);
    expect(cardio).toHaveLength(1);
    expect(cardio[0]).toMatchObject({ modality: "bike", minutes: 26, intensity: "hard", hard_minutes: 8, source: "manual" });
    const [s] = await sessions();
    expect(s).toMatchObject({ program_day_id: "CARDIO" });
    expect(s!.ended_at).not.toBeNull();
  });
});
