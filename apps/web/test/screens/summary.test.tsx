/**
 * Summary screen against the real engine: the hero and the number tiles, the week in plain words, what
 * changes next time ("Start at 25 kg × 5 next time" after calibration, never "0 kg" for bodyweight work),
 * and Done in the dock (bottom third).
 */
import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as repo from "../../src/data/repo";
import { SummaryScreen } from "../../src/screens/Summary";
import { at, BLOCK_DAY_ONE, cardio, liveSets, renderApp, resetApp, strength, teardownApp, where } from "./helpers";

const renderSummary = (id: string) => renderApp(`/summary/${id}`, { "/summary/:sessionId": <SummaryScreen /> });
const tiles = (container: HTMLElement) => [...(container.querySelector('[aria-label="Session numbers"]')?.children ?? [])].map((t) => t.textContent);

beforeEach(() => resetApp(BLOCK_DAY_ONE));
afterEach(teardownApp);

describe("Summary · strength", () => {
  it("leads with the session, its numbers and the week, in plain words", async () => {
    await repo.updateSettings({ remembered_weights: { back_squat: { weight: 100, reps: 5 }, bench_press: { weight: 80, reps: 5 } } });
    const id = await strength("2026-11-09T06:00:00.000Z", { pick: 20 });
    const sets = await liveSets();
    const { container } = renderSummary(id);

    expect(await screen.findByRole("heading", { level: 1, name: "Session A done." })).toBeTruthy();
    expect(screen.getByText("Workout logged")).toBeTruthy();
    // Minutes, sets and the kilos moved.
    const [minutes, setCount, lifted] = tiles(container);
    expect(minutes).toMatch(/^\d+minutes$/);
    expect(setCount).toBe(`${sets.length}sets`);
    expect(lifted).toMatch(/^\d[\d\s]*kg lifted$/);

    // The week: one of four done, and what reaches the minimum.
    expect(screen.getByText("Week 1 of 12")).toBeTruthy();
    expect(screen.getByText("1 of 4 done")).toBeTruthy();
    expect(screen.getByText(/\bminimum\b/)).toBeTruthy();
    expect(screen.getByText("Now fuel.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Next time" })).toBeTruthy();
    // No shorthand anywhere after one session.
    expect(container.textContent).not.toMatch(/\bRIR\b|e1RM|\bfloor\b|deload|★/i);
  });

  it("names the starting weight after calibration and shows timed bodyweight work without kg", async () => {
    const id = await strength("2026-11-09T06:00:00.000Z", { pick: 20 });
    const { container } = renderSummary(id);
    await screen.findByRole("heading", { level: 1, name: "Session A done." });
    const nextTime = screen.getByRole("heading", { name: "Next time" }).closest("section")!;
    const squat = within(nextTime).getByText("Back squat").closest("li")!;
    expect(within(squat).getByText(/^Start at \d+(\.\d+)? kg × \d+ next time$/)).toBeTruthy();
    expect(squat.textContent).not.toMatch(/aim \d/);

    const plank = within(nextTime).getByText("Plank").closest("li")!;
    expect(plank.textContent).not.toMatch(/0 kg/);
    expect(within(plank).getByText(/^Next: 45 s$/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/\b0 kg/);
  });

  it("the second workout of the week says the week counts", async () => {
    await strength("2026-11-09T06:00:00.000Z", { pick: 20 });
    const id = await strength("2026-11-11T06:00:00.000Z", { pick: 20 });
    renderSummary(id);
    expect(await screen.findByRole("heading", { level: 1, name: "Session B done." })).toBeTruthy();
    expect(screen.getByText("2 of 4 done")).toBeTruthy();
    expect(screen.getByText("Minimum done ✓")).toBeTruthy();
  });

  it("puts Done in the dock, outside the scrolling page, and goes back to Today", async () => {
    const id = await strength("2026-11-09T06:00:00.000Z", { pick: 20 });
    renderSummary(id);
    await screen.findByRole("heading", { level: 1, name: "Session A done." });
    const done = screen.getByRole("button", { name: "Done" });
    expect(done.closest("main")).toBeNull();
    fireEvent.click(done);
    expect(where()).toBe("/");
  });
});

describe("Summary · cardio and edge cases", () => {
  it("cardio says what was logged, without set tiles or the fuel line", async () => {
    const id = await cardio("2026-11-09T06:00:00.000Z");
    const { container } = renderSummary(id);
    expect(await screen.findByRole("heading", { level: 1, name: "Cardio done." })).toBeTruthy();
    expect(screen.getByText("Cardio logged")).toBeTruthy();
    expect(await screen.findByText("Bike · 26 min · hard 8 min")).toBeTruthy();
    expect(tiles(container)).toEqual([]);
    expect(screen.queryByText("Now fuel.")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Next time" })).toBeNull();
    expect(screen.getByText("1 of 4 done")).toBeTruthy();
  });

  it("an unknown session is explained calmly with a way back", async () => {
    at("2026-11-09T08:00:00.000Z");
    renderSummary("01JUNKNOWNSESSION0000000000");
    expect(await screen.findByText("This session is not on this phone.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to Today" }));
    expect(where()).toBe("/");
  });
});
