/**
 * Workout (screens/Workout + workout/Player) with the real engine over fake-indexeddb: the overview with a
 * how-to for every exercise, then the full screen player. The first logged set creates the session, the dock
 * logs one set per tap, the rest timer follows, and finishing lands on the summary.
 */
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { db } from "../../src/data";
import * as repo from "../../src/data/repo";
import { guideFor } from "../../src/lib/guides";
import { SummaryScreen } from "../../src/screens/Summary";
import { WorkoutScreen } from "../../src/screens/Workout";
import { at, BLOCK_DAY_ONE, liveSessions, liveSets, renderApp, resetApp, strength, teardownApp, where } from "./helpers";

const renderWorkout = (path = "/workout") => renderApp(path, { "/workout": <WorkoutScreen />, "/summary/:sessionId": <SummaryScreen /> });

/** Week 1 with weights for the two main lifts of Session A, so their sets confirm in one tap. */
const rememberMainLifts = () => repo.updateSettings({ remembered_weights: { back_squat: { weight: 100, reps: 5 }, bench_press: { weight: 80, reps: 5 } } });

const exerciseNames = () =>
  within(screen.getByRole("region", { name: "Exercises" }))
    .getAllByRole("button", { name: /^How to do / })
    .map((b) => b.getAttribute("aria-label")!.replace("How to do ", ""));

/** The big dock button: "Log <exercise> set n" or "Pick weight for <exercise> set n". */
const dockButton = () => screen.findByRole("button", { name: /^(Log|Pick weight for) .+ (set \d+|top set)$/ });

async function startPlayer() {
  fireEvent.click(await screen.findByRole("button", { name: "Start workout" }));
  return screen.findByRole("article");
}

/** A Storage in memory, for tests that need localStorage. */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

beforeEach(() => resetApp(BLOCK_DAY_ONE));
afterEach(teardownApp);

describe("Workout · overview", () => {
  it("shows what the session is and lists every exercise, without starting anything", async () => {
    await rememberMainLifts();
    const { container } = renderWorkout();
    expect(await screen.findByRole("heading", { level: 1, name: "Squat + bench" })).toBeTruthy();
    expect(screen.getByText("Session A · Week 1 of 12")).toBeTruthy();
    expect(screen.getByText("6 exercises · about 55 min · leave 3 in the tank")).toBeTruthy();
    expect(exerciseNames()).toEqual(["Back squat", "Bench press", "Chest-supported dumbbell row", "Romanian deadlift", "Dumbbell lateral raise", "Plank"]);
    const list = screen.getByRole("region", { name: "Exercises" });
    // 60% of the remembered 100 kg; exercises without history ask for a weight.
    expect(within(within(list).getByRole("button", { name: "How to do Back squat" })).getByText("2 × 5–8 · 60 kg")).toBeTruthy();
    expect(within(within(list).getByRole("button", { name: "How to do Romanian deadlift" })).getByText(/pick a weight$/)).toBeTruthy();
    const versions = within(screen.getByRole("radiogroup", { name: "Version" })).getAllByRole("radio");
    expect(versions.map((r) => [r.textContent, r.getAttribute("aria-checked")])).toEqual([
      ["Full 55 min", "true"],
      ["Short 30 min", "false"],
      ["Travel", "false"],
    ]);
    expect(screen.getByRole("button", { name: "Start workout" })).toBeTruthy();
    expect(container.textContent).not.toMatch(/\bRIR\b|e1RM|deload|★/i);
    expect(await liveSessions()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(where()).toBe("/");
  });

  it("How to opens the guide sheet with the text and the video", async () => {
    renderWorkout();
    fireEvent.click(await screen.findByRole("button", { name: "How to do Back squat" }));
    const sheet = await screen.findByRole("dialog", { name: "Back squat" });
    const guide = guideFor("back_squat")!;
    expect(within(sheet).getByText(guide.what)).toBeTruthy();
    expect(within(sheet).getByText(guide.do[0]!)).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: /^Watch the video/ })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Reading a guide starts nothing.
    expect(screen.getByRole("button", { name: "Start workout" })).toBeTruthy();
    expect(await liveSessions()).toHaveLength(0);
  });

  it("a guide left open closes when the screen changes", async () => {
    renderWorkout();
    fireEvent.click(await screen.findByRole("button", { name: "How to do Back squat" }));
    expect(await screen.findByRole("dialog", { name: "Back squat" })).toBeTruthy();
    // Like an iOS back swipe: the route changes with the sheet still open.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(where()).toBe("/");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("switches to the short and the travel version", async () => {
    renderWorkout();
    await screen.findByRole("heading", { level: 1, name: "Squat + bench" });
    fireEvent.click(screen.getByRole("radio", { name: "Short 30 min" }));
    await waitFor(() => expect(exerciseNames()).toEqual(["Back squat", "Bench press", "Chest-supported dumbbell row"]));
    expect(screen.getByText(/^3 exercises · about 30 min/)).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "Travel" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Travel workout" })).toBeTruthy();
    expect(screen.getByText(/^Hotel gym or dumbbells · Week 1 of 12$/)).toBeTruthy();
    expect(exerciseNames()).not.toContain("Back squat");
  });

  it("opens in the version Today asked for (?mode=short)", async () => {
    renderWorkout("/workout?mode=short");
    await screen.findByRole("heading", { level: 1, name: "Squat + bench" });
    expect(screen.getByRole("radio", { name: "Short 30 min" }).getAttribute("aria-checked")).toBe("true");
    await waitFor(() => expect(exerciseNames()).toHaveLength(3));
  });

  it("leads with the short version in the evening and says why", async () => {
    at("2026-11-09T18:30:00.000Z"); // Monday 19:30 in Stockholm
    renderWorkout();
    expect(await screen.findByText("Short version picked for today.")).toBeTruthy();
    expect(screen.getByText(/It is late\. The short one fits the evening and counts fully\./)).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Short 30 min" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Full 55 min" }));
    await waitFor(() => expect(exerciseNames()).toHaveLength(6));
    expect(screen.queryByText("Short version picked for today.")).toBeNull();
  });

  it("a swap and the version chosen before the first set go into the session", async () => {
    await rememberMainLifts();
    renderWorkout();
    await screen.findByRole("heading", { level: 1, name: "Squat + bench" });
    fireEvent.click(screen.getByRole("radio", { name: "Short 30 min" }));
    await waitFor(() => expect(exerciseNames()).toHaveLength(3));
    fireEvent.click(screen.getByRole("button", { name: "Swap Bench press" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Alternatives for Bench press" })).getByRole("button", { name: /Dumbbell bench press/ }));
    await waitFor(() => expect(exerciseNames()).toEqual(["Back squat", "Dumbbell bench press", "Chest-supported dumbbell row"]));

    await startPlayer();
    fireEvent.click(await screen.findByRole("button", { name: "Log Back squat set 1" }));
    await waitFor(async () => expect(await liveSets()).toHaveLength(1));
    expect((await liveSessions())[0]).toMatchObject({ program_day_id: "A", mode: "short", swaps: { A2: "dumbbell_bench_press" } });
  });

  it("the check-in is one quiet row; saving it stores today's scores", async () => {
    renderWorkout();
    const row = await screen.findByRole("button", { name: /Slept badly or drained\?/ });
    expect(screen.queryByRole("region", { name: "Daily check-in" })).toBeNull();
    fireEvent.click(row);
    const card = screen.getByRole("region", { name: "Daily check-in" });
    for (const m of ["Sleep", "Soreness", "Stress", "Energy"]) fireEvent.click(within(card).getByRole("radio", { name: new RegExp(`^${m} 4`) }));
    fireEvent.click(within(card).getByRole("button", { name: "Save" }));
    await waitFor(async () => expect(await db.checkin.get("ck_2026-11-09")).toMatchObject({ sleep: 4, soreness: 4, stress: 4, energy: 4 }));
    expect(await screen.findByRole("button", { name: /Check-in 4\/5/ })).toBeTruthy();
  });
});

describe("Workout · the player", () => {
  it("Start workout shows the first exercise; nothing is stored until a set is logged", async () => {
    await rememberMainLifts();
    renderWorkout();
    const page = await startPlayer();
    expect(page.getAttribute("aria-label")).toBe("Back squat");
    expect(within(page).getByText("Exercise 1 of 6")).toBeTruthy();
    expect(within(page).getByText("2 sets · 5–8 reps · leave 3 in the tank")).toBeTruthy();
    expect(within(page).getByRole("button", { name: "How to do Back squat" })).toBeTruthy();
    expect(screen.getByText(/^Not started · 0 of \d+ sets$/)).toBeTruthy();
    // One segment per exercise.
    expect(within(screen.getByRole("tablist", { name: "Exercises" })).getAllByRole("tab")).toHaveLength(6);
    const log = await dockButton();
    expect(log.getAttribute("aria-label")).toBe("Log Back squat set 1");
    expect(log.textContent).toContain("60 kg × 8");
    expect(await liveSessions()).toHaveLength(0);

    // Close before the first set goes back to the overview, and still nothing is stored.
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByRole("button", { name: "Start workout" })).toBeTruthy();
    expect(await liveSessions()).toHaveLength(0);
  });

  it("one tap logs the set as prescribed, starts the session and the rest timer", async () => {
    await rememberMainLifts();
    renderWorkout();
    await startPlayer();
    fireEvent.click(await dockButton());

    await waitFor(async () => expect(await liveSets()).toHaveLength(1));
    const [s] = await liveSessions();
    expect(s).toMatchObject({ program_day_id: "A", mode: "full", flags: [], swaps: {}, ended_at: null });
    expect((await liveSets())[0]).toMatchObject({ session_id: s!.id, exercise_id: "back_squat", prescription_id: "A1", set_index: 0, weight: 60, reps: 8, rir: 3, target_weight: 60 });

    // The rest for the squat, saying what comes next.
    const rest = await screen.findByRole("timer", { name: /^Rest, 3:00 left/ });
    expect(within(rest).getByText("Rest · then Set 2 · Back squat")).toBeTruthy();
    const stored = JSON.parse(window.sessionStorage.getItem("gym.today.rest")!);
    expect(stored.sessionId).toBe(s!.id);
    expect(stored.endsAt - stored.startedAt).toBe(180_000);

    // The session runs: a clock, the count, Finish instead of Close, and the next set in the dock.
    expect(await screen.findByText(/· 1 of \d+ sets$/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Finish" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit set 1: 60 kg × 8, 3 left" })).toBeTruthy();
    expect((await dockButton()).getAttribute("aria-label")).toBe("Log Back squat set 2");
    expect(screen.getByRole("tab", { name: "Back squat, 1 of 2 sets" }).getAttribute("aria-selected")).toBe("true");

    fireEvent.click(within(rest).getByRole("button", { name: "Skip" }));
    expect(screen.queryByRole("timer")).toBeNull();
  });

  it("calibration: the dock opens the steppers, Done is the second tap", async () => {
    renderWorkout();
    await startPlayer();
    const pick = await dockButton();
    expect(pick.getAttribute("aria-label")).toBe("Pick weight for Back squat set 1");
    fireEvent.click(pick);
    expect(await screen.findByRole("button", { name: /^Weight 20 kg/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(async () => expect(await liveSets()).toHaveLength(1));
    expect((await liveSets())[0]).toMatchObject({ exercise_id: "back_squat", weight: 20, reps: 8, target_weight: null });
    expect(await liveSessions()).toHaveLength(1);
    // The second set reuses the picked weight: one tap.
    await waitFor(async () => expect((await dockButton()).getAttribute("aria-label")).toBe("Log Back squat set 2"));
  });

  it("edits and removes a logged set, and flags pain on the exercise", async () => {
    await rememberMainLifts();
    renderWorkout();
    const page = await startPlayer();
    fireEvent.click(await dockButton());
    await waitFor(async () => expect(await liveSets()).toHaveLength(1));

    fireEvent.click(await within(page).findByRole("button", { name: "Edit set 1" }));
    fireEvent.click(within(page).getByRole("button", { name: "Increase weight" }));
    fireEvent.click(within(page).getByRole("radio", { name: "1 rep left" }));
    fireEvent.click(within(page).getByRole("button", { name: "Done" }));
    await waitFor(async () => expect((await liveSets())[0]).toMatchObject({ weight: 62.5, rir: 1 }));
    expect(await liveSets()).toHaveLength(1);

    fireEvent.click(within(page).getByRole("switch", { name: /Pain/ }));
    await waitFor(async () => expect((await liveSets()).every((s) => s.pain_flag)).toBe(true));

    fireEvent.click(await within(page).findByRole("button", { name: "Edit set 1" }));
    fireEvent.click(within(page).getByRole("button", { name: "Remove set" }));
    await waitFor(async () => expect(await liveSets()).toHaveLength(0));
    // The slot is open again.
    await waitFor(async () => expect((await dockButton()).getAttribute("aria-label")).toBe("Log Back squat set 1"));
  });

  it("steps between exercises with the arrows and the segments", async () => {
    await rememberMainLifts();
    renderWorkout();
    await startPlayer();
    const prev = screen.getByRole("button", { name: "Previous exercise" }) as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Skip to the next exercise" }));
    expect((await screen.findByRole("article")).getAttribute("aria-label")).toBe("Bench press");
    expect(prev.disabled).toBe(false);
    fireEvent.click(screen.getByRole("tab", { name: /^Plank, 0 of/ }));
    expect(screen.getByRole("article").getAttribute("aria-label")).toBe("Plank");
    expect(screen.getByText("Exercise 6 of 6")).toBeTruthy();
    fireEvent.click(prev);
    expect(screen.getByRole("article").getAttribute("aria-label")).toBe("Dumbbell lateral raise");
  });
});

describe("Workout · finishing", () => {
  async function playerWithOneSet() {
    await rememberMainLifts();
    renderWorkout();
    await startPlayer();
    fireEvent.click(await dockButton());
    await waitFor(async () => expect(await liveSets()).toHaveLength(1));
    return screen.findByRole("button", { name: "Finish" });
  }

  it("Finish with sets open asks first; Keep going keeps the session running", async () => {
    fireEvent.click(await playerWithOneSet());
    const sheet = await screen.findByRole("dialog", { name: "Finish early?" });
    expect(within(sheet).getByText(/^1 of \d+ sets logged\. Open sets are left out\./)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "Keep going" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((await liveSessions())[0]!.ended_at).toBeNull();
    expect((await dockButton()).getAttribute("aria-label")).toBe("Log Back squat set 2");
  });

  it("finishing early ends the session, clears the rest and lands on the summary", async () => {
    fireEvent.click(await playerWithOneSet());
    at("2026-11-09T08:00:00.000Z");
    const sheet = await screen.findByRole("dialog", { name: "Finish early?" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Finish" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Session A done." })).toBeTruthy();
    const [s] = await liveSessions();
    expect(s!.ended_at).not.toBeNull();
    expect(where()).toBe(`/summary/${s!.id}`);
    expect(window.sessionStorage.getItem("gym.today.rest")).toBeNull();
    expect(screen.queryByRole("timer")).toBeNull();
  });

  it("discard asks inline and removes the session with its sets", async () => {
    fireEvent.click(await playerWithOneSet());
    const sheet = await screen.findByRole("dialog", { name: "Finish early?" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Discard workout" }));
    expect(within(sheet).getByText(/The 1 logged set goes with it\./)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "Keep it" }));
    expect(await liveSessions()).toHaveLength(1);
    fireEvent.click(within(sheet).getByRole("button", { name: "Discard workout" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Discard" }));
    await waitFor(async () => expect(await liveSessions()).toHaveLength(0));
    expect(await liveSets()).toHaveLength(0);
    // The player closes (to Today, or to the overview when the discard came right after the first set).
    await waitFor(() => expect(screen.queryByRole("article")).toBeNull());
    expect(screen.queryByRole("timer")).toBeNull();
    expect(window.sessionStorage.getItem("gym.today.rest")).toBeNull();
  });

  it("discarding a resumed workout goes back to Today", async () => {
    await strength("2026-11-09T06:30:00.000Z", { exercises: 1, open: true, pick: 20 });
    at(BLOCK_DAY_ONE);
    renderWorkout();
    fireEvent.click(await screen.findByRole("button", { name: "Finish" }));
    const sheet = await screen.findByRole("dialog", { name: "Finish early?" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Discard workout" }));
    expect(await within(sheet).findByText(/The 2 logged sets go with it\./)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(where()).toBe("/"));
    expect(await liveSessions()).toHaveLength(0);
    expect(await liveSets()).toHaveLength(0);
  });

  it("the whole session from the dock, one tap per set, then Finish workout leads to the summary", { timeout: 20_000 }, async () => {
    await rememberMainLifts();
    renderWorkout();
    await startPlayer();
    const total = Number(screen.getByText(/^Not started · 0 of \d+ sets$/).textContent!.match(/of (\d+) sets/)![1]);
    expect(total).toBeGreaterThanOrEqual(10);

    for (let logged = 0; logged < total; logged++) {
      const btn = await dockButton();
      fireEvent.click(btn);
      // A set without a weight yet opens the steppers at the start weight: Done is the second tap.
      if (btn.getAttribute("aria-label")!.startsWith("Pick weight")) fireEvent.click(await screen.findByRole("button", { name: "Done" }));
      await waitFor(async () => expect(await liveSets()).toHaveLength(logged + 1));
      await screen.findByText(new RegExp(`· ${logged + 1} of ${total} sets$`));
    }

    at("2026-11-09T08:05:00.000Z");
    // Everything is logged: the dock offers the finish, and no rest runs after the last set.
    const finish = await screen.findByRole("button", { name: "Finish workout" });
    expect(screen.queryByRole("timer")).toBeNull();
    await act(async () => {
      fireEvent.click(finish);
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Session A done." })).toBeTruthy();
    const [s] = await liveSessions();
    expect(s!.ended_at).not.toBeNull();
    expect(new Set((await liveSets()).map((x) => x.session_id))).toEqual(new Set([s!.id]));
    expect(screen.getByText(String(total))).toBeTruthy();
    // The summary explains what changes next time.
    expect(screen.getByRole("heading", { name: "Next time" })).toBeTruthy();
  });
});

describe("Workout · coming back", () => {
  it("a session left open resumes in the player with its sets and the rest timer", async () => {
    await rememberMainLifts();
    const first = renderWorkout();
    await startPlayer();
    fireEvent.click(await dockButton());
    await screen.findByRole("timer", { name: /^Rest/ });
    first.unmount();

    renderWorkout();
    // No overview, no start button: straight back into the exercise.
    expect((await screen.findByRole("article")).getAttribute("aria-label")).toBe("Back squat");
    expect(screen.queryByRole("button", { name: "Start workout" })).toBeNull();
    expect(await screen.findByRole("button", { name: "Edit set 1" })).toBeTruthy();
    expect((await dockButton()).getAttribute("aria-label")).toBe("Log Back squat set 2");
    expect(screen.getByRole("timer", { name: /^Rest/ })).toBeTruthy();
    // Leaving the player keeps the session running.
    fireEvent.click(screen.getByRole("button", { name: "Back to Today" }));
    expect(where()).toBe("/");
    expect((await liveSessions())[0]!.ended_at).toBeNull();
  });

  it("after today's workout it says done for today and never offers a second one", async () => {
    const id = await strength("2026-11-09T06:00:00.000Z");
    renderWorkout();
    expect(await screen.findByRole("heading", { level: 1, name: "Done for today" })).toBeTruthy();
    expect(screen.getByText(/^Next up is Hinge \+ overhead, tomorrow or whenever it fits\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start workout" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "See today's summary" }));
    expect(where()).toBe(`/summary/${id}`);
  });
});

describe("Workout · the player holds steady (QA 2026-11-12)", () => {
  it("Back to Today right after the first set leaves the workout running", async () => {
    await rememberMainLifts();
    renderWorkout();
    await startPlayer();
    fireEvent.click(await dockButton());
    await waitFor(async () => expect(await liveSets()).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Back to Today" }));
    await waitFor(() => expect(where()).toBe("/"));
    expect((await liveSessions())[0]!.ended_at).toBeNull();
  });

  it("pain flagged before an exercise's first set survives leaving and resuming", async () => {
    // Node's own localStorage stub shadows jsdom's here; the flags live in localStorage on the phone.
    vi.stubGlobal("localStorage", memoryStorage());
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });
    await rememberMainLifts();
    const first = renderWorkout();
    await startPlayer();
    fireEvent.click(await dockButton());
    await waitFor(async () => expect(await liveSets()).toHaveLength(1));
    fireEvent.click(screen.getByRole("tab", { name: /^Bench press,/ }));
    const bench = await screen.findByRole("article", { name: "Bench press" });
    fireEvent.click(within(bench).getByRole("switch", { name: /Pain/ }));
    expect(within(bench).getByRole("switch", { name: /Pain/ }).getAttribute("aria-checked")).toBe("true");
    first.unmount();

    renderWorkout();
    await screen.findByRole("article", { name: "Back squat" });
    fireEvent.click(screen.getByRole("tab", { name: /^Bench press,/ }));
    const again = await screen.findByRole("article", { name: "Bench press" });
    expect(within(again).getByRole("switch", { name: /Pain/ }).getAttribute("aria-checked")).toBe("true");
    await waitFor(async () => expect((await dockButton()).getAttribute("aria-label")).toBe("Log Bench press set 1"));
    fireEvent.click(await dockButton());
    await waitFor(async () => expect((await liveSets()).find((l) => l.exercise_id === "bench_press")?.pain_flag).toBe(true));
    expect((await liveSets()).find((l) => l.exercise_id === "back_squat")?.pain_flag).toBe(false);
  });

  it("a workout closed on another device stops taking sets and leads back to Today", async () => {
    await rememberMainLifts();
    renderWorkout();
    await startPlayer();
    fireEvent.click(await dockButton());
    await waitFor(async () => expect(await liveSets()).toHaveLength(1));
    const [s] = await liveSessions();
    await act(async () => {
      await repo.finishSession(s!.id);
    });
    expect(await screen.findByText(/^This workout was closed/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Log Back squat/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Done for today" })).toBeNull();
    const back = screen.getAllByRole("button", { name: "Back to Today" });
    fireEvent.click(back[back.length - 1]!);
    expect(where()).toBe("/");
    expect(await liveSets()).toHaveLength(1);
  });

  it("with cardio running it points back to the cardio instead of starting a second session", async () => {
    await repo.startCardioSession();
    renderWorkout();
    expect(await screen.findByRole("heading", { level: 1, name: "Cardio is running" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start workout" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to cardio" }));
    expect(where()).toBe("/cardio");
    expect(await liveSessions()).toHaveLength(1);
  });
});
