import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SetRow, calibrationStartWeight, describeSet, describeShort } from "../../src/components/SetRow";
import { backSquat, benchCalibration, benchTopSet, plank, pullUp, splitSquat } from "../../src/components/__fixtures__";

afterEach(cleanup);

const squatSet = backSquat.sets[0]!;

describe("SetRow", () => {
  it("one tap on check confirms exactly the prescribed values", () => {
    const onConfirm = vi.fn();
    render(<SetRow set={squatSet} exercise={backSquat} isNext onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm set 1" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({ weight: 60, reps: 8, rir: 3 });
  });

  it("shows no text field until a number is tapped", () => {
    const { container } = render(<SetRow set={squatSet} exercise={backSquat} isNext onConfirm={() => {}} />);
    expect(container.querySelector("input")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Adjust set 1/ }));
    expect(container.querySelector("input")).toBeNull(); // steppers, not a keyboard
    fireEvent.click(screen.getByRole("button", { name: /^Weight 60 kg/ }));
    const input = container.querySelector("input")!;
    expect(input).not.toBeNull();
    expect(input.getAttribute("inputmode")).toBe("decimal");
  });

  it("weight stepper moves by the exercise increment, reps by 1", () => {
    const onConfirm = vi.fn();
    render(<SetRow set={squatSet} exercise={backSquat} isNext onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: /^Adjust set 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Increase weight" }));
    fireEvent.click(screen.getByRole("button", { name: "Increase weight" }));
    expect(screen.getByRole("button", { name: /^Weight 65 kg/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Decrease reps" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onConfirm).toHaveBeenCalledWith({ weight: 65, reps: 7, rir: 3 });
  });

  it("uses a 2 kg increment when the exercise says so", () => {
    const onConfirm = vi.fn();
    render(<SetRow set={splitSquat.sets[0]!} exercise={splitSquat} isNext onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: /^Adjust set 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Decrease weight" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onConfirm).toHaveBeenCalledWith({ weight: 12, reps: 10, rir: 3 });
  });

  it("asks how many more reps were left, 0 to 4+, in plain words", () => {
    const onConfirm = vi.fn();
    render(<SetRow set={squatSet} exercise={backSquat} isNext onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: /^Adjust set 1/ }));
    expect(screen.getByText("How many more could you have done?")).toBeTruthy();
    const group = screen.getByRole("radiogroup", { name: "Reps left" });
    const chips = screen.getAllByRole("radio");
    expect(chips.every((c) => group.contains(c))).toBe(true);
    expect(chips.map((c) => c.textContent)).toEqual(["0", "1", "2", "3", "4+"]);
    expect(chips.map((c) => c.getAttribute("aria-label"))).toEqual(["No reps left", "1 rep left", "2 reps left", "3 reps left", "4 or more reps left"]);
    expect(screen.getByRole("radio", { name: "3 reps left" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "1 rep left" }));
    expect(screen.getByRole("radio", { name: "1 rep left" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onConfirm).toHaveBeenCalledWith({ weight: 60, reps: 8, rir: 1 });
  });

  it("never says RIR: a pending row shows the target, a done row the result with an 'N left' tag", () => {
    const { container, rerender } = render(<SetRow set={squatSet} exercise={backSquat} isNext onConfirm={() => {}} />);
    expect(screen.getByRole("button", { name: "Adjust set 1: 60 kg × 8, 3 left" })).toBeTruthy();
    expect(screen.getByText("tap the numbers to change them")).toBeTruthy();
    expect(container.textContent).not.toMatch(/RIR|@/);
    rerender(<SetRow set={squatSet} exercise={backSquat} logged={{ weight: 60, reps: 8, rir: 0 }} onConfirm={() => {}} />);
    expect(screen.getByRole("button", { name: "Edit set 1: 60 kg × 8, max" })).toBeTruthy();
    expect(screen.getByText("max")).toBeTruthy();
    expect(container.textContent).not.toMatch(/RIR|@/);
  });

  it("done sets show the actual result and open for editing on tap", () => {
    const onConfirm = vi.fn();
    render(<SetRow set={squatSet} exercise={backSquat} logged={{ weight: 62.5, reps: 7, rir: 2 }} onConfirm={onConfirm} />);
    expect(screen.getByText("2 left")).toBeTruthy();
    expect(screen.getByText("target 60 × 8, 3 left")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit set 1" }));
    expect(screen.getByRole("button", { name: /^Weight 62.5 kg/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Increase reps" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onConfirm).toHaveBeenCalledWith({ weight: 62.5, reps: 8, rir: 2 });
  });

  it("shows the same set from last time when there is nothing to compare", () => {
    render(<SetRow set={squatSet} exercise={backSquat} isNext last={{ weight: 57.5, reps: 8, rir: 3 }} onConfirm={() => {}} />);
    expect(screen.getByText("last 57.5 × 8, 3 left")).toBeTruthy();
    expect(screen.queryByText("tap the numbers to change them")).toBeNull();
  });

  it("a top set is named as one", () => {
    const onConfirm = vi.fn();
    const top = benchTopSet.sets[3]!;
    render(<SetRow set={top} exercise={benchTopSet} isNext onConfirm={onConfirm} />);
    expect(screen.getByText("Top set")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm top set" }));
    expect(onConfirm).toHaveBeenCalledWith({ weight: 90, reps: 5, rir: 1 });
  });

  it("timed bodyweight work hides a zero load and steps seconds by 5", () => {
    const onConfirm = vi.fn();
    const { container } = render(<SetRow set={plank.sets[0]!} exercise={plank} isNext onConfirm={onConfirm} />);
    expect(container.textContent).not.toMatch(/kg|BW/);
    fireEvent.click(screen.getByRole("button", { name: /^Adjust set 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Increase seconds" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onConfirm).toHaveBeenCalledWith({ weight: 0, reps: 40, rir: 3 });
  });

  it("timed bodyweight work can add load, after the seconds, so 'add load' advice can be followed", () => {
    const onConfirm = vi.fn();
    render(<SetRow set={plank.sets[0]!} exercise={plank} isNext onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: /^Adjust set 1/ }));
    const labels = screen.getAllByRole("button", { name: /^Increase / }).map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual(["Increase seconds", "Increase added"]);
    fireEvent.click(screen.getByRole("button", { name: "Increase added" }));
    fireEvent.click(screen.getByRole("button", { name: "Increase added" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onConfirm).toHaveBeenCalledWith({ weight: 5, reps: 35, rir: 3 });
    // Logged with a plate: the row shows it as added load, never "kg" on bodyweight.
    cleanup();
    render(<SetRow set={plank.sets[0]!} exercise={plank} logged={{ weight: 5, reps: 35, rir: 3 }} onConfirm={() => {}} />);
    expect(screen.getByText("BW+5")).toBeTruthy();
  });

  it("a done set's editor offers Remove set; a pending one does not", () => {
    const onRemove = vi.fn();
    const onConfirm = vi.fn();
    const { rerender } = render(<SetRow set={squatSet} exercise={backSquat} isNext onConfirm={onConfirm} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole("button", { name: /^Adjust set 1/ }));
    expect(screen.queryByRole("button", { name: "Remove set" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel editing" }));

    rerender(<SetRow set={squatSet} exercise={backSquat} logged={{ weight: 60, reps: 8, rir: 3 }} onConfirm={onConfirm} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit set 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove set" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Remove set" })).toBeNull(); // editor closed
  });
});

describe("SetRow · calibration (no weight yet)", () => {
  const calibSet = benchCalibration.sets[0]!;

  it("shows Pick weight and opens the editor at the start weight instead of confirming", () => {
    const onConfirm = vi.fn();
    render(<SetRow set={calibSet} exercise={benchCalibration} isNext startWeight={20} onConfirm={onConfirm} />);
    expect(screen.getByText("Pick weight")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pick weight for set 1" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^Weight 20 kg/ })).toBeTruthy();
    // No target weight yet: the editor reads "aim", never "target pick".
    expect(screen.getByText("· aim 8, 3 left")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Increase weight" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onConfirm).toHaveBeenCalledWith({ weight: 22.5, reps: 8, rir: 3 });
  });

  it("a later set reuses the weight picked before and confirms in one tap", () => {
    const onConfirm = vi.fn();
    render(<SetRow set={benchCalibration.sets[1]!} exercise={benchCalibration} isNext fallbackWeight={22.5} onConfirm={onConfirm} />);
    expect(screen.getByText("same as the set before")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm set 2" }));
    expect(onConfirm).toHaveBeenCalledWith({ weight: 22.5, reps: 8, rir: 3 });
  });
});

describe("SetRow text helpers", () => {
  it("describeSet reads a set aloud without shorthand", () => {
    expect(describeSet({ weight: 60, reps: 8, rir: 3 }, backSquat)).toBe("60 kg × 8, 3 left");
    expect(describeSet({ weight: null, reps: 8, rir: 3 }, benchCalibration)).toBe("weight to pick × 8, 3 left");
    expect(describeSet({ weight: 14, reps: 10, rir: null }, splitSquat)).toBe("14 kg per hand × 10 per side");
    expect(describeSet({ weight: 5, reps: 8, rir: 0 }, pullUp)).toBe("bodyweight plus 5 kg × 8, max");
    expect(describeSet({ weight: 0, reps: 35, rir: 3 }, plank)).toBe("bodyweight × 35 seconds, 3 left");
  });

  it("describeShort is the compact line under a set", () => {
    expect(describeShort({ weight: 60, reps: 8, rir: 3 }, backSquat)).toBe("60 × 8, 3 left");
    expect(describeShort({ weight: null, reps: 8, rir: 3 }, benchCalibration)).toBe("8, 3 left");
    expect(describeShort({ weight: 0, reps: 35, rir: null }, plank)).toBe("35 s");
    expect(describeShort({ weight: 14, reps: 10, rir: 3 }, splitSquat)).toBe("14/hand × 10/leg, 3 left");
  });

  it("calibration starts at 20 kg for a barbell, five increments otherwise, bodyweight at 0", () => {
    expect(calibrationStartWeight(backSquat, true)).toBe(20);
    expect(calibrationStartWeight(backSquat, false)).toBe(12.5);
    expect(calibrationStartWeight(splitSquat, false)).toBe(10);
    expect(calibrationStartWeight(pullUp, false)).toBe(0);
  });
});
