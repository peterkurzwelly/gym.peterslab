/**
 * Cardio panel: the interval timer survives a remount (tab switch, reload), "Log without timer" goes away
 * once the timer runs, and the discard X asks inline once there is something to lose.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@gym/schema";
import { cardioIntervals } from "../../src/components/__fixtures__";
import { CardioPanel } from "../../src/screens/today/CardioPanel";
import { readIntervalRun } from "../../src/screens/today/storage";

const T0 = new Date("2026-11-11T17:30:00.000Z").getTime();
const session = (id = "s_cardio"): Session => ({
  id,
  program_day_id: "CARDIO",
  started_at: new Date(T0).toISOString(),
  ended_at: null,
  mode: "full",
  flags: [],
  swaps: {},
  notes: null,
  updated_at: new Date(T0).toISOString(),
  deleted_at: null,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(T0);
  try {
    window.sessionStorage.clear();
  } catch {
    /* ignore */
  }
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

function panel(s: Session | null = session(), onClose = vi.fn()) {
  return render(<CardioPanel plan={cardioIntervals} session={s} sound={false} onClose={onClose} onSaved={() => {}} />);
}

describe("CardioPanel · interval timer", () => {
  it("resumes a running timer after a remount instead of starting over at warm-up", () => {
    const view = panel();
    expect(screen.getByRole("button", { name: "Log without timer" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    // Once it runs, End is the way out; the manual log would drop the timer's progress.
    expect(screen.queryByRole("button", { name: "Log without timer" })).toBeNull();
    advance(130_000);
    expect(screen.getByRole("timer").getAttribute("aria-label")).toBe("2:50 left in Warm-up");
    expect(readIntervalRun("s_cardio")).toMatchObject({ startedAt: T0, pausedAt: null, pausedMs: 0 });

    // Tab switch: Today unmounts and comes back.
    view.unmount();
    advance(60_000);
    panel();
    expect(screen.getByRole("timer").getAttribute("aria-label")).toBe("1:50 left in Warm-up");
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Log without timer" })).toBeNull();
  });

  it("keeps a paused timer paused, and ignores a run stored for another session", () => {
    const view = panel();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    advance(30_000);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    view.unmount();
    advance(600_000);
    const again = panel();
    expect(screen.getByRole("timer").getAttribute("aria-label")).toBe("4:30 left in Warm-up");
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
    again.unmount();

    panel(session("s_other"));
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log without timer" })).toBeTruthy();
  });

  it("a timer that ended before the remount opens the log with its minutes", () => {
    const view = panel();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    advance(600_000);
    fireEvent.click(screen.getByRole("button", { name: "End" }));
    const timerLine = () => screen.getByText((_t, el) => el?.tagName === "P" && el.textContent === "Timer · 10:00 total · 3 min hard");
    expect(timerLine()).toBeTruthy();
    view.unmount();
    advance(120_000);
    panel();
    expect(timerLine()).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save cardio" })).toBeTruthy();
  });
});

describe("CardioPanel · discard", () => {
  it("closes at once before the timer starts", () => {
    const onClose = vi.fn();
    panel(session(), onClose);
    const x = screen.getByRole("button", { name: "Discard cardio" });
    expect(x.className).toMatch(/\bh-11\b/);
    fireEvent.click(x);
    expect(screen.queryByRole("group", { name: "Discard cardio" })).toBeNull();
  });

  it("asks inline once the timer runs; Keep it keeps the timer going", async () => {
    const onClose = vi.fn();
    panel(session(), onClose);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    advance(10_000);
    fireEvent.click(screen.getByRole("button", { name: "Discard cardio" }));
    const ask = screen.getByRole("group", { name: "Discard cardio" });
    expect(within(ask).getByText(/Discard this cardio\?/)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(within(ask).getByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("group", { name: "Discard cardio" })).toBeNull();
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Discard cardio" }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole("group", { name: "Discard cardio" })).getByRole("button", { name: "Discard" }));
    });
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(readIntervalRun("s_cardio")).toBeNull();
  });
});
