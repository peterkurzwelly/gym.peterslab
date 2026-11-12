/**
 * The whole app (App.tsx) with its real routes, lazy screens and the real engine: the tabs lead to their
 * screens, old links still land, and an open session is flagged for the update policy.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { App } from "../../src/App";
import { isSessionOpen } from "../../src/lib/updatePolicy";
import { BLOCK_DAY_ONE, resetApp, strength, teardownApp } from "./helpers";

// No background sync in tests: the data layer boots without the network.
vi.mock("../../src/data/boot", () => ({ bootData: () => () => {} }));

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
const h1 = (name: string | RegExp) => screen.findByRole("heading", { level: 1, name }, { timeout: 5000 });
const tabBarHidden = () => screen.getByRole("navigation", { name: "Main", hidden: true }).classList.contains("hidden");

beforeEach(() => resetApp(BLOCK_DAY_ONE));
afterEach(teardownApp);

describe("App", () => {
  it("walks the four tabs", { timeout: 20_000 }, async () => {
    renderAt("/");
    expect(await screen.findByRole("button", { name: "Start workout" })).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Program" }));
    expect(await h1("Program")).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Progress" }));
    expect(await h1("Progress")).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "You" }));
    expect(await h1("You")).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Today" }));
    expect(await screen.findByRole("button", { name: "Start workout" })).toBeTruthy();
    expect(tabBarHidden()).toBe(false);
  });

  it("Start workout opens the workout full screen, and Back returns to Today with the tabs", { timeout: 20_000 }, async () => {
    renderAt("/");
    fireEvent.click(await screen.findByRole("button", { name: "Start workout" }));
    expect(await h1("Squat + bench")).toBeTruthy();
    expect(tabBarHidden()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("region", { name: "This week" })).toBeTruthy();
    expect(tabBarHidden()).toBe(false);
  });

  it("the old /plan link lands on Program, and an unknown link on Today", { timeout: 20_000 }, async () => {
    const first = renderAt("/plan");
    expect(await h1("Program")).toBeTruthy();
    first.unmount();
    renderAt("/nope");
    expect(await screen.findByRole("region", { name: "This week" })).toBeTruthy();
  });

  it("flags an open session so the app never reloads onto a new version mid workout", async () => {
    await strength("2026-11-09T06:00:00.000Z", { exercises: 1, open: true });
    expect(isSessionOpen()).toBe(false);
    renderAt("/");
    expect(await screen.findByRole("button", { name: "Resume workout" })).toBeTruthy();
    await waitFor(() => expect(isSessionOpen()).toBe(true));
  });
});
