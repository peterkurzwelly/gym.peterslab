/**
 * One exercise in the workout player (screens/workout/ExercisePage): the how-to button, the target in plain
 * words, calibration (no weight yet), editing, pain and the inline swap. Props in, callbacks out.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlannedExercise } from "@gym/engine";
import type { SetLog } from "@gym/schema";
import { backSquat, benchCalibration, chestSupportedRow, hackSquatLimitation, setLog, splitSquat } from "../../src/components/__fixtures__";
import { ExercisePage, pickedBefore, type ExercisePageProps } from "../../src/screens/workout/ExercisePage";

afterEach(cleanup);

function page(exercise: PlannedExercise, logged: SetLog[] = [], props: Partial<ExercisePageProps> = {}) {
  const handlers = { onConfirmSet: vi.fn(), onRemoveSet: vi.fn(), onPainChange: vi.fn(), onSwap: vi.fn() };
  const first = exercise.sets.find((s) => !logged.some((l) => l.set_index === s.index));
  const view = render(
    <ExercisePage exercise={exercise} logged={logged} activeSetIndex={first?.index ?? null} pain={false} today="2026-11-11" position={1} total={6} circuit={false} {...handlers} {...props} />,
  );
  return { ...view, ...handlers };
}

describe("ExercisePage", () => {
  it("leads with the how-to, then the target and the reason in plain words", () => {
    const { container } = page(splitSquat);
    const article = screen.getByRole("article", { name: "Bulgarian split squat" });
    const howTo = within(article).getByRole("button", { name: "How to do Bulgarian split squat" });
    expect(within(howTo).getByText("How to")).toBeTruthy();
    expect(within(howTo).getByText("Video")).toBeTruthy();
    expect(screen.getByText("Exercise 1 of 6")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Bulgarian split squat" })).toBeTruthy();
    expect(screen.getByText("2 sets · 8–10/leg reps · leave 3 in the tank")).toBeTruthy();
    // Engine text: "All sets hit top of range at RIR 3: +2 kg."
    expect(screen.getByText("All sets hit top of range with 3 left in the tank: +2 kg.")).toBeTruthy();
    expect(screen.getByText("12/hand × 10/leg, 10/leg, 3 left")).toBeTruthy();
    expect(screen.getByText(/Last time · Yesterday/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/\bRIR\b|@ \d/);
  });

  it("badges: short version, superset (not in a circuit), swapped for you", () => {
    const { rerender } = page({ ...backSquat, superset_group: "T" });
    expect(screen.getByText("In the 30 min version")).toBeTruthy();
    expect(screen.getByText("Superset")).toBeTruthy();
    const base = { logged: [], activeSetIndex: 0, pain: false, today: "2026-11-11", position: 1, total: 6, onConfirmSet: () => {}, onRemoveSet: () => {}, onPainChange: () => {}, onSwap: () => {} };
    rerender(<ExercisePage {...base} exercise={{ ...backSquat, superset_group: "T" }} circuit />);
    expect(screen.queryByText("Superset")).toBeNull();
    rerender(<ExercisePage {...base} exercise={hackSquatLimitation} circuit={false} />);
    expect(screen.getByText("Swapped for you")).toBeTruthy();
  });

  it("one tap on the check confirms the prescribed set", () => {
    const { onConfirmSet } = page(backSquat);
    fireEvent.click(screen.getByRole("button", { name: "Confirm set 1" }));
    expect(onConfirmSet).toHaveBeenCalledWith(backSquat.sets[0], { weight: 60, reps: 8, rir: 3 }, null);
  });

  it("passes the existing log when a done set is edited, and offers Remove set", () => {
    const first = setLog(backSquat, 0, 60, 8, 3);
    const { onConfirmSet, onRemoveSet } = page(backSquat, [first]);
    fireEvent.click(screen.getByRole("button", { name: "Edit set 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onConfirmSet).toHaveBeenCalledWith(backSquat.sets[0], { weight: 60, reps: 8, rir: 3 }, first);
    fireEvent.click(screen.getByRole("button", { name: "Edit set 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove set" }));
    expect(onRemoveSet).toHaveBeenCalledWith(first);
  });

  it("pain is a switch of its own, separate from soreness", () => {
    const { onPainChange } = page(backSquat);
    const pain = screen.getByRole("switch", { name: /Pain/ });
    expect(pain.textContent).toContain("Real pain, not soreness.");
    fireEvent.click(pain);
    expect(onPainChange).toHaveBeenCalledWith(true);
  });

  it("the swap row opens the alternatives inline and reports the choice", () => {
    const { onSwap } = page(backSquat);
    const swap = screen.getByRole("button", { name: "Machine taken or not for you? Swap it" });
    expect(swap.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(swap);
    const panel = screen.getByRole("group", { name: "Alternatives for Back squat" });
    fireEvent.click(within(panel).getByRole("button", { name: /Leg press/ }));
    expect(onSwap).toHaveBeenCalledWith("leg_press");
    expect(screen.queryByRole("group", { name: "Alternatives for Back squat" })).toBeNull();
  });
});

describe("ExercisePage · calibration (no weight yet)", () => {
  it("shows Pick weight on every set and opens the editor at 20 kg for a barbell", () => {
    const { onConfirmSet } = page(benchCalibration, [], { equipment: "barbell" });
    expect(screen.getAllByText("Pick weight")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Pick weight for set 1" }));
    expect(onConfirmSet).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^Weight 20 kg/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Increase weight" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onConfirmSet).toHaveBeenCalledWith(benchCalibration.sets[0], { weight: 22.5, reps: 8, rir: 3 }, null);
  });

  it("starts at five increments when it is not a barbell", () => {
    const ex = { ...chestSupportedRow, sets: chestSupportedRow.sets.map((s) => ({ ...s, weight: null })), calibration: true };
    page(ex, [], { equipment: "machine" });
    fireEvent.click(screen.getByRole("button", { name: "Pick weight for set 1" }));
    expect(screen.getByRole("button", { name: /^Weight 12.5 kg/ })).toBeTruthy();
  });

  it("later sets reuse the weight picked earlier and confirm in one tap", () => {
    const first = setLog(benchCalibration, 0, 22.5, 8, 3);
    const { onConfirmSet } = page(benchCalibration, [first], { equipment: "barbell" });
    expect(pickedBefore([first], 1)).toBe(22.5);
    fireEvent.click(screen.getByRole("button", { name: "Confirm set 2" }));
    expect(onConfirmSet).toHaveBeenCalledWith(benchCalibration.sets[1], { weight: 22.5, reps: 8, rir: 3 }, null);
  });

  it("a done calibration set as prescribed shows no target line; a later set compares with the picked weight", () => {
    const first = setLog(benchCalibration, 0, 22.5, 8, 3);
    const second = setLog(benchCalibration, 1, 22.5, 7, 3);
    const { container } = page(benchCalibration, [first, second], { equipment: "barbell" });
    expect(container.textContent).not.toMatch(/pick ×|target pick/i);
    expect(screen.getAllByText(/^target /).map((n) => n.textContent)).toEqual(["target 22.5 × 8, 3 left"]);
  });

  it("a done calibration set that missed the reps reads 'aim', in the row and in its editor", () => {
    const first = setLog(benchCalibration, 0, 22.5, 7, 3);
    const { container } = page(benchCalibration, [first], { equipment: "barbell" });
    expect(screen.getByRole("button", { name: "Edit set 1: 22.5 kg × 7, 3 left" })).toBeTruthy();
    expect(container.textContent).not.toMatch(/target pick|pick ×|target 8/);
    expect(screen.getByText("aim 8, 3 left")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit set 1" }));
    expect(container.textContent).toMatch(/· aim 8, 3 left/);
  });
});
