/**
 * App wide pieces: the four tabs, focus routes without header and tab bar, the slots screens fill, the end
 * of a rest on every tab, and the header chip that shows the rest left and leads back to the workout.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { AppShell, isFocusRoute, ShellDock, ShellTitle } from "../../src/components/AppShell";
import { RestChip, RestWatcher } from "../../src/screens/today/RestAlert";
import { endRest, resetRestForTests, startRest, useAnyRest } from "../../src/screens/today/rest";

const T0 = new Date("2026-11-11T17:30:00.000Z").getTime();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(T0);
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  try {
    window.sessionStorage.clear();
  } catch {
    /* ignore */
  }
  resetRestForTests();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.querySelectorAll(".gym-flash").forEach((el) => el.remove());
});

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

function RestProbe() {
  const rest = useAnyRest();
  return <p data-testid="rest">{rest ? "resting" : "no rest"}</p>;
}
function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}
const where = () => screen.getByTestId("where").textContent;

const PAGES = ["/", "/program", "/progress", "/settings", "/workout", "/cardio", "/summary/s1"];

function renderShell(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppShell sync={<RestChip />}>
        <RestWatcher sound={false} />
        <RestProbe />
        <Where />
        <Routes>
          {PAGES.map((p) => (
            <Route key={p} path={p} element={<p>page {p}</p>} />
          ))}
        </Routes>
      </AppShell>
    </MemoryRouter>,
  );
}

const tabBar = () => screen.getByRole("navigation", { name: "Main", hidden: true });
const hidden = (el: Element | null) => !!el?.classList.contains("hidden");

describe("tab bar", () => {
  it("has four tabs: Today, Program, Progress, You", () => {
    renderShell("/");
    const tabs = within(tabBar()).getAllByRole("link");
    expect(tabs.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Today", "/"],
      ["Program", "/program"],
      ["Progress", "/progress"],
      ["You", "/settings"],
    ]);
    expect(tabs.map((a) => a.getAttribute("aria-current"))).toEqual(["page", null, null, null]);
  });

  it("switches tabs, marks the current one and opens each at the top", () => {
    const scrollTo = vi.fn();
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    renderShell("/program");
    expect(screen.getByRole("link", { name: "Program" }).getAttribute("aria-current")).toBe("page");
    scrollTo.mockClear();
    fireEvent.click(screen.getByRole("link", { name: "You" }));
    expect(where()).toBe("/settings");
    expect(screen.getByRole("link", { name: "You" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Program" }).getAttribute("aria-current")).toBeNull();
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    fireEvent.click(screen.getByRole("link", { name: "Today" }));
    expect(where()).toBe("/");
  });

  it("stays visible on the tabs and on the summary", () => {
    for (const path of ["/", "/program", "/progress", "/settings", "/summary/s1"]) {
      const view = renderShell(path);
      expect(hidden(tabBar())).toBe(false);
      expect(hidden(view.container.querySelector("header"))).toBe(false);
      view.unmount();
    }
  });
});

describe("focus routes", () => {
  it("the workout and cardio take the whole screen: no header, no tab bar", () => {
    for (const path of ["/workout", "/cardio"]) {
      const view = renderShell(path);
      expect(screen.getByText(`page ${path}`)).toBeTruthy();
      expect(hidden(tabBar())).toBe(true);
      expect(hidden(view.container.querySelector("header"))).toBe(true);
      view.unmount();
    }
  });

  it("isFocusRoute names exactly those routes", () => {
    expect(["/workout", "/workout/", "/workout/x", "/cardio"].map(isFocusRoute)).toEqual([true, true, true, true]);
    expect(["/", "/program", "/progress", "/settings", "/summary/s1", "/workouts", "/cardio-log"].map(isFocusRoute)).toEqual([false, false, false, false, false, false, false]);
  });
});

describe("slots", () => {
  it("screens set the header title and float bars in the dock, outside the scrolling page", () => {
    const view = render(
      <MemoryRouter>
        <AppShell>
          <ShellTitle>Week 3 of 12</ShellTitle>
          <ShellDock>
            <button type="button">Start workout</button>
          </ShellDock>
          <p>content</p>
        </AppShell>
      </MemoryRouter>,
    );
    const header = view.container.querySelector("header")!;
    expect(within(header).getByText("Week 3 of 12")).toBeTruthy();
    const dock = screen.getByRole("button", { name: "Start workout" });
    expect(dock.closest("main")).toBeNull();
    expect(screen.getByText("content").closest("main")).not.toBeNull();
  });

  it("the header says Workout OS until a screen sets a title", () => {
    const view = renderShell("/");
    expect(within(view.container.querySelector("header")!).getByText("Workout OS")).toBeTruthy();
  });
});

describe("rest on another tab", () => {
  it("flashes and vibrates on Program when the rest ends, then clears it", () => {
    const vibrate = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, vibrate });
    renderShell("/program");
    act(() => startRest("s1", 90, "Set 2 · Bench press"));
    const chip = screen.getByRole("button", { name: "Rest, 1:30 left. Back to the workout" });
    expect(chip.closest("header")).not.toBeNull();
    advance(30_000);
    expect(screen.getByRole("button", { name: "Rest, 1:00 left. Back to the workout" })).toBeTruthy();

    advance(60_000);
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".gym-flash")).not.toBeNull();
    expect(screen.getByTestId("rest").textContent).toBe("no rest");
    expect(screen.queryByRole("button", { name: /^Rest,/ })).toBeNull();
    advance(10_000);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it("the chip leads to the workout, where the dock has the timer and the chip is gone", () => {
    renderShell("/progress");
    act(() => startRest("s1", 60, "Set 1 · Row"));
    fireEvent.click(screen.getByRole("button", { name: /^Rest, 1:00 left/ }));
    expect(where()).toBe("/workout");
    expect(screen.queryByRole("button", { name: /^Rest,/, hidden: true })).toBeNull();
    // The rest itself keeps running.
    expect(screen.getByTestId("rest").textContent).toBe("resting");
  });

  it("shows on every tab and on the summary", () => {
    for (const path of ["/", "/program", "/progress", "/settings", "/summary/s1"]) {
      const view = renderShell(path);
      act(() => startRest("s1", 45, "Set 3 · Row"));
      expect(screen.getByRole("button", { name: "Rest, 0:45 left. Back to the workout" })).toBeTruthy();
      view.unmount();
      resetRestForTests();
    }
  });

  it("noticing the end late (back from the background) clears without an alert, and alerts fire once per rest", () => {
    const vibrate = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, vibrate });
    startRest("s1", 10, "x", T0);
    expect(endRest(false, T0 + 5_000)).toBe(false); // not over yet
    expect(endRest(false, T0 + 60_000)).toBe(true);
    expect(vibrate).not.toHaveBeenCalled();

    startRest("s1", 10, "x", T0);
    expect(endRest(false, T0 + 10_500)).toBe(true);
    expect(endRest(false, T0 + 10_600)).toBe(false); // the dock timer and the watcher both call it
    expect(vibrate).toHaveBeenCalledTimes(1);
  });
});
