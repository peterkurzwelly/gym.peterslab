/**
 * Today with history (real engine over fake-indexeddb): break nudges never override the ★ 30 min
 * recommendation, nudge buttons say "Show", the dock prompts a check-in before the first set, and the
 * service worker's "session open" flag follows the running session.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { computeState, planSession } from "@gym/engine";
import { AppShell } from "../../src/components/AppShell";
import { db } from "../../src/data/db";
import { finishSession, loadContext, logSet, setClock, startSession } from "../../src/data";
import * as repo from "../../src/data/repo";
import { isSessionOpen } from "../../src/lib/updatePolicy";
import { TodayScreen } from "../../src/screens/Today";
import { SummaryScreen } from "../../src/screens/Summary";
import { resetRestForTests } from "../../src/screens/today/rest";
import { resetDb } from "../data/helpers";

let now = "2026-11-08T10:00:00.000Z";

/** The next strength session in line, the first three exercises logged as prescribed, then finished. */
async function strength(startIso: string) {
  now = startIso;
  const ctx = await loadContext(startIso);
  const code = computeState(ctx).next.code;
  const plan = planSession(ctx, { code, mode: "full" });
  const s = await startSession({ code, mode: "full", flags: plan.flags });
  let t = Date.parse(startIso);
  for (const ex of plan.exercises.slice(0, 3)) {
    for (const set of ex.sets) {
      t += 120_000;
      now = new Date(t).toISOString();
      await logSet({
        sessionId: s.id,
        prescriptionId: ex.prescription_id,
        exerciseId: ex.exercise_id,
        setIndex: set.index,
        target: { weight: set.weight, reps: set.reps, rir: set.rir },
        weight: set.weight ?? 40,
        reps: set.reps,
        rir: set.rir,
      });
    }
  }
  now = new Date(t + 300_000).toISOString();
  await finishSession(s.id);
}

function renderToday() {
  return render(
    <MemoryRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<TodayScreen />} />
          <Route path="/summary/:sessionId" element={<SummaryScreen />} />
        </Routes>
      </AppShell>
    </MemoryRouter>,
  );
}

const modeButton = (label: RegExp) => screen.getAllByRole("button").find((b) => b.getAttribute("aria-pressed") != null && label.test(b.textContent ?? ""))!;

beforeEach(async () => {
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  await resetDb();
  now = "2026-11-08T10:00:00.000Z";
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

describe("Today · coming back after a break", () => {
  it("the welcome back nudge only informs; the ★ 30 min version stays chosen", async () => {
    // A on Mon 9 Nov, B on Wed 11 Nov, then nothing until Wed 18 Nov at noon: a 7 day break, floor not reached.
    await strength("2026-11-09T06:00:00.000Z");
    await strength("2026-11-11T06:00:00.000Z");
    now = "2026-11-18T11:00:00.000Z";
    const state = computeState(await loadContext(now));
    const kinds = state.nudges.map((n) => n.kind);
    expect(kinds).toContain("never_miss_twice");
    renderToday();

    expect(kinds.some((k) => k === "break_resume" || k === "long_break")).toBe(true);
    const welcome = (await screen.findAllByText(/^Welcome back/)).map((el) => el.closest("aside")).find(Boolean)!;
    expect(within(welcome).queryByRole("button")).toBeNull();
    // The never miss twice nudge leads with the short version, and its button says what it does.
    const nmt = screen.getAllByText(/^Never miss twice/).map((el) => el.closest("aside")).find(Boolean)!;
    const show = within(nmt).getByRole("button", { name: "Show ★ 30 min C" });
    await waitFor(() => expect(modeButton(/30 min/).getAttribute("aria-pressed")).toBe("true"));
    fireEvent.click(show);
    expect(modeButton(/30 min/).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: /^Start session/ })).toBeNull();
  });
});

describe("Today · check-in before the first set", () => {
  it("the dock prompts a check-in until one is saved", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    renderToday();
    const prompt = await screen.findByRole("button", { name: /Check in · 20 s/ });
    // In the dock with the first set, not in the page flow.
    expect(prompt.closest("main")).toBeNull();
    expect(screen.getByRole("group", { name: "Start with" })).toBeTruthy();
    fireEvent.click(prompt);
    await waitFor(() => expect(scroll.mock.contexts.some((el) => (el as HTMLElement).id === "today-checkin")).toBe(true));

    const card = screen.getByRole("region", { name: "Daily check-in" });
    for (const m of ["Sleep", "Soreness", "Stress", "Energy"]) fireEvent.click(within(card).getByRole("radio", { name: new RegExp(`^${m} 4`) }));
    fireEvent.click(within(card).getByRole("button", { name: "Save" }));
    await waitFor(async () => expect(await db.checkin.count()).toBe(1));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Check in · 20 s/ })).toBeNull());
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it("a skipped check-in leaves the dock alone", async () => {
    renderToday();
    await screen.findByRole("button", { name: /Check in · 20 s/ });
    fireEvent.click(within(screen.getByRole("region", { name: "Daily check-in" })).getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Check in · 20 s/ })).toBeNull());
  });
});

describe("Today · session open flag for service worker updates", () => {
  it("is set while a session runs and cleared when it is finished", async () => {
    await repo.updateSettings({ remembered_weights: { back_squat: { weight: 100, reps: 5 } } });
    renderToday();
    fireEvent.click(await screen.findByRole("button", { name: "Confirm Back squat set 1 of 2" }));
    await screen.findByText(/In progress/);
    await waitFor(() => expect(isSessionOpen()).toBe(true));
    const [s] = await db.session.toArray();
    expect(window.sessionStorage.getItem("gym.session-open")).toBe(s!.id);
    await within(screen.getByRole("article", { name: "Back squat" })).findByText("1/2");

    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    fireEvent.click(within(await screen.findByRole("group", { name: "Finish early" })).getByRole("button", { name: "Finish" }));
    expect(await screen.findByText("Session A done.")).toBeTruthy();
    expect(isSessionOpen()).toBe(false);
  });
});
