/**
 * Progress tab against the real engine and Dexie (fake-indexeddb), charts included (Recharts in jsdom):
 * leaner (body), stronger (numbers and charts), consistent (weeks trained), heads up and the weekly review.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { computeState } from "@gym/engine";
import { db, loadContext, logWalk, saveBodyLog, saveCheckin } from "../../src/data";
import * as repo from "../../src/data/repo";
import { ProgressScreen } from "../../src/screens/Progress";
import { at, BLOCK_DAY_ONE, cardio, completeProfile, renderApp, resetApp, strength, teardownApp } from "./helpers";

const SUNDAY_BEFORE = "2026-11-08T10:00:00.000Z";
const renderProgress = () => renderApp("/progress", { "/progress": <ProgressScreen /> });
const sectionNames = () => screen.getAllByRole("region").map((r) => r.getAttribute("aria-labelledby") && document.getElementById(r.getAttribute("aria-labelledby")!)?.textContent).filter(Boolean);

beforeAll(() => {
  // Recharts measures its container; jsdom has no ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => resetApp(BLOCK_DAY_ONE));
afterEach(teardownApp);

describe("Progress · first day", () => {
  it("is calm with nothing logged: plain labels, no charts, no heads up", async () => {
    const { container } = renderProgress();
    expect(await screen.findByRole("heading", { level: 1, name: "Progress" })).toBeTruthy();
    expect(sectionNames()).toEqual(["Leaner", "Stronger", "Consistent", "Weekly review"]);

    // Consistent: weeks trained, in words anyone reads.
    const consistent = screen.getByRole("region", { name: "Consistent" });
    expect(within(consistent).getByLabelText("Weeks trained: 0 of 12")).toBeTruthy();
    for (const label of ["Minimum hit", "Full weeks", "In a row", "Best streak"]) expect(within(consistent).getByText(label)).toBeTruthy();
    expect(within(consistent).getByText(/^One workout makes a week count\./)).toBeTruthy();
    expect(within(consistent).getByText("Since day one")).toBeTruthy();

    // Stronger: four numbers, one calm card instead of empty charts.
    const stronger = screen.getByRole("region", { name: "Stronger" });
    for (const label of ["This week", "Sets per muscle", "Active minutes", "Strength"]) expect(within(stronger).getByText(label)).toBeTruthy();
    expect(within(stronger).getByText("0 of 4")).toBeTruthy();
    expect(within(stronger).getByText("Minimum is 2 workouts")).toBeTruthy();
    expect(within(stronger).getByText(/^Nothing to draw yet, and that is fine\./)).toBeTruthy();
    expect(within(stronger).getByText("· Estimated max on your main lifts")).toBeTruthy();
    expect(container.querySelector(".recharts-wrapper")).toBeNull();

    // No flags: the section is not there at all.
    expect(screen.queryByRole("region", { name: "Heads up" })).toBeNull();
    expect(screen.queryByText("Heads up")).toBeNull();

    // The weekly review waits, folded, on a weekday.
    expect(within(screen.getByRole("region", { name: "Weekly review" })).getByRole("button", { name: "Open the review" })).toBeTruthy();
    // Copy rules: no shorthand, no red words.
    expect(container.textContent).not.toMatch(/\bRIR\b|e1RM|failed|missed/i);
  });

  it("on Sunday the review leads and books the first week", async () => {
    at(SUNDAY_BEFORE);
    const { container } = renderProgress();
    expect(await screen.findByText("Two minutes for the week.")).toBeTruthy();
    expect(sectionNames()[0]).toBe("Leaner"); // the review section carries its own label
    expect(screen.getAllByRole("region")[0]!.getAttribute("aria-label")).toBe("Weekly review");
    expect(screen.getByText(/The block starts Mon 9 Nov/)).toBeTruthy();
    expect(screen.getByText("Book your two must-do workouts")).toBeTruthy();
    const ics = [...container.querySelectorAll<HTMLAnchorElement>('a[href^="/api/ics"]')].map((a) => a.getAttribute("href")!);
    expect(ics[0]).toContain("start=2026-11-09T07%3A00%3A00%2B01%3A00");
  });
});

describe("Progress · leaner", () => {
  it("without the four numbers it offers the setup, and the setup opens the profile sheet", async () => {
    renderProgress();
    const leaner = await screen.findByRole("region", { name: "Leaner" });
    const setup = within(leaner).getByRole("region", { name: "Fat loss targets" });
    expect(within(setup).getByRole("heading", { name: "Set your fat loss targets" })).toBeTruthy();
    expect(within(leaner).queryByRole("region", { name: "Body weight" })).toBeNull();
    fireEvent.click(within(setup).getByRole("button", { name: /^Set up/ }));
    expect(await screen.findByRole("dialog", { name: "You and your goal" })).toBeTruthy();
  });

  it("with one weigh-in it shows the latest weight and this week's habits", async () => {
    await completeProfile(85);
    await saveBodyLog("2026-11-09", { protein_g: 170, steps: 9000 });
    renderProgress();
    const leaner = await screen.findByRole("region", { name: "Leaner" });
    const weight = await within(leaner).findByRole("region", { name: "Body weight" });
    expect(within(weight).getByText("Weight · latest")).toBeTruthy();
    expect(within(weight).getByText("85.0")).toBeTruthy();
    expect(within(weight).getByText("Collecting")).toBeTruthy();
    for (const label of ["Total", "Per week", "Waist"]) expect(within(weight).getByText(label)).toBeTruthy();
    expect(within(leaner).queryByRole("region", { name: "Fat loss targets" })).toBeNull();

    const habits = within(leaner).getByRole("region", { name: "Habits this week" });
    expect(within(habits).getByText("Protein days").parentElement!.textContent).toMatch(/^1\/ 1Protein days$/);
    expect(within(habits).getByText("Steps a day").parentElement!.textContent).toMatch(/^9\s000Steps a day$/);
    expect(within(habits).getByText("Weigh-ins").parentElement!.textContent).toMatch(/^1\/ 1Weigh-ins$/);
    expect(within(habits).getByText(/kcal a day$/)).toBeTruthy();

    // Weighed today already: the button changes it, in a sheet.
    fireEvent.click(within(weight).getByRole("button", { name: "Change today's weight" }));
    expect(await screen.findByRole("dialog", { name: "Body weight" })).toBeTruthy();
  });

  it("with a week of weigh-ins it shows the trend, the pace and the goal", async () => {
    await completeProfile(86, "2026-11-09");
    for (const [date, kg] of [["2026-11-11", 85.6], ["2026-11-13", 85.4], ["2026-11-16", 85.0], ["2026-11-18", 84.8], ["2026-11-20", 84.6]] as const) await saveBodyLog(date, { weight_kg: kg });
    await repo.updateSettings({ goal_weight_kg: 80 });
    at("2026-11-21T08:00:00.000Z");
    renderProgress();
    const weight = await screen.findByRole("region", { name: "Body weight" });
    expect(within(weight).getByText("Weight · 7 day trend")).toBeTruthy();
    // Not weighed today: the button logs it. With a goal weight the third number is about the goal.
    expect(within(weight).getByRole("button", { name: "Log today's weight" })).toBeTruthy();
    expect(within(weight).getByText(/^(Goal in|To goal)$/)).toBeTruthy();
    expect(within(weight).queryByText("Waist")).toBeNull();
    expect(within(weight).getByText(/^(On pace|Slower than plan|Faster than plan|Off course)$/)).toBeTruthy();
    fireEvent.click(within(weight).getByRole("button", { name: "Goal" }));
    expect(await screen.findByRole("dialog", { name: "You and your goal" })).toBeTruthy();
  });
});

describe("Progress · with history", () => {
  it("shows weeks trained, totals, charts and a repair for the paused week", { timeout: 30_000 }, async () => {
    // Week 1 (9 Nov): A, B, cardio. Week 2: paused. Week 3 (23 Nov): A. Now: Sunday 29 Nov.
    await saveCheckin({ date: "2026-11-09", sleep: 4, soreness: 4, stress: 3, energy: 4 });
    await strength("2026-11-09T06:00:00.000Z");
    await strength("2026-11-11T06:00:00.000Z");
    await cardio("2026-11-14T09:00:00.000Z");
    at("2026-11-12T11:00:00.000Z");
    await logWalk("2026-11-12", 40);
    await strength("2026-11-25T06:00:00.000Z");
    at("2026-11-29T09:00:00.000Z");

    const { container } = renderProgress();
    await screen.findByLabelText(/Weeks trained: \d+ of 12/);
    const state = computeState(await loadContext("2026-11-29T09:00:00.000Z"));
    expect(screen.getByLabelText(`Weeks trained: ${state.streak.weeks_without_zero} of 12`)).toBeTruthy();
    expect(state.weeks[1]!.status).toBe("zero");

    // Totals that never reset.
    expect(screen.getByText("Since day one")).toBeTruthy();
    expect(screen.getByText("Workouts")).toBeTruthy();
    expect(screen.getAllByText(String(state.totals.sessions)).length).toBeGreaterThan(0);
    expect(screen.getByText("Plus 40 min walking.")).toBeTruthy();
    // This week: one workout. The tile counts cardio too, so it says what counts toward the minimum.
    expect(screen.getByText("1 of 2 workouts for the minimum")).toBeTruthy();

    // Sunday: the review leads. The comeback session holds loads, so nothing moved up.
    expect(screen.getByText("Two minutes for the week.")).toBeTruthy();
    expect(screen.getByText(/^Not yet\. /)).toBeTruthy();
    expect(screen.getByText(/No weights went up this week/)).toBeTruthy();
    // Last week was paused: calm words.
    fireEvent.click(screen.getByRole("radio", { name: "Last week" }));
    await screen.findByText("Paused week. The block extends, nothing to catch up.");

    // Charts load lazily and render, labelled in plain words.
    // The chart chunk is a dynamic import; the first transform of Recharts can take a while under a parallel run.
    await waitFor(() => expect(container.querySelector(".recharts-wrapper")).not.toBeNull(), { timeout: 15_000 });
    expect(screen.queryByText(/^Nothing to draw yet/)).toBeNull();
    expect(screen.getAllByText("Show table").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole("region", { name: "Stronger" }).textContent).not.toMatch(/e1RM|\bRIR\b/);

    // Repair the paused week (streak freeze), then undo.
    fireEvent.click(screen.getByRole("button", { name: "Repair" }));
    await waitFor(async () => expect((await db.training_week.get(state.weeks[1]!.id))?.repaired).toBe(true));
    await screen.findByText("Repaired · streak kept");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(async () => expect((await db.training_week.get(state.weeks[1]!.id))?.repaired).toBe(false));
  });

  it("Heads up appears only when the engine has something to flag", async () => {
    const id = await strength("2026-11-09T06:00:00.000Z");
    at("2026-11-10T08:00:00.000Z");
    expect(computeState(await loadContext("2026-11-10T08:00:00.000Z")).flags).toHaveLength(0);
    const first = renderProgress();
    await screen.findByLabelText("Weeks trained: 1 of 12");
    expect(screen.queryByRole("region", { name: "Heads up" })).toBeNull();
    first.unmount();

    // Pain on the bench press last time: the engine flags it, in plain words.
    await repo.setPain(id, "bench_press", true);
    const flags = computeState(await loadContext("2026-11-10T08:00:00.000Z")).flags;
    expect(flags.map((f) => f.kind)).toContain("pain");
    renderProgress();
    const heads = await screen.findByRole("region", { name: "Heads up" });
    expect(within(heads).getByText("Pain")).toBeTruthy();
    expect(within(heads).getByText("Bench press: pain logged last time. An alternative may feel better.")).toBeTruthy();
  });
});

describe("Progress · weekly review", () => {
  it("lists what moved up this week, main lifts first", async () => {
    await strength("2026-11-09T06:00:00.000Z"); // A: back squat, bench press
    await strength("2026-11-11T06:00:00.000Z"); // B: trap bar deadlift, overhead press
    at("2026-11-15T09:00:00.000Z");
    renderProgress();
    await screen.findByText("What moved up");
    expect(screen.getByText(/^Yes\. .+ the week counts\.$/)).toBeTruthy();
    const items = screen.getAllByRole("listitem").filter((li) => li.textContent?.startsWith("↑"));
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]!.textContent).toMatch(/Back squat|Bench press|deadlift|overhead press/i);
    expect(items[0]!.textContent).toMatch(/\+\d+(\.\d+)? kg/);
  });

  it("opens from its folded row on a weekday", async () => {
    await strength("2026-11-09T06:00:00.000Z");
    at("2026-11-10T08:00:00.000Z");
    renderProgress();
    const review = await screen.findByRole("region", { name: "Weekly review" });
    fireEvent.click(within(review).getByRole("button", { name: "Open the review" }));
    expect(within(review).getByRole("heading", { name: "The week in two minutes." })).toBeTruthy();
    expect(within(review).getByText("What moved up")).toBeTruthy();
  });
});
