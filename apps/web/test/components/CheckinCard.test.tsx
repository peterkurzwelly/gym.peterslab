import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CheckinCard } from "../../src/components/CheckinCard";

afterEach(cleanup);

const pick = (name: string) => fireEvent.click(screen.getByRole("radio", { name }));

describe("CheckinCard", () => {
  it("saves the four scores once all are picked, then collapses to the average", () => {
    const onSave = vi.fn();
    const onSkip = vi.fn();
    render(<CheckinCard value={null} onSave={onSave} onSkip={onSkip} />);
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    pick("Sleep 2");
    pick("Soreness 4");
    pick("Stress 3");
    expect(save.disabled).toBe(true);
    pick("Energy 5 high");
    expect(save.disabled).toBe(false);

    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledWith({ sleep: 2, soreness: 4, stress: 3, energy: 5 });
    expect(onSkip).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Check-in 3.5\/5/ })).toBeTruthy();
  });

  it("labels the direction of each scale", () => {
    render(<CheckinCard value={null} onSave={() => {}} onSkip={() => {}} />);
    expect(screen.getByText("1 poor · 5 great")).toBeTruthy();
    expect(screen.getByText("1 very sore · 5 fresh")).toBeTruthy();
    expect(screen.getByText("1 high · 5 calm")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Soreness 1 very sore" })).toBeTruthy();
  });

  it("skip calls onSkip and collapses; the parent's skipped flag names the row", () => {
    const onSkip = vi.fn();
    const onSave = vi.fn();
    const { rerender } = render(<CheckinCard value={null} onSave={onSave} onSkip={onSkip} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Daily check-in" })).toBeNull();
    rerender(<CheckinCard value={null} skipped onSave={onSave} onSkip={onSkip} />);
    expect(screen.getByRole("button", { name: /Check-in skipped/ })).toBeTruthy();
  });

  it("startOpen={false} starts as one quiet row and opens the form on tap", () => {
    const onSave = vi.fn();
    render(<CheckinCard value={null} startOpen={false} onSave={onSave} onSkip={() => {}} />);
    expect(screen.queryByRole("region", { name: "Daily check-in" })).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Slept badly or drained\?.*Check in$/ }));
    expect(screen.getByRole("region", { name: "Daily check-in" })).toBeTruthy();
    for (const m of ["Sleep", "Soreness", "Stress", "Energy"]) pick(`${m} 4`);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({ sleep: 4, soreness: 4, stress: 4, energy: 4 });
    expect(screen.getByRole("button", { name: /Check-in 4\/5/ })).toBeTruthy();
  });

  it("a saved check-in starts collapsed; editing and closing does not skip", () => {
    const onSkip = vi.fn();
    const onSave = vi.fn();
    render(<CheckinCard value={{ sleep: 3, soreness: 4, stress: 3, energy: 4 }} onSave={onSave} onSkip={onSkip} />);
    fireEvent.click(screen.getByRole("button", { name: /Check-in 3.5\/5/ }));
    expect(screen.getByRole("radio", { name: "Sleep 3" }).getAttribute("aria-checked")).toBe("true");
    pick("Sleep 5 great");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({ sleep: 5, soreness: 4, stress: 3, energy: 4 });

    fireEvent.click(screen.getByRole("button", { name: /Check-in/ }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onSkip).not.toHaveBeenCalled();
  });
});
