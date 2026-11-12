/**
 * Today (screens/Home) with the real engine over fake-indexeddb: the next workout up front with one start
 * button, the resume and done states, the week strip, cardio, and a calm engine error.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Engine from "@gym/engine";

const engineOverride = vi.hoisted(() => ({ fail: false }));

vi.mock("@gym/engine", async (importOriginal) => {
  const real = await importOriginal<typeof Engine>();
  return {
    ...real,
    computeState: (ctx: Engine.EngineContext) => {
      if (engineOverride.fail) throw new Error("program.json is invalid");
      return real.computeState(ctx);
    },
  };
});

import { HomeScreen } from "../../src/screens/Home";
import { at, BLOCK_DAY_ONE, cardio, renderApp, resetApp, strength, teardownApp, where } from "./helpers";

const renderHome = () => renderApp("/", { "/": <HomeScreen /> });
const hero = () => screen.findByRole("region", { name: "Workout" });

beforeEach(async () => {
  engineOverride.fail = false;
  await resetApp(BLOCK_DAY_ONE);
});
afterEach(teardownApp);

describe("Today · the next workout", () => {
  it("opens on week 1 with Session A up front and one start button that leads to /workout", async () => {
    const { container } = renderHome();
    const card = await hero();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Week 1 / 12");
    expect(screen.getByText("Monday 9 November")).toBeTruthy();
    expect(within(card).getByText("Next workout · Session A")).toBeTruthy();
    expect(within(card).getByRole("heading", { name: "Squat + bench" })).toBeTruthy();
    expect(within(card).getByText("6 exercises")).toBeTruthy();
    expect(within(card).getByText(/about 55 min/)).toBeTruthy();
    // What this part of the 12 weeks is for, in plain words.
    expect(within(card).getByText(/^Easy on purpose\./)).toBeTruthy();
    expect(container.textContent).not.toMatch(/\bRIR\b|e1RM|deload|★/i);

    fireEvent.click(within(card).getByRole("button", { name: "Start workout" }));
    expect(where()).toBe("/workout");
  });

  it("every exercise in the hero opens its how-to", async () => {
    renderHome();
    const card = await hero();
    const names = within(card)
      .getAllByRole("button", { name: /^How to do / })
      .map((b) => b.getAttribute("aria-label")!.replace("How to do ", ""));
    expect(names).toHaveLength(6);
    expect(names.slice(0, 2)).toEqual(["Back squat", "Bench press"]);
    fireEvent.click(within(card).getByRole("button", { name: "How to do Back squat" }));
    const sheet = await screen.findByRole("dialog", { name: "Back squat" });
    expect(within(sheet).getByRole("button", { name: /^Watch the video/ })).toBeTruthy();
  });

  it("offers the short version one tap away", async () => {
    renderHome();
    const card = await hero();
    fireEvent.click(within(card).getByRole("button", { name: "Short on time? 30 min version" }));
    expect(where()).toBe("/workout?mode=short");
  });

  it("leads with the short version in the evening, full one tap away", async () => {
    at("2026-11-09T18:30:00.000Z"); // Monday 19:30 in Stockholm
    const first = renderHome();
    let card = await hero();
    expect(within(card).queryByRole("button", { name: "Start workout" })).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Start · 30 min version" }));
    expect(where()).toBe("/workout?mode=short");
    first.unmount();

    renderHome();
    card = await hero();
    fireEvent.click(within(card).getByRole("button", { name: "Full 55 min instead" }));
    expect(where()).toBe("/workout?mode=full");
  });

  it("three days after the last workout it nudges without guilt: the short version is enough today", async () => {
    await strength("2026-11-09T06:00:00.000Z", { exercises: 3 });
    at("2026-11-12T11:00:00.000Z");
    const { container } = renderHome();
    const card = await hero();
    expect(within(card).getByText("Next workout · Session B")).toBeTruthy();
    expect(within(card).getByText("Keep it rolling. Even the 30 min version is enough today.")).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Start · 30 min version" })).toBeTruthy();
    expect(container.textContent).not.toMatch(/failed|missed|never miss twice|★/i);
  });

  it("after a week off it welcomes Peter back with the engine's easing in", async () => {
    // A on Mon 9 Nov, B on Wed 11 Nov, then nothing until Wed 18 Nov at noon.
    await strength("2026-11-09T06:00:00.000Z", { exercises: 3 });
    await strength("2026-11-11T06:00:00.000Z", { exercises: 3 });
    at("2026-11-18T11:00:00.000Z");
    const { container } = renderHome();
    const card = await hero();
    expect(within(card).getByText("Next workout · Session C")).toBeTruthy();
    expect(within(card).getByText(/^Welcome back\. Weights at 85% for 7 days to ease in\.$/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/failed|missed/i);
  });
});

describe("Today · a workout in progress", () => {
  it("shows the resume state and leads back into the workout", async () => {
    await strength("2026-11-09T06:00:00.000Z", { exercises: 1, open: true });
    renderHome();
    const card = await hero();
    expect(within(card).getByText("In progress")).toBeTruthy();
    expect(within(card).getByRole("heading", { name: "Squat + bench" })).toBeTruthy();
    expect(within(card).getByText("Your sets are saved. Pick up where you left off.")).toBeTruthy();
    expect(within(card).queryByRole("button", { name: /^Start/ })).toBeNull();
    // The day shows as open in the week strip, not as done.
    const week = screen.getByRole("region", { name: "This week" });
    expect(within(week).getByLabelText("2026-11-09: session A, in progress").textContent).toBe("A");

    fireEvent.click(within(card).getByRole("button", { name: "Resume workout" }));
    expect(where()).toBe("/workout");
  });
});

describe("Today · done for today", () => {
  it("says so, names what is next and links to today's summary; no second start", async () => {
    const id = await strength("2026-11-09T06:00:00.000Z");
    renderHome();
    const card = await hero();
    expect(within(card).getByText("Done today")).toBeTruthy();
    expect(within(card).getByRole("heading", { name: "Workout logged" })).toBeTruthy();
    expect(within(card).getByText(/^Next up: Hinge \+ overhead, tomorrow or whenever it fits\./)).toBeTruthy();
    expect(within(card).queryByRole("button", { name: /^(Start|Resume)/ })).toBeNull();
    expect(within(card).queryByRole("button", { name: /^How to do/ })).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "See today's summary" }));
    expect(where()).toBe(`/summary/${id}`);
  });
});

describe("Today · the week strip", () => {
  it("starts empty with what keeps the streak alive", async () => {
    renderHome();
    const week = await screen.findByRole("region", { name: "This week" });
    expect(within(week).getByText("0 of 3 workouts · 0 of 1 cardio")).toBeTruthy();
    const days = within(week).getAllByLabelText(/^2026-11-\d\d/);
    expect(days.map((d) => d.getAttribute("aria-label"))).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
    expect(within(week).getByText("2 workouts are this week's minimum. Even one keeps the streak alive.")).toBeTruthy();
    expect(week.textContent).not.toMatch(/floor/i);
  });

  it("marks each day's session and cardio, and says when the minimum is done", async () => {
    await strength("2026-11-09T06:00:00.000Z");
    await strength("2026-11-11T06:00:00.000Z");
    await cardio("2026-11-12T16:00:00.000Z");
    at("2026-11-13T07:00:00.000Z");
    renderHome();
    const week = await screen.findByRole("region", { name: "This week" });
    expect(within(week).getByText("2 of 3 workouts · 1 of 1 cardio")).toBeTruthy();
    expect(within(week).getByLabelText("2026-11-09: session A").textContent).toBe("A");
    expect(within(week).getByLabelText("2026-11-11: session B").textContent).toBe("B");
    expect(within(week).getByLabelText("2026-11-12: cardio")).toBeTruthy();
    expect(within(week).getByLabelText("2026-11-13")).toBeTruthy();
    expect(within(week).getByText("Minimum done. 1 more workout makes it a full week.")).toBeTruthy();
    // The streak counts the week as soon as it has a session.
    expect(screen.getByText("Week streak")).toBeTruthy();
  });
});

describe("Today · cardio", () => {
  it("offers this week's cardio and leads to /cardio", async () => {
    renderHome();
    const row = await screen.findByRole("region", { name: "Cardio" });
    expect(within(row).getByText("Cardio this week")).toBeTruthy();
    expect(within(row).getByText("4 × 2 min hard / 2 min easy · 26 min")).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: "Start" }));
    expect(where()).toBe("/cardio");
  });

  it("once the week's cardio is done, more is a bonus", async () => {
    await cardio("2026-11-09T06:00:00.000Z");
    renderHome();
    const row = await screen.findByRole("region", { name: "Cardio" });
    expect(within(row).getByText("Cardio done this week")).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Bonus" })).toBeTruthy();
  });
});

describe("Today · engine error", () => {
  it("shows a calm message and that the log is safe", async () => {
    await strength("2026-11-09T06:00:00.000Z", { exercises: 1, open: true });
    engineOverride.fail = true;
    renderHome();
    expect(await screen.findByText("Today could not be planned")).toBeTruthy();
    expect(await screen.findByText(/\d+ sets? saved/)).toBeTruthy();
    expect(screen.getByText(/Your log is safe on this phone/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save a backup" })).toBeTruthy();
    await waitFor(() => expect(document.body.textContent).not.toMatch(/failed/i));
  });
});
