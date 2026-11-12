import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntervalTimer, intervalProgress } from "../../src/components/IntervalTimer";
import { cardioDemo, cardioIntervals } from "../../src/components/__fixtures__";
import { secondsLeft, segmentAt, toMs } from "../../src/lib/timers";

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

describe("timestamp helpers", () => {
  it("seconds left round up and never go below zero", () => {
    expect(secondsLeft(T0 + 1_001, T0)).toBe(2);
    expect(secondsLeft(T0 + 1_000, T0)).toBe(1);
    expect(secondsLeft(T0, T0 + 5_000)).toBe(0);
    expect(toMs("2026-11-11T17:30:00.000Z")).toBe(T0);
    expect(toMs(T0)).toBe(T0);
  });
});
