import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RestTimer } from "../../src/components/RestTimer";

const T0 = new Date("2026-11-11T17:30:00.000Z").getTime();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

describe("RestTimer", () => {
  it("counts down from endsAt and fires onDone exactly once", () => {
    const onDone = vi.fn();
    render(<RestTimer startedAt={T0} endsAt={T0 + 90_000} onAdd={() => {}} onSkip={() => {}} onDone={onDone} sound={false} />);
    expect(screen.getByRole("timer").getAttribute("aria-label")).toBe("Rest, 1:30 left");

    advance(30_000);
    expect(screen.getByRole("timer").getAttribute("aria-label")).toBe("Rest, 1:00 left");
    expect(onDone).not.toHaveBeenCalled();

    advance(60_000);
    expect(onDone).toHaveBeenCalledTimes(1);
    advance(10_000);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("is right after the app was backgrounded (time jumps without ticks)", () => {
    const onDone = vi.fn();
    render(<RestTimer startedAt={T0} endsAt={T0 + 120_000} onAdd={() => {}} onSkip={() => {}} onDone={onDone} sound={false} />);
    // Suspended: the clock moves but no interval fires. The next tick reads the real time.
    vi.setSystemTime(T0 + 100_000);
    advance(250);
    expect(screen.getByRole("timer").getAttribute("aria-label")).toBe("Rest, 0:20 left");
  });

  it("starting from a time already past endsAt fires once without alerting", () => {
    const onDone = vi.fn();
    const vibrate = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, vibrate });
    render(<RestTimer startedAt={T0 - 200_000} endsAt={T0 - 20_000} onAdd={() => {}} onSkip={() => {}} onDone={onDone} sound={false} />);
    advance(500);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("alerts at zero: flash and vibrate where supported", () => {
    const vibrate = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, vibrate });
    render(<RestTimer startedAt={T0} endsAt={T0 + 2_000} onAdd={() => {}} onSkip={() => {}} onDone={() => {}} sound={false} />);
    advance(2_000);
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".gym-flash")).not.toBeNull();
    advance(1_000);
    expect(document.querySelector(".gym-flash")).toBeNull();
  });

  it("+30 s and skip call back; a new endsAt re-arms onDone", () => {
    const onAdd = vi.fn();
    const onSkip = vi.fn();
    const onDone = vi.fn();
    const { rerender } = render(<RestTimer startedAt={T0} endsAt={T0 + 5_000} onAdd={onAdd} onSkip={onSkip} onDone={onDone} sound={false} />);
    fireEvent.click(screen.getByRole("button", { name: "+30 s" }));
    expect(onAdd).toHaveBeenCalledWith(30);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(onSkip).toHaveBeenCalledTimes(1);

    advance(5_000);
    expect(onDone).toHaveBeenCalledTimes(1);
    rerender(<RestTimer startedAt={T0} endsAt={T0 + 35_000} onAdd={onAdd} onSkip={onSkip} onDone={onDone} sound={false} />);
    advance(10_000);
    expect(screen.getByRole("timer").getAttribute("aria-label")).toBe("Rest, 0:20 left");
    advance(20_000);
    expect(onDone).toHaveBeenCalledTimes(2);
  });
});
