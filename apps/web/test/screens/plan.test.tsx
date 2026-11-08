/**
 * Plan tab against the real engine and Dexie (fake-indexeddb). History is seeded through the repo with a fixed clock.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { computeState, planSession } from "@gym/engine";
import { db, finishSession, loadContext, logSet, setClock, startSession } from "../../src/data";
import { PlanScreen } from "../../src/screens/Plan";
import { MAIN_LIFT_NOTE } from "../../src/screens/plan/EditBlock";
import { resetDb } from "../data/helpers";

let clock = "2026-11-08T10:00:00.000Z";
const at = (iso: string) => {
  clock = iso;
};

/** One strength session: the next in line, every planned set logged as prescribed. */
async function strength(startIso: string) {
  at(startIso);
  const ctx = await loadContext(startIso);
  const code = computeState(ctx).next.code;
  const plan = planSession(ctx, { code, mode: "full" });
  const s = await startSession({ code, mode: "full", flags: plan.flags });
  let t = Date.parse(startIso);
  for (const ex of plan.exercises.slice(0, 3)) {
    for (const set of ex.sets) {
      t += 120_000;
      at(new Date(t).toISOString());
      await logSet({
        sessionId: s.id,
        prescriptionId: ex.prescription_id,
        exerciseId: ex.exercise_id,
        setIndex: set.index,
        target: { weight: set.weight, reps: set.reps, rir: set.rir },
        weight: set.weight ?? 40,
        reps: ex.calibration ? ex.rep_max : set.reps,
        rir: set.rir,
      });
    }
  }
  at(new Date(t + 300_000).toISOString());
  await finishSession(s.id);
}

function renderPlan() {
  return render(
    <MemoryRouter initialEntries={["/plan"]}>
      <PlanScreen />
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  await resetDb();
  setClock(() => clock);
  at("2026-11-08T10:00:00.000Z");
});

afterEach(() => {
  cleanup();
  setClock(null);
});

describe("Plan · before the block starts (Sunday 8 Nov)", () => {
  it("shows the 12 weeks with week 1 as this week", async () => {
    renderPlan();
    await screen.findByText("The block");
    const rows = screen.getAllByRole("listitem").filter((li) => /^Week \d+, /.test(li.getAttribute("aria-label") ?? ""));
    expect(rows).toHaveLength(12);
    expect(rows[0]!.getAttribute("aria-label")).toContain("this week");
    expect(rows[0]!.getAttribute("aria-current")).toBe("true");
    expect(rows[7]!.getAttribute("aria-label")).toContain("Deload week");
  });

  it("offers two floor sessions on Monday and Wednesday at 07:00 with ICS and Google links", async () => {
    const { container } = renderPlan();
    await screen.findByText("Book your two floor sessions");
    const ics = [...container.querySelectorAll<HTMLAnchorElement>('a[href^="/api/ics"]')].map((a) => a.getAttribute("href")!);
    expect(ics).toHaveLength(2);
    expect(ics[0]).toContain("start=2026-11-09T07%3A00%3A00%2B01%3A00");
    expect(ics[0]).toContain("title=Workout%20%C2%B7%20Session%20A");
    expect(ics[0]).toContain("minutes=55");
    expect(ics[1]).toContain("start=2026-11-11T07%3A00%3A00%2B01%3A00");
    expect(ics[1]).toContain("Session%20B");
    expect(container.querySelectorAll('a[href^="https://calendar.google.com"]')).toHaveLength(2);

    // Inline edits: another time and another day.
    fireEvent.click(screen.getByRole("radio", { name: "17:00" }));
    fireEvent.click(screen.getByRole("button", { name: /Wed 11 Nov/ })); // unpick Wednesday
    fireEvent.click(screen.getByRole("button", { name: /Thu 12 Nov/ }));
    await waitFor(() => {
      const hrefs = [...container.querySelectorAll<HTMLAnchorElement>('a[href^="/api/ics"]')].map((a) => a.getAttribute("href")!);
      expect(hrefs).toHaveLength(2);
      expect(hrefs[0]).toContain("start=2026-11-09T17%3A00%3A00%2B01%3A00");
      expect(hrefs[1]).toContain("start=2026-11-12T17%3A00%3A00%2B01%3A00");
    });
  });

  it("logs a walk and undoes it", async () => {
    renderPlan();
    fireEvent.click(await screen.findByRole("button", { name: "Log a 20 minute walk" }));
    await screen.findByText("Walk logged · 20 min");
    const walks = (await db.cardio_log.toArray()).filter((c) => !c.deleted_at);
    expect(walks).toHaveLength(1);
    expect(walks[0]).toMatchObject({ modality: "walk", minutes: 20, session_id: null, date: "2026-11-08" });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(async () => expect((await db.cardio_log.toArray()).filter((c) => !c.deleted_at)).toHaveLength(0));
  });
});

describe("Plan · edits", () => {
  it("swaps a non main lift for the block and keeps main lifts locked", async () => {
    renderPlan();
    await screen.findByText("Swap for the block");
    fireEvent.click(screen.getByRole("radio", { name: "Session B" }));
    fireEvent.click(await screen.findByRole("button", { name: /Pull-up/ }));
    const group = await screen.findByRole("radiogroup", { name: /Pull-up this block/ });
    expect(within(group).getByRole("radio", { name: /Pull-up, program exercise/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(group).getByRole("radio", { name: /Lat pulldown/ }));
    await waitFor(async () => expect((await db.settings.get("settings"))?.block_swaps).toEqual({ B3: "lat_pulldown" }));
    await screen.findByText("For the block");

    // Back to the program exercise removes the swap.
    fireEvent.click(screen.getByRole("radio", { name: /Pull-up, program exercise/ }));
    await waitFor(async () => expect((await db.settings.get("settings"))?.block_swaps).toEqual({}));

    // Main lift: lock and the one line explanation, no options.
    fireEvent.click(screen.getByRole("button", { name: /Trap bar deadlift/ }));
    expect(await screen.findAllByText(MAIN_LIFT_NOTE)).toHaveLength(2);
    expect(screen.queryByRole("radiogroup", { name: /Trap bar deadlift this block/ })).toBeNull();
  });

  it("changes the session order", async () => {
    renderPlan();
    await waitFor(async () => expect(await db.settings.get("settings")).toBeDefined());
    fireEvent.click(await screen.findByRole("button", { name: "Move session A later" }));
    await waitFor(async () => expect((await db.settings.get("settings"))?.session_order).toEqual(["B", "A", "C"]));
    fireEvent.click(await screen.findByRole("button", { name: "Reset" }));
    await waitFor(async () => expect((await db.settings.get("settings"))?.session_order).toEqual(["A", "B", "C"]));
  });
});

describe("Plan · with history", () => {
  it("shows a zero week calmly and books the rest of this week", async () => {
    // Week 1 (9 Nov): two sessions. Week 2 (16 Nov): nothing. Now: Tuesday 24 Nov, 05:00 local.
    await strength("2026-11-09T06:00:00.000Z");
    await strength("2026-11-11T06:00:00.000Z");
    at("2026-11-24T04:00:00.000Z");
    renderPlan();
    await screen.findByText("The block");
    expect(screen.getAllByText("Paused week · block extended").length).toBeGreaterThan(0);
    expect(screen.getByText(/It runs 1 week longer/)).toBeTruthy();
    const rows = screen.getAllByRole("listitem").filter((li) => /^Week \d+, /.test(li.getAttribute("aria-label") ?? ""));
    expect(rows[0]!.getAttribute("aria-label")).toContain("Floor ✓");
    // 3 calendar weeks so far (training weeks 1, 2, 2) + training weeks 3 to 12 ahead.
    expect(rows).toHaveLength(13);
    expect(screen.getByText("Book your two floor sessions")).toBeTruthy();
    expect(screen.getByText(/This week: two sessions/)).toBeTruthy();
    // Today is still open before 07:00.
    expect(screen.getByRole("button", { name: /Tue 24 Nov, booked/ })).toBeTruthy();
  });
});
