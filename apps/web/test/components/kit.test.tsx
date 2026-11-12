/** New kit pieces of the night + volt UI: the bottom sheet, the progress ring and bar, the exercise photo. */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExerciseDemo } from "../../src/components/ExerciseDemo";
import { Bar, Ring } from "../../src/components/Ring";
import { Sheet } from "../../src/components/Sheet";

afterEach(cleanup);

describe("Sheet", () => {
  it("renders nothing while closed and a named dialog when open", () => {
    const { rerender } = render(
      <Sheet open={false} onClose={() => {}} title="Body weight">
        <p>content</p>
      </Sheet>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("content")).toBeNull();
    rerender(
      <Sheet open onClose={() => {}} title="Body weight" eyebrow="Morning, before breakfast">
        <p>content</p>
      </Sheet>,
    );
    const dialog = screen.getByRole("dialog", { name: "Body weight" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(within(dialog).getByRole("heading", { name: "Body weight" })).toBeTruthy();
    expect(within(dialog).getByText("Morning, before breakfast")).toBeTruthy();
    expect(within(dialog).getByText("content")).toBeTruthy();
  });

  it("closes from the close button, the backdrop and Escape", () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Steps today">
        <p>content</p>
      </Sheet>,
    );
    const dialog = screen.getByRole("dialog", { name: "Steps today" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    // The backdrop is the other "Close", outside the dialog.
    const backdrop = screen.getAllByRole("button", { name: "Close" }).find((b) => !dialog.contains(b))!;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(3);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("locks page scroll while any sheet is open", () => {
    const one = render(
      <Sheet open onClose={() => {}} title="One">
        <p>1</p>
      </Sheet>,
    );
    const two = render(
      <Sheet open onClose={() => {}} title="Two">
        <p>2</p>
      </Sheet>,
    );
    expect(document.documentElement.style.overflow).toBe("hidden");
    one.unmount();
    expect(document.documentElement.style.overflow).toBe("hidden");
    two.unmount();
    expect(document.documentElement.style.overflow).toBe("");
  });
});

describe("Ring and Bar", () => {
  it("the ring names its value and clamps it to 0..100%", () => {
    const { rerender } = render(<Ring value={0.42}>42</Ring>);
    expect(screen.getByRole("img", { name: "42%" })).toBeTruthy();
    rerender(<Ring value={3} label="Protein 180 of 150 g" />);
    const ring = screen.getByRole("img", { name: "Protein 180 of 150 g" });
    const arc = ring.querySelectorAll("circle")[1]!;
    expect(Number(arc.getAttribute("stroke-dashoffset"))).toBe(0);
    rerender(<Ring value={Number.NaN} />);
    expect(screen.getByRole("img", { name: "0%" })).toBeTruthy();
  });

  it("the bar fills to the clamped share", () => {
    const { container, rerender } = render(<Bar value={0.25} />);
    const fill = () => (container.firstElementChild!.firstElementChild as HTMLElement).style.width;
    expect(fill()).toBe("25%");
    rerender(<Bar value={1.6} />);
    expect(fill()).toBe("100%");
    rerender(<Bar value={-1} />);
    expect(fill()).toBe("0%");
  });
});

describe("ExerciseDemo", () => {
  it("shows the start and end photo, or only the start for a still", () => {
    const { container, rerender } = render(<ExerciseDemo exerciseId="back_squat" name="Back squat" />);
    expect(screen.getByRole("img", { name: "Back squat: start and end position" })).toBeTruthy();
    expect([...container.querySelectorAll("img")].map((i) => i.getAttribute("src"))).toEqual(["/ex/back_squat-0.webp", "/ex/back_squat-1.webp"]);
    rerender(<ExerciseDemo exerciseId="back_squat" name="Back squat" still />);
    expect([...container.querySelectorAll("img")].map((i) => i.getAttribute("src"))).toEqual(["/ex/back_squat-0.webp"]);
  });

  it("falls back to a mark when the photo is missing, and recovers for another exercise", () => {
    const { container, rerender } = render(<ExerciseDemo exerciseId="my_custom_move" name="My move" still />);
    fireEvent.error(container.querySelector("img")!);
    expect(screen.getByRole("img", { name: "My move: no photo" })).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
    rerender(<ExerciseDemo exerciseId="plank" name="Plank" still />);
    expect(screen.getByRole("img", { name: "Plank: start and end position" })).toBeTruthy();
  });
});
