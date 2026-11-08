/**
 * App wide pieces: the end of a rest alerts on every tab (not only under Today's dock timer), a header chip
 * shows the rest left on the other tabs, and switching tabs starts at the top.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "../../src/components/AppShell";
import { RestChip, RestWatcher } from "../../src/screens/today/RestAlert";
import { endRest, resetRestForTests, startRest, useAnyRest } from "../../src/screens/today/rest";

const T0 = new Date("2026-11-11T17:30:00.000Z").getTime();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(T0);
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

function renderApp(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppShell sync={<RestChip />}>
        <RestWatcher sound={false} />
        <RestProbe />
        <Routes>
          <Route path="/" element={<p>today</p>} />
          <Route path="/plan" element={<p>plan</p>} />
          <Route path="/progress" element={<p>progress</p>} />
        </Routes>
      </AppShell>
    </MemoryRouter>,
  );
}

describe("rest end on another tab", () => {
  it("flashes and vibrates on Plan when the rest ends, then clears it; the chip leads back to Today", () => {
    const vibrate = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, vibrate });
    renderApp("/plan");
    act(() => startRest("s1", 90, "Bench press · set 2"));
    const chip = screen.getByRole("button", { name: "Rest, 1:30 left. Back to Today" });
    expect(chip.closest("header")).not.toBeNull();
    advance(30_000);
    expect(screen.getByRole("button", { name: "Rest, 1:00 left. Back to Today" })).toBeTruthy();

    advance(60_000);
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".gym-flash")).not.toBeNull();
    expect(screen.getByTestId("rest").textContent).toBe("no rest");
    expect(screen.queryByRole("button", { name: /^Rest,/ })).toBeNull();
    advance(10_000);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it("the chip is not shown on Today (the dock has the timer) and taps through from other tabs", () => {
    renderApp("/progress");
    act(() => startRest("s1", 60, "Row · set 1"));
    fireEvent.click(screen.getByRole("button", { name: /^Rest, 1:00 left/ }));
    expect(screen.getByText("today")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Rest,/ })).toBeNull();
    expect(screen.getByTestId("rest").textContent).toBe("resting");
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

describe("tab switches", () => {
  it("open each tab at the top", () => {
    const scrollTo = vi.fn();
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    renderApp("/plan");
    scrollTo.mockClear();
    fireEvent.click(screen.getByRole("link", { name: /Progress/ }));
    expect(screen.getByText("progress")).toBeTruthy();
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });
});
