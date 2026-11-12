/**
 * Today's body card (screens/home/BodyCard + BodySheets) inside the Home screen, real engine and Dexie:
 * the setup state opens the profile sheet, and with a complete profile protein, steps and weight are one
 * tap or one sheet away. Every write lands in the body_log / settings rows through the data layer.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../src/data";
import { HomeScreen } from "../../src/screens/Home";
import { BLOCK_DAY_ONE, completeProfile, renderApp, resetApp, settingsRow, teardownApp } from "./helpers";

const TODAY = "2026-11-09";
const renderHome = () => renderApp("/", { "/": <HomeScreen /> });
const bodyLog = () => db.body_log.get(`bd_${TODAY}`);

beforeEach(() => resetApp(BLOCK_DAY_ONE));
afterEach(teardownApp);

describe("Today · body card before setup", () => {
  it("explains the other half and opens the profile sheet", async () => {
    renderHome();
    const card = await screen.findByRole("region", { name: "Fat loss targets" });
    expect(within(card).getByRole("heading", { name: "Set your fat loss targets" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Today's targets" })).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Set up · 30 seconds" }));
    const sheet = await screen.findByRole("dialog", { name: "You and your goal" });
    for (const group of ["Goal", "Sex", "Day job", "Pace"]) expect(within(sheet).getByRole("radiogroup", { name: group })).toBeTruthy();
    expect(within(sheet).getByRole("radio", { name: "Lose fat" }).getAttribute("aria-checked")).toBe("true");
    // Nothing can be saved before the one field without a default is picked, and the button says what is missing.
    expect((within(sheet).getByRole("button", { name: "Pick male or female first" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(sheet).getByRole("radio", { name: "Male" }));
    expect((within(sheet).getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("saving the profile writes settings and the first weigh-in, and the card turns into today's targets", async () => {
    renderHome();
    fireEvent.click(await screen.findByRole("button", { name: "Set up · 30 seconds" }));
    const sheet = await screen.findByRole("dialog", { name: "You and your goal" });
    fireEvent.click(within(sheet).getByRole("radio", { name: "Male" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Increase height" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Decrease weight" }));
    fireEvent.click(within(sheet).getByRole("radio", { name: /^Fast/ }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));

    await waitFor(async () => expect(await settingsRow()).toMatchObject({ sex: "male", birth_year: 1986, height_cm: 181, goal: "cut", cut_rate_pct: 0.75, job_activity: "desk", body_adjust_since: null }));
    await waitFor(async () => expect((await bodyLog())?.weight_kg).toBe(84.5));
    expect(screen.queryByRole("dialog")).toBeNull();

    const card = await screen.findByRole("region", { name: "Today's targets" });
    expect(screen.queryByRole("region", { name: "Fat loss targets" })).toBeNull();
    expect(within(card).getByRole("button", { name: /^\d[\d\s]* kcal a day/ })).toBeTruthy();
    expect(within(card).getByRole("button", { name: /^Protein/ })).toBeTruthy();
    expect(within(card).getByRole("button", { name: /^Steps/ })).toBeTruthy();
    expect(within(card).getByRole("button", { name: /^Weight.*84\.5 kg/ })).toBeTruthy();
  });
});

describe("Today · body card with a complete profile", () => {
  beforeEach(() => completeProfile(85));

  it("one tap adds 25 g of protein through the data layer, twice makes 50", async () => {
    renderHome();
    const card = await screen.findByRole("region", { name: "Today's targets" });
    const add = within(card).getByRole("button", { name: "Add 25 grams of protein" });
    fireEvent.click(add);
    await waitFor(async () => expect((await bodyLog())?.protein_g).toBe(25));
    expect(await within(card).findByRole("button", { name: /^Protein\s*25\s*\/ \d+ g/ })).toBeTruthy();
    fireEvent.click(add);
    await waitFor(async () => expect((await bodyLog())?.protein_g).toBe(50));
    // The weigh-in of the same day is untouched, and no sheet opened.
    expect((await bodyLog())?.weight_kg).toBe(85);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the protein sheet sets the day's total, with calories optional", async () => {
    renderHome();
    const card = await screen.findByRole("region", { name: "Today's targets" });
    fireEvent.click(within(card).getByRole("button", { name: /^Protein/ }));
    const sheet = await screen.findByRole("dialog", { name: "Protein today" });
    expect(within(sheet).getByText(/^Target \d+ g$/)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "+30" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "+40" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Increase protein" }));
    expect(within(sheet).getByRole("button", { name: /^Protein 75 g/ })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await bodyLog())?.protein_g).toBe(75));
    expect((await bodyLog())?.kcal).toBeNull();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("the steps sheet saves the number read from the Health app", async () => {
    renderHome();
    const card = await screen.findByRole("region", { name: "Today's targets" });
    fireEvent.click(within(card).getByRole("button", { name: /^Steps/ }));
    const sheet = await screen.findByRole("dialog", { name: "Steps today" });
    expect(within(sheet).getByText("Target 8 000")).toBeTruthy();
    for (let i = 0; i < 3; i++) fireEvent.click(within(sheet).getByRole("button", { name: "Increase steps" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await bodyLog())?.steps).toBe(1500));
    expect(await within(card).findByRole("button", { name: /^Steps\s*1\s500\s*\/\s*8\s000/ })).toBeTruthy();
  });

  it("the weight sheet starts at the latest weigh-in and can add a waist measurement", async () => {
    renderHome();
    const card = await screen.findByRole("region", { name: "Today's targets" });
    fireEvent.click(within(card).getByRole("button", { name: /^Weight/ }));
    const sheet = await screen.findByRole("dialog", { name: "Body weight" });
    expect(within(sheet).getByRole("button", { name: /^Weight 85\.0 kg/ })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "Decrease weight" }));
    fireEvent.click(within(sheet).getByRole("button", { name: /^Add waist measurement/ }));
    expect(within(sheet).getByRole("button", { name: /^Waist 90\.0 cm/ })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(async () => expect(await bodyLog()).toMatchObject({ weight_kg: 84.9, waist_cm: 90 }));
  });

  it("the calorie line explains the targets and leads to the profile", async () => {
    renderHome();
    const card = await screen.findByRole("region", { name: "Today's targets" });
    fireEvent.click(within(card).getByRole("button", { name: /kcal a day/ }));
    const why = await screen.findByRole("dialog", { name: "Your daily targets" });
    for (const label of ["Calories", "Protein", "Steps"]) expect(within(why).getByText(label)).toBeTruthy();
    // The engine's reason, once, with the kcal figure grouped like every other number on screen.
    expect(within(why).getByText(/^About \d\s\d{3} kcal to hold weight, minus \d+ to lose/)).toBeTruthy();
    expect(why.textContent).not.toMatch(/Estimated maintenance/);
    expect(within(why).getByText(/^You do not have to count calories\./)).toBeTruthy();
    fireEvent.click(within(why).getByRole("button", { name: "Change goal or details" }));
    const profile = await screen.findByRole("dialog", { name: "You and your goal" });
    expect(within(profile).getByRole("radio", { name: "Male" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("dialog", { name: "Your daily targets" })).toBeNull();
  });

  it("a changed pace starts the weekly correction over from today, other edits leave it alone", async () => {
    renderHome();
    const openProfile = async () => {
      const card = await screen.findByRole("region", { name: "Today's targets" });
      fireEvent.click(within(card).getByRole("button", { name: /kcal a day/ }));
      const why = await screen.findByRole("dialog", { name: "Your daily targets" });
      fireEvent.click(within(why).getByRole("button", { name: "Change goal or details" }));
      return screen.findByRole("dialog", { name: "You and your goal" });
    };
    let sheet = await openProfile();
    fireEvent.click(within(sheet).getByRole("button", { name: "Increase height" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await settingsRow())?.height_cm).toBe(181));
    expect(await settingsRow()).toMatchObject({ body_adjust_since: null, body_adjust_base_kcal: 0 });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    sheet = await openProfile();
    fireEvent.click(within(sheet).getByRole("radio", { name: /^Fast/ }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(async () => expect(await settingsRow()).toMatchObject({ cut_rate_pct: 0.75, body_adjust_since: TODAY, body_adjust_base_kcal: 0 }));
  });
});
