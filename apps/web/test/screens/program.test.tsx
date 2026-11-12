/**
 * Program tab against the real engine and Dexie: the sessions of the rotation with a how-to for every
 * exercise, how the block works, this week with the calendar booking, the 12 weeks and the edits.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../src/data";
import { guideFor } from "../../src/lib/guides";
import { MAIN_LIFT_NOTE } from "../../src/screens/plan/EditBlock";
import { ProgramScreen } from "../../src/screens/Program";
import { at, BLOCK_DAY_ONE, renderApp, resetApp, settingsRow, strength, teardownApp, where } from "./helpers";

const SUNDAY_BEFORE = "2026-11-08T10:00:00.000Z";
const renderProgram = () => renderApp("/program", { "/program": <ProgramScreen /> });

const sessions = () => screen.findByRole("region", { name: "Sessions" });
const exerciseNames = (el: HTMLElement) =>
  within(el)
    .getAllByRole("button", { name: /^How to do / })
    .map((b) => b.getAttribute("aria-label")!.replace("How to do ", ""));
const weekRows = () => screen.getAllByRole("listitem").filter((li) => /^Week \d+, /.test(li.getAttribute("aria-label") ?? ""));

beforeEach(() => resetApp(BLOCK_DAY_ONE));
afterEach(teardownApp);

describe("Program · the sessions", () => {
  it("has a tab per session and opens on the next one in line", async () => {
    renderProgram();
    expect(await screen.findByRole("heading", { level: 1, name: "Program" })).toBeTruthy();
    const card = await sessions();
    const tabs = within(within(card).getByRole("radiogroup", { name: "Session" })).getAllByRole("radio");
    expect(tabs.map((t) => [t.textContent, t.getAttribute("aria-checked")])).toEqual([
      ["A", "true"],
      ["B", "false"],
      ["C", "false"],
      ["Travel", "false"],
    ]);
    expect(await within(card).findByRole("heading", { level: 2, name: "Squat + bench" })).toBeTruthy();
    expect(within(card).getByText(/^Session A/).textContent).toBe("Session A · next in line");
    expect(exerciseNames(card)).toEqual(["Back squat", "Bench press", "Chest-supported dumbbell row", "Romanian deadlift", "Dumbbell lateral raise", "Plank"]);
    // The three lifts of the 30 min version are marked in words, and the effort is in plain words.
    expect(within(card).getAllByText(/· short version too$/)).toHaveLength(3);
    expect(within(card).getByText(/^About 55 min · leave 3 in the tank\./)).toBeTruthy();
    expect(card.textContent).not.toMatch(/\bRIR\b|e1RM|★/);
  });

  it("switches between A, B, C and Travel", async () => {
    renderProgram();
    const card = await sessions();
    await within(card).findByRole("heading", { level: 2, name: "Squat + bench" });

    fireEvent.click(within(card).getByRole("radio", { name: "B" }));
    expect(await within(card).findByRole("heading", { level: 2, name: "Hinge + overhead" })).toBeTruthy();
    expect(exerciseNames(card)).toContain("Trap bar deadlift");
    expect(within(card).getByText("Session B")).toBeTruthy();
    expect(within(card).queryByText(/next in line/)).toBeNull();
    expect(within(card).queryByRole("button", { name: "Open this workout" })).toBeNull();

    fireEvent.click(within(card).getByRole("radio", { name: "C" }));
    await waitFor(() => expect(within(card).getByText("Session C")).toBeTruthy());
    expect(exerciseNames(card)).not.toContain("Trap bar deadlift");

    fireEvent.click(within(card).getByRole("radio", { name: "Travel" }));
    expect(await within(card).findByRole("heading", { level: 2, name: "Travel workout" })).toBeTruthy();
    expect(within(card).getByText("Hotel gym or dumbbells")).toBeTruthy();
    expect(exerciseNames(card).length).toBeGreaterThan(2);
    // The short version does not apply to the travel workout.
    expect(within(card).queryByText(/short version too/)).toBeNull();
  });

  it("every exercise row opens its guide", async () => {
    renderProgram();
    const card = await sessions();
    fireEvent.click(await within(card).findByRole("button", { name: "How to do Bench press" }));
    const sheet = await screen.findByRole("dialog", { name: "Bench press" });
    expect(within(sheet).getByText(guideFor("bench_press")!.what)).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: /^Watch the video/ })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(within(card).getByRole("button", { name: "How to do Plank" }));
    expect(await screen.findByRole("dialog", { name: "Plank" })).toBeTruthy();
  });

  it("Open this workout leads to the workout; after today's session the next tab has no button", async () => {
    const first = renderProgram();
    fireEvent.click(await screen.findByRole("button", { name: "Open this workout" }));
    expect(where()).toBe("/workout");
    first.unmount();

    await strength("2026-11-09T06:00:00.000Z");
    at("2026-11-09T12:00:00.000Z");
    renderProgram();
    const card = await sessions();
    // Session A is done: B is next in line, but not today.
    expect(await within(card).findByRole("heading", { level: 2, name: "Hinge + overhead" })).toBeTruthy();
    expect(within(card).getByText(/^Session B/).textContent).toBe("Session B · next in line");
    expect(within(card).queryByRole("button", { name: "Open this workout" })).toBeNull();
  });
});

describe("Program · how it works and the 12 weeks", () => {
  it("explains the program in plain words, with the first topic open", async () => {
    renderProgram();
    const how = await screen.findByRole("region", { name: "How it works" });
    const topics = [...how.querySelectorAll("details")];
    expect(topics.map((d) => d.querySelector("summary")!.textContent)).toEqual(["What gets you ripped", "The weekly deal", "How the weights go up", "How hard to push", "Short on time"]);
    expect(topics.map((d) => d.open)).toEqual([true, false, false, false, false]);
    expect(within(how).getByText(/^3 workouts and 1 cardio is a full week\. 2 workouts is the minimum and keeps the streak\./)).toBeTruthy();
    expect(how.textContent).not.toMatch(/\bRIR\b|e1RM|\bfloor\b|deload/i);
  });

  it("shows the 12 weeks with week 1 as this week", async () => {
    renderProgram();
    const block = await screen.findByRole("region", { name: "The 12 weeks" });
    const rows = within(block).getAllByRole("listitem");
    expect(rows).toHaveLength(12);
    expect(rows[0]!.getAttribute("aria-label")).toMatch(/^Week 1, .+, this week: 0 of 4$/);
    expect(rows[0]!.getAttribute("aria-current")).toBe("true");
    expect(rows[11]!.getAttribute("aria-label")).toMatch(/^Week 12, .+, ahead$/);
    expect(within(block).getByText("A paused week never uses up the block. The block simply runs a week longer.")).toBeTruthy();
  });

  it("shows a paused week calmly and the minimum as reached", async () => {
    // Week 1 (9 Nov): two sessions. Week 2 (16 Nov): nothing. Now: Tuesday 24 Nov, 05:00 local.
    await strength("2026-11-09T06:00:00.000Z", { exercises: 3 });
    await strength("2026-11-11T06:00:00.000Z", { exercises: 3 });
    at("2026-11-24T04:00:00.000Z");
    renderProgram();
    await screen.findByRole("region", { name: "The 12 weeks" });
    const rows = weekRows();
    // 3 calendar weeks so far (training weeks 1, 2, 2) + training weeks 3 to 12 ahead.
    expect(rows).toHaveLength(13);
    expect(rows[0]!.getAttribute("aria-label")).toMatch(/: Minimum ✓$/);
    expect(rows[1]!.getAttribute("aria-label")).toMatch(/: Paused week · block extended$/);
    expect(rows[2]!.getAttribute("aria-label")).toMatch(/^Week 2, .+, this week: /);
    expect(screen.getByText(/It runs 1 week longer, nothing to catch up\./)).toBeTruthy();
    // Booking: this week, with today still open before 07:00.
    expect(screen.getByText("Book your two must-do workouts")).toBeTruthy();
    expect(screen.getByText(/^This week: two sessions in the calendar are the week\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Tue 24 Nov, booked/ })).toBeTruthy();
  });
});

describe("Program · this week (Sunday 8 Nov, before the block starts)", () => {
  beforeEach(() => at(SUNDAY_BEFORE));

  it("offers the two must-do workouts on Monday and Wednesday at 07:00 with calendar links", async () => {
    const { container } = renderProgram();
    await screen.findByText("Book your two must-do workouts");
    const ics = () => [...container.querySelectorAll<HTMLAnchorElement>('a[href^="/api/ics"]')].map((a) => a.getAttribute("href")!);
    expect(ics()).toHaveLength(2);
    expect(ics()[0]).toContain("start=2026-11-09T07%3A00%3A00%2B01%3A00");
    expect(ics()[0]).toContain("title=Workout%20%C2%B7%20Session%20A");
    expect(ics()[0]).toContain("minutes=55");
    expect(ics()[1]).toContain("start=2026-11-11T07%3A00%3A00%2B01%3A00");
    expect(ics()[1]).toContain("Session%20B");
    expect(container.querySelectorAll('a[href^="https://calendar.google.com"]')).toHaveLength(2);

    // Inline edits: another time and another day.
    fireEvent.click(screen.getByRole("radio", { name: "17:00" }));
    fireEvent.click(screen.getByRole("button", { name: /Wed 11 Nov/ })); // unpick Wednesday
    fireEvent.click(screen.getByRole("button", { name: /Thu 12 Nov/ }));
    await waitFor(() => {
      expect(ics()).toHaveLength(2);
      expect(ics()[0]).toContain("start=2026-11-09T17%3A00%3A00%2B01%3A00");
      expect(ics()[1]).toContain("start=2026-11-12T17%3A00%3A00%2B01%3A00");
    });
  });

  it("logs a walk and undoes it", async () => {
    renderProgram();
    fireEvent.click(await screen.findByRole("button", { name: "Log a 20 minute walk" }));
    await screen.findByText("Walk logged · 20 min");
    const walks = (await db.cardio_log.toArray()).filter((c) => !c.deleted_at);
    expect(walks).toHaveLength(1);
    expect(walks[0]).toMatchObject({ modality: "walk", minutes: 20, session_id: null, date: "2026-11-08" });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(async () => expect((await db.cardio_log.toArray()).filter((c) => !c.deleted_at)).toHaveLength(0));
  });
});

describe("Program · edits", () => {
  it("swaps a non main lift for the block and keeps main lifts locked", async () => {
    renderProgram();
    const edit = await screen.findByRole("region", { name: "Edit" });
    await within(edit).findByText("Swap for the block");
    fireEvent.click(within(edit).getByRole("radio", { name: "Session B" }));
    fireEvent.click(await within(edit).findByRole("button", { name: /Pull-up/ }));
    const group = await within(edit).findByRole("radiogroup", { name: /Pull-up this block/ });
    expect(within(group).getByRole("radio", { name: /Pull-up, program exercise/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(group).getByRole("radio", { name: /Lat pulldown/ }));
    await waitFor(async () => expect((await settingsRow()).block_swaps).toEqual({ B3: "lat_pulldown" }));

    // The sessions card above follows the swap.
    fireEvent.click(within(await sessions()).getByRole("radio", { name: "B" }));
    await waitFor(async () => expect(exerciseNames(await sessions())).toContain("Lat pulldown"));

    // Back to the program exercise removes the swap.
    const after = await within(edit).findByRole("radiogroup", { name: /Pull-up this block/ });
    await waitFor(() => expect(within(after).getByRole("radio", { name: /^Lat pulldown/ }).getAttribute("aria-checked")).toBe("true"));
    fireEvent.click(within(after).getByRole("radio", { name: /Pull-up, program exercise/ }));
    await waitFor(async () => expect((await settingsRow()).block_swaps).toEqual({}));

    // Main lift: the one line explanation, no options.
    fireEvent.click(within(edit).getByRole("button", { name: /Trap bar deadlift/ }));
    expect((await within(edit).findAllByText(MAIN_LIFT_NOTE)).length).toBeGreaterThan(0);
    expect(within(edit).queryByRole("radiogroup", { name: /Trap bar deadlift this block/ })).toBeNull();
  });

  it("changes the session order, and the next session in line follows", async () => {
    renderProgram();
    fireEvent.click(await screen.findByRole("button", { name: "Move session A later" }));
    await waitFor(async () => expect((await settingsRow()).session_order).toEqual(["B", "A", "C"]));
    fireEvent.click(await screen.findByRole("button", { name: "Reset" }));
    await waitFor(async () => expect((await settingsRow()).session_order).toEqual(["A", "B", "C"]));
  });
});
