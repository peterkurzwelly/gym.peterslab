/**
 * Cardio (screens/Cardio) with the real engine: the overview says what the session is, Start cardio opens
 * the timer and log panel, and saving lands on the summary.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../src/data";
import { CardioScreen } from "../../src/screens/Cardio";
import { SummaryScreen } from "../../src/screens/Summary";
import { at, BLOCK_DAY_ONE, cardio, liveSessions, renderApp, resetApp, strength, teardownApp, where } from "./helpers";

const renderCardio = () => renderApp("/cardio", { "/cardio": <CardioScreen />, "/summary/:sessionId": <SummaryScreen /> });
const liveCardio = async () => (await db.cardio_log.toArray()).filter((c) => !c.deleted_at);

beforeEach(() => resetApp(BLOCK_DAY_ONE));
afterEach(teardownApp);

describe("Cardio", () => {
  it("the overview explains the session and starts nothing", async () => {
    const { container } = renderCardio();
    expect(await screen.findByRole("heading", { level: 1, name: "Intervals" })).toBeTruthy();
    expect(screen.getByText("Counts toward this week")).toBeTruthy();
    const structure = screen.getByRole("region", { name: "Session structure" });
    const rows = within(structure).getAllByRole("listitem").map((li) => li.textContent);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatch(/^Warm up, easy\d+ min$/);
    expect(rows[1]).toMatch(/^\d+ rounds: \d+ min hard, \d+ min easy\d+ min$/);
    expect(rows[2]).toMatch(/^Cool down, easy\d+ min$/);
    expect(screen.getByText("How hard is hard")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start cardio" })).toBeTruthy();
    // No timer or log form until it is started.
    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save cardio" })).toBeNull();
    expect(container.textContent).not.toMatch(/\bRIR\b|e1RM|deload/i);
    expect(await liveSessions()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(where()).toBe("/");
  });

  it("Start cardio opens the timer panel; logging without the timer saves and lands on the summary", async () => {
    renderCardio();
    fireEvent.click(await screen.findByRole("button", { name: "Start cardio" }));

    // The session exists from here on, and the overview makes room for the timer.
    expect(await screen.findByRole("timer")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Session structure" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Start cardio" })).toBeNull();
    const [s] = await liveSessions();
    expect(s).toMatchObject({ program_day_id: "CARDIO", ended_at: null });

    fireEvent.click(screen.getByRole("button", { name: "Log without timer" }));
    at("2026-11-09T07:30:00.000Z");
    fireEvent.click(await screen.findByRole("button", { name: "Save cardio" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Cardio done." })).toBeTruthy();
    expect(where()).toBe(`/summary/${s!.id}`);
    const logs = await liveCardio();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ session_id: s!.id, intensity: "hard", source: "manual" });
    expect(logs[0]!.minutes).toBeGreaterThan(0);
    expect(logs[0]!.hard_minutes).toBeGreaterThan(0);
    expect((await liveSessions())[0]!.ended_at).not.toBeNull();
  });

  it("discarding before the timer starts removes the session and goes back to Today", async () => {
    renderCardio();
    fireEvent.click(await screen.findByRole("button", { name: "Start cardio" }));
    await screen.findByRole("timer");
    expect(await liveSessions()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Discard cardio" }));
    await waitFor(() => expect(where()).toBe("/"));
    expect(await liveSessions()).toHaveLength(0);
    expect(await liveCardio()).toHaveLength(0);
  });

  it("a cardio session left open comes back in the panel, not the overview", async () => {
    const first = renderCardio();
    fireEvent.click(await screen.findByRole("button", { name: "Start cardio" }));
    await screen.findByRole("timer");
    first.unmount();

    renderCardio();
    expect(await screen.findByRole("timer")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start cardio" })).toBeNull();
    expect(await liveSessions()).toHaveLength(1);
  });

  it("with a workout still open, it points back to the workout instead of starting cardio", async () => {
    await strength("2026-11-09T06:30:00.000Z", { exercises: 1, open: true, pick: 20 });
    at(BLOCK_DAY_ONE);
    renderCardio();
    expect(await screen.findByText(/^Your workout is still open\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start cardio" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to your workout" }));
    expect(where()).toBe("/workout");
    expect(await liveSessions()).toHaveLength(1);
  });

  it("once this week's cardio is done, another one is a bonus", async () => {
    await cardio("2026-11-09T06:00:00.000Z");
    at("2026-11-11T07:00:00.000Z");
    renderCardio();
    expect(await screen.findByText("Bonus session")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start cardio" })).toBeTruthy();
    // Easy cardio has no warm up or cool down: no "0 min" rows, and the minutes are said once.
    expect(screen.getByRole("heading", { level: 1, name: "Easy cardio" })).toBeTruthy();
    const rows = within(screen.getByRole("region", { name: "Session structure" })).getAllByRole("listitem").map((li) => li.textContent);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatch(/^Steady, conversation pace\d+ min$/);
    expect(screen.getByText(/^\d+ min easy · /).textContent).not.toMatch(/easy · \d+ min/);
  });
});
