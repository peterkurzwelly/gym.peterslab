import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell, ShellDock, ShellTitle } from "../../src/components/AppShell";
import { FinishBar } from "../../src/components/FinishBar";
import { IntervalTimer, intervalProgress } from "../../src/components/IntervalTimer";
import { WeekCard } from "../../src/components/WeekCard";
import { NextSessionCard } from "../../src/components/NextSessionCard";
import { blockWeek3Floor, cardioDemo, cardioIntervals, goals, nextB, nextDoneToday, weekFloor, weekFresh, blockWeek1 } from "../../src/components/__fixtures__";
import { segmentAt } from "../../src/lib/timers";

const T0 = new Date("2026-11-11T17:30:00.000Z").getTime();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

describe("segmentAt", () => {
  it("finds the segment and time left", () => {
    const segs = [{ seconds: 10 }, { seconds: 5 }];
    expect(segmentAt(segs, 0)).toMatchObject({ index: 0, remainingInSegment: 10, done: false });
    expect(segmentAt(segs, 12)).toMatchObject({ index: 1, remainingInSegment: 3 });
    expect(segmentAt(segs, 15)).toMatchObject({ index: 2, done: true, total: 15 });
  });

  it("interval progress counts hard minutes", () => {
    expect(intervalProgress(cardioIntervals, 26 * 60)).toEqual({ minutes: 26, hardMinutes: 8 });
    expect(intervalProgress(cardioIntervals, 5 * 60 + 60)).toEqual({ minutes: 6, hardMinutes: 1 });
  });
});

describe("IntervalTimer", () => {
  it("runs through the segments from timestamps and completes once", () => {
    const onComplete = vi.fn();
    render(<IntervalTimer plan={cardioDemo} onComplete={onComplete} sound={false} />);
    expect(screen.getByText("Warm-up")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    advance(7_000); // warm-up is 6 s
    expect(screen.getByText("Hard 1/2")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    vi.setSystemTime(Date.now() + 60_000); // paused time does not count
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    advance(250);
    expect(screen.getByText("Hard 1/2")).toBeTruthy();

    advance(40_000);
    expect(onComplete).toHaveBeenCalledTimes(1);
    // 6 + 2 × (8 + 6) + 6 = 40 s total, 16 s hard.
    expect(onComplete).toHaveBeenCalledWith({ minutes: 0.7, hardMinutes: 0.3 });
    advance(5_000);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("End stops early with what was done", () => {
    const onComplete = vi.fn();
    render(<IntervalTimer plan={cardioIntervals} onComplete={onComplete} sound={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    advance(6 * 60_000);
    fireEvent.click(screen.getByRole("button", { name: "End" }));
    expect(onComplete).toHaveBeenCalledWith({ minutes: 6, hardMinutes: 1 });
  });
});

describe("FinishBar", () => {
  it("shows elapsed time and sets", () => {
    const onFinish = vi.fn();
    render(<FinishBar startedAt={T0 - 125_000} setsDone={5} setsTotal={8} onFinish={onFinish} />);
    expect(screen.getByText("2:05")).toBeTruthy();
    expect(screen.getByText("5 of 8 sets")).toBeTruthy();
    advance(5_000);
    expect(screen.getByText("2:10")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });
});

describe("AppShell", () => {
  it("renders tabs, gear, and portals screen content into the title and dock slots", () => {
    render(
      <MemoryRouter initialEntries={["/plan"]}>
        <AppShell>
          <ShellTitle>Session A</ShellTitle>
          <ShellDock>
            <div>dock content</div>
          </ShellDock>
          <p>body</p>
        </AppShell>
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/settings");
    expect(screen.getByRole("link", { name: /Plan/ }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: /Today/ }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByText("Session A")).toBeTruthy();
    expect(screen.getByText("dock content")).toBeTruthy();
    expect(screen.getByText("body")).toBeTruthy();
  });
});

describe("cards", () => {
  it("week card states read calmly", () => {
    const { rerender } = render(<WeekCard week={weekFresh} block={blockWeek1} goals={goals} />);
    expect(screen.getByText("Week 1 of 12")).toBeTruthy();
    expect(screen.getByText("0 of 4 done")).toBeTruthy();
    expect(screen.getByText("2 strength sessions reach the floor")).toBeTruthy();
    expect(screen.queryByText(/reached/)).toBeNull();
    rerender(<WeekCard week={weekFloor} block={blockWeek3Floor} goals={goals} />);
    expect(screen.getByText("2 of 4 done")).toBeTruthy();
    expect(screen.getByText("Floor reached ✓")).toBeTruthy();
  });

  it("next session card: start buttons and done for today", () => {
    const onStart = vi.fn();
    const { rerender } = render(<NextSessionCard next={nextB} cardio={cardioIntervals} cardioDone={false} onStart={onStart} />);
    expect(screen.getByText("Session B")).toBeTruthy();
    expect(screen.getByText("~55 min")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start B" }));
    fireEvent.click(screen.getByRole("button", { name: /30 min version of session B/ }));
    expect(onStart.mock.calls).toEqual([["full"], ["short"]]);
    expect(screen.getByText("4 × 2 min hard / 2 min easy")).toBeTruthy();

    rerender(<NextSessionCard next={nextDoneToday} cardio={cardioIntervals} cardioDone onStart={onStart} />);
    expect(screen.getByText("Done for today")).toBeTruthy();
    expect(screen.getByText("Next: Session C, whenever it fits.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Start/ })).toBeNull();
    expect(screen.getByText("Cardio done this week")).toBeTruthy();
  });
});
