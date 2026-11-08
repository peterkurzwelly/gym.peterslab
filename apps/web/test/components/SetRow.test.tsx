import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExerciseCard } from "../../src/components/ExerciseCard";
import { SetRow, describeShort } from "../../src/components/SetRow";
import { backSquat, benchCalibration, chestSupportedRow, plank, setLog, splitSquat } from "../../src/components/__fixtures__";

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

  it("RIR chips 0 to 4 pick the RIR", () => {
    const onConfirm = vi.fn();
    render(<SetRow set={squatSet} exercise={backSquat} isNext onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: /^Adjust set 1/ }));
    const chips = screen.getAllByRole("radio");
    expect(chips.map((c) => c.textContent)).toEqual(["0", "1", "2", "3", "4"]);
    expect(screen.getByRole("radio", { name: "RIR 3" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "RIR 1" }));
    expect(screen.getByRole("radio", { name: "RIR 1" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onConfirm).toHaveBeenCalledWith({ weight: 60, reps: 8, rir: 1 });
  });

  it("done sets show the actual result and open for editing on tap", () => {
    const onConfirm = vi.fn();
    render(<SetRow set={squatSet} exercise={backSquat} logged={{ weight: 62.5, reps: 7, rir: 2 }} onConfirm={onConfirm} />);
    expect(screen.getByText(/target 60 × 8 @ 3/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit set 1" }));
    expect(screen.getByRole("button", { name: /^Weight 62.5 kg/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Increase reps" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onConfirm).toHaveBeenCalledWith({ weight: 62.5, reps: 8, rir: 2 });
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

describe("calibration (no weight yet)", () => {
  it("shows Pick weight and opens the editor at 20 kg for a barbell", () => {
    const onConfirmSet = vi.fn();
    render(
      <ExerciseCard exercise={benchCalibration} logged={[]} activeSetIndex={0} pain={false} equipment="barbell" onConfirmSet={onConfirmSet} onPainChange={() => {}} />,
    );
    expect(screen.getAllByText("Pick weight").length).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Pick weight for set 1" }));
    expect(onConfirmSet).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^Weight 20 kg/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Increase weight" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onConfirmSet).toHaveBeenCalledWith(benchCalibration.sets[0], { weight: 22.5, reps: 8, rir: 3 }, null);
  });

  it("starts at five increments when it is not a barbell", () => {
    const ex = { ...chestSupportedRow, sets: chestSupportedRow.sets.map((s) => ({ ...s, weight: null })), calibration: true };
    render(<ExerciseCard exercise={ex} logged={[]} activeSetIndex={0} pain={false} equipment="machine" onConfirmSet={() => {}} onPainChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Pick weight for set 1" }));
    expect(screen.getByRole("button", { name: /^Weight 12.5 kg/ })).toBeTruthy();
  });

  it("later sets reuse the weight picked earlier and confirm in one tap", () => {
    const onConfirmSet = vi.fn();
    const first = setLog(benchCalibration, 0, 22.5, 8, 3);
    render(
      <ExerciseCard exercise={benchCalibration} logged={[first]} activeSetIndex={1} pain={false} equipment="barbell" onConfirmSet={onConfirmSet} onPainChange={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm set 2" }));
    expect(onConfirmSet).toHaveBeenCalledWith(benchCalibration.sets[1], { weight: 22.5, reps: 8, rir: 3 }, null);
  });

  it("a done calibration set as prescribed shows no target line; a later set compares with the picked weight", () => {
    const first = setLog(benchCalibration, 0, 22.5, 8, 3);
    const second = setLog(benchCalibration, 1, 22.5, 7, 3);
    const { container } = render(
      <ExerciseCard exercise={benchCalibration} logged={[first, second]} activeSetIndex={null} pain={false} equipment="barbell" onConfirmSet={() => {}} onPainChange={() => {}} />,
    );
    expect(container.textContent).not.toMatch(/pick ×/);
    expect(screen.getAllByText(/^target /).map((n) => n.textContent)).toEqual(["target 22.5 × 8 @ 3"]);
    expect(describeShort({ weight: null, reps: 8, rir: 3 }, benchCalibration)).toBe("8 @ 3");
  });

  it("a done calibration set shows the logged values and never a 'target pick' line", () => {
    const first = setLog(benchCalibration, 0, 22.5, 7, 3);
    const { container } = render(
      <ExerciseCard exercise={benchCalibration} logged={[first]} activeSetIndex={1} pain={false} equipment="barbell" onConfirmSet={() => {}} onPainChange={() => {}} />,
    );
    expect(screen.getByRole("button", { name: /^Edit set 1: 22.5 kg × 7 at RIR 3$/ })).toBeTruthy();
    expect(container.textContent).not.toMatch(/target pick|pick ×|target 8/);
    expect(screen.getByText("aim 8 @ 3")).toBeTruthy();
    // Its editor reads "aim", not "target", too.
    fireEvent.click(screen.getByRole("button", { name: "Edit set 1" }));
    expect(container.textContent).toMatch(/· aim 8 @ 3/);
  });

  it("travel circuit cards drop the superset badge", () => {
    const ex = { ...backSquat, superset_group: "T" };
    const { rerender } = render(<ExerciseCard exercise={ex} logged={[]} activeSetIndex={0} pain={false} onConfirmSet={() => {}} onPainChange={() => {}} />);
    expect(screen.queryByText("Superset T")).not.toBeNull();
    rerender(<ExerciseCard exercise={ex} logged={[]} activeSetIndex={0} pain={false} circuit onConfirmSet={() => {}} onPainChange={() => {}} />);
    expect(screen.queryByText("Superset T")).toBeNull();
  });
});

describe("ExerciseCard", () => {
  it("passes the existing log when a done set is edited", () => {
    const onConfirmSet = vi.fn();
    const first = setLog(backSquat, 0, 60, 8, 3);
    render(<ExerciseCard exercise={backSquat} logged={[first]} activeSetIndex={1} pain={false} onConfirmSet={onConfirmSet} onPainChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit set 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onConfirmSet).toHaveBeenCalledWith(backSquat.sets[0], { weight: 60, reps: 8, rir: 3 }, first);
  });

  it("shows the summary, reason and pain toggle", () => {
    const onPain = vi.fn();
    render(<ExerciseCard exercise={backSquat} logged={[]} activeSetIndex={0} pain={false} onConfirmSet={() => {}} onPainChange={onPain} />);
    expect(screen.getByText("2 × 5–8 @ RIR 3")).toBeTruthy();
    expect(screen.getByText(backSquat.reason)).toBeTruthy();
    act(() => {
      fireEvent.click(screen.getByRole("switch", { name: /Pain/ }));
    });
    expect(onPain).toHaveBeenCalledWith(true);
  });

  it("swap mode opens alternatives inline and reports the choice", () => {
    const onSwap = vi.fn();
    render(<ExerciseCard exercise={backSquat} logged={[]} activeSetIndex={0} pain={false} swapMode onSwap={onSwap} onConfirmSet={() => {}} onPainChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Swap/ }));
    fireEvent.click(screen.getByRole("button", { name: /Leg press/ }));
    expect(onSwap).toHaveBeenCalledWith("leg_press");
  });
});
