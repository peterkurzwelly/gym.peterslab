/**
 * The exercise how-to sheet: opened from anywhere with useGuide()(exerciseId). Exercise names come from the
 * engine context (real engine over fake-indexeddb), the guide text from data/exercise-guides.json.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GuideProvider, useGuide } from "../../src/components/GuideSheet";
import * as repo from "../../src/data/repo";
import { guideFor } from "../../src/lib/guides";
import { resetDb } from "../data/helpers";

function Opener({ id }: { id: string }) {
  const open = useGuide();
  return (
    <button type="button" onClick={() => open(id)}>
      open {id}
    </button>
  );
}

function renderGuide(...ids: string[]) {
  return render(
    <GuideProvider>
      {ids.map((id) => (
        <Opener key={id} id={id} />
      ))}
    </GuideProvider>,
  );
}

beforeEach(async () => {
  await resetDb();
  await repo.ensureSettings();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("GuideSheet", () => {
  it("shows what the exercise is, how to set up and do it, and the muscles", async () => {
    renderGuide("back_squat");
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "open back_squat" }));
    const sheet = await screen.findByRole("dialog", { name: "Back squat" });
    const guide = guideFor("back_squat")!;
    expect(within(sheet).getByText("How to")).toBeTruthy();
    expect(within(sheet).getByText(guide.what)).toBeTruthy();
    expect(within(sheet).getByText("In the gym, look for")).toBeTruthy();
    expect(within(sheet).getByText(guide.find)).toBeTruthy();
    for (const title of ["Set up", "Do it", "Watch out"]) expect(within(sheet).getByRole("heading", { name: title })).toBeTruthy();
    for (const step of [...guide.setup, ...guide.do, ...guide.avoid]) expect(within(sheet).getByText(step)).toBeTruthy();
    expect(within(sheet).getByText("You should feel it in")).toBeTruthy();
    expect(within(sheet).getByText(guide.feel)).toBeTruthy();
    // Primary muscle first, then the helpers, in words.
    expect(within(sheet).getByText("Quads")).toBeTruthy();
    expect(within(sheet).getByText("Lower back")).toBeTruthy();
    // Start and end photo.
    expect(within(sheet).getByText("Start")).toBeTruthy();
    expect(within(sheet).getByText("End")).toBeTruthy();
    expect([...sheet.querySelectorAll("img")].map((i) => i.getAttribute("src"))).toEqual(["/ex/back_squat-0.webp", "/ex/back_squat-1.webp"]);
  });

  it("Watch the video swaps the photos for the player, and back", async () => {
    renderGuide("back_squat");
    fireEvent.click(screen.getByRole("button", { name: "open back_squat" }));
    const sheet = await screen.findByRole("dialog", { name: "Back squat" });
    const video = guideFor("back_squat")!.video!;
    expect(sheet.querySelector("iframe")).toBeNull();
    expect(within(sheet).getByRole("link", { name: "Open in YouTube" }).getAttribute("href")).toBe(`https://www.youtube.com/watch?v=${video.id}`);

    const watch = within(sheet).getByRole("button", { name: /^Watch the video/ });
    expect(watch.textContent).toContain(video.channel);
    fireEvent.click(watch);
    const frame = within(sheet).getByTitle(video.title);
    expect(frame.getAttribute("src")).toContain(`youtube-nocookie.com/embed/${video.id}`);
    expect(sheet.querySelector("img")).toBeNull();
    fireEvent.click(within(sheet).getByRole("button", { name: /^Back to photos/ }));
    expect(sheet.querySelector("iframe")).toBeNull();
    expect(sheet.querySelectorAll("img")).toHaveLength(2);
  });

  it("without a connection the video button waits and says why", async () => {
    vi.stubGlobal("navigator", { ...navigator, onLine: false });
    renderGuide("back_squat");
    fireEvent.click(screen.getByRole("button", { name: "open back_squat" }));
    const sheet = await screen.findByRole("dialog", { name: "Back squat" });
    const watch = within(sheet).getByRole("button", { name: /^Watch the video/ }) as HTMLButtonElement;
    expect(watch.disabled).toBe(true);
    expect(watch.textContent).toContain("Needs a connection");
  });

  it("closes, and opens for another exercise with its own content", async () => {
    renderGuide("back_squat", "plank");
    fireEvent.click(screen.getByRole("button", { name: "open back_squat" }));
    const sheet = await screen.findByRole("dialog", { name: "Back squat" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "open plank" }));
    const plank = await screen.findByRole("dialog", { name: "Plank" });
    expect(within(plank).getByText(guideFor("plank")!.what)).toBeTruthy();
    expect(within(plank).queryByText(guideFor("back_squat")!.what)).toBeNull();
  });

  it("a custom exercise without a guide falls back to its own steps and a video search", async () => {
    const ex = await repo.saveCustomExercise({
      name: "Sled push",
      pattern: "carry",
      primary_muscles: ["quads"],
      secondary_muscles: [],
      equipment: "other",
      fatigue_rating: 2,
      increment_kg: 5,
      step_kg: 5,
      default_rest_s: 120,
      tags: [],
      instructions: ["Load the sled.", "Lean in and drive with short steps."],
    });
    renderGuide(ex.id);
    fireEvent.click(screen.getByRole("button", { name: `open ${ex.id}` }));
    const sheet = await screen.findByRole("dialog", { name: "Sled push" });
    expect(within(sheet).getByRole("heading", { name: "How to do it" })).toBeTruthy();
    expect(within(sheet).getByText("Lean in and drive with short steps.")).toBeTruthy();
    expect(within(sheet).queryByRole("button", { name: /Watch the video/ })).toBeNull();
    expect(within(sheet).getByRole("link", { name: "Find a video on YouTube" }).getAttribute("href")).toBe(
      "https://www.youtube.com/results?search_query=Sled%20push%20proper%20form",
    );
    // No photo on file: each frame hands over to ExerciseDemo, which shows the mark once its own photo fails too.
    for (const img of sheet.querySelectorAll("img")) fireEvent.error(img);
    // One failed request is enough: the placeholder asks for no second image.
    expect(sheet.querySelectorAll("img")).toHaveLength(0);
    expect(within(sheet).getAllByRole("img", { name: "Sled push: no photo" })).toHaveLength(2);
    expect(sheet.querySelector("img")).toBeNull();
  });
});
