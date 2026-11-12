import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "@gym/schema";
import { setClock } from "../../src/data/clock";
import { db } from "../../src/data/db";
import * as repo from "../../src/data/repo";
import { exportLocal } from "../../src/data/backup";
import { SettingsScreen } from "../../src/screens/Settings";
import { fmtAgo, fmtBytes, pendingText, syncStateText, testSyncKey } from "../../src/screens/settings/lib";
import { resetDb } from "../data/helpers";

const settingsRow = async (): Promise<Settings> => {
  const s = await db.settings.get("settings");
  if (!s) throw new Error("no settings row");
  return s;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function renderSettings() {
  render(<SettingsScreen />);
  await screen.findByRole("region", { name: "Program" });
}

beforeEach(async () => {
  await resetDb();
  await repo.ensureSettings();
});

afterEach(() => {
  cleanup();
  setClock(null);
  vi.unstubAllGlobals();
});

describe("SettingsScreen · You", () => {
  it("is titled You and jumps to every section", async () => {
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id);
    };
    await renderSettings();
    expect(screen.getByRole("heading", { level: 1, name: "You" })).toBeTruthy();
    const jumps = within(screen.getByRole("navigation", { name: "Settings sections" })).getAllByRole("button");
    expect(jumps.map((b) => b.textContent)).toEqual(["Goal", "Sync", "Program", "Timers", "Equipment", "Data", "About"]);
    await screen.findByRole("region", { name: "Your goal" });
    for (const b of jumps) fireEvent.click(b);
    // Every chip finds its section on the page.
    expect(scrolled).toEqual(["goal", "sync", "program", "timers", "equipment", "data", "about"]);
  });

  it("the goal section asks for the four numbers first and opens the profile sheet", async () => {
    await renderSettings();
    const goal = await screen.findByRole("region", { name: "Your goal" });
    expect(within(goal).getByRole("heading", { level: 2, name: "Lose fat, keep muscle" })).toBeTruthy();
    expect(within(goal).getByText(/^Add four numbers and the app works out your calories, protein and steps/)).toBeTruthy();
    expect(within(goal).queryByText("Calories")).toBeNull();
    fireEvent.click(within(goal).getByRole("button", { name: /^Set up/ }));
    expect(await screen.findByRole("dialog", { name: "You and your goal" })).toBeTruthy();
  });

  it("with the profile filled in, the goal section shows who you are and the daily targets", async () => {
    await repo.updateSettings({ sex: "male", birth_year: 1986, height_cm: 180, goal_weight_kg: 80 });
    setClock(() => "2026-11-09T07:00:00.000Z");
    await repo.saveBodyLog("2026-11-09", { weight_kg: 85 });
    await renderSettings();
    const goal = await screen.findByRole("region", { name: "Your goal" });
    expect(await within(goal).findByText(/^Born 1986 · 180 cm · 85\.0 kg · desk job · 0\.5% of body weight a week · goal 80\.0 kg$/)).toBeTruthy();
    // 2 g of protein per kg, the default 8 000 steps, and calories from the engine.
    expect(within(goal).getByText("Protein").parentElement!.textContent).toBe("Protein170g a day");
    expect(within(goal).getByText("Steps").parentElement!.textContent).toMatch(/^Steps8\s000a day$/);
    expect(within(goal).getByText("Calories").parentElement!.textContent).toMatch(/^Calories\d\s\d{3}kcal a day$/);
    expect(within(goal).queryByRole("button", { name: /^Set up/ })).toBeNull();

    // Changing the goal goes through the same sheet and is stored.
    fireEvent.click(within(goal).getByRole("button", { name: "Change goal or details" }));
    const sheet = await screen.findByRole("dialog", { name: "You and your goal" });
    fireEvent.click(within(within(sheet).getByRole("radiogroup", { name: "Goal" })).getByRole("radio", { name: "Build" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await settingsRow()).goal).toBe("gain"));
    expect(await within(goal).findByRole("heading", { level: 2, name: "Build muscle" })).toBeTruthy();
  });
});

describe("SettingsScreen", () => {
  it("shows the goal and all six sections, with the four main lifts first", async () => {
    await renderSettings();
    for (const name of ["Sync", "Program", "Timers and sound", "Equipment", "Data", "About"]) {
      expect(screen.getByRole("region", { name })).toBeTruthy();
    }
    expect(await screen.findByRole("region", { name: "Your goal" })).toBeTruthy();
    const program = screen.getByRole("region", { name: "Program" });
    const lifts = within(program)
      .getAllByRole("button", { name: /: not set\. Edit$/ })
      .map((b) => b.getAttribute("aria-label")!.split(":")[0]);
    expect(lifts).toEqual(["Back squat", "Bench press", "Trap bar deadlift", "Barbell overhead press"]);
    expect(screen.getByText(/Logging works offline/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /GitHub/ }).getAttribute("href")).toBe("https://github.com/peterkurzwelly/gym.peterslab");
  });

  it("creates the settings row when it is missing", async () => {
    await resetDb();
    render(<SettingsScreen />);
    await screen.findByRole("region", { name: "Program" });
    expect(await db.settings.get("settings")).toBeDefined();
  });

  it("saves a remembered weight only on Save", async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Back squat: not set. Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Increase weight" }));
    fireEvent.click(screen.getByRole("button", { name: "Decrease reps" }));
    expect((await settingsRow()).remembered_weights.back_squat).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await settingsRow()).remembered_weights.back_squat).toEqual({ weight: 62.5, reps: 7 }));
    expect(await screen.findByRole("button", { name: "Back squat: 62.5 kg × 7. Edit" })).toBeTruthy();
  });

  it("adds another exercise to remembered weights from the library", async () => {
    await renderSettings();
    const program = screen.getByRole("region", { name: "Program" });
    fireEvent.click(within(program).getByRole("button", { name: "Add another exercise" }));
    fireEvent.change(within(program).getByRole("searchbox"), { target: { value: "leg press" } });
    fireEvent.click(within(program).getByRole("button", { name: /^Leg press/ }));
    fireEvent.click(within(program).getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await settingsRow()).remembered_weights.leg_press).toEqual({ weight: 50, reps: 8 }));
  });

  it("writes program switches through updateSettings", async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole("radio", { name: "Rower" }));
    fireEvent.click(screen.getByRole("switch", { name: /Knee friendly/ }));
    fireEvent.click(screen.getByRole("switch", { name: /Low energy/ }));
    fireEvent.click(screen.getByRole("button", { name: "Increase start" }));
    await waitFor(async () => {
      const s = await settingsRow();
      expect(s.interval_modality).toBe("rower");
      expect(s.limitations).toEqual(["knee_friendly"]);
      expect(s.week_killers).toContain("low_energy");
      expect(s.start_pct).toBe(0.65);
    });
  });

  it("turns the evening hour off and back on", async () => {
    await renderSettings();
    const toggle = screen.getByRole("switch", { name: /Suggest 30 min in the evening/ });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    await waitFor(async () => expect((await settingsRow()).evening_hour).toBeNull());
    await waitFor(() => expect(screen.getByRole("switch", { name: /Suggest 30 min in the evening/ }).getAttribute("aria-checked")).toBe("false"));
    expect(screen.getByText("Off. Today leads with the full session at any hour.")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: /Suggest 30 min in the evening/ }));
    await waitFor(async () => expect((await settingsRow()).evening_hour).toBe(19));
    fireEvent.click(await screen.findByRole("button", { name: "Increase from" }));
    await waitFor(async () => expect((await settingsRow()).evening_hour).toBe(20));
  });

  it("sound off writes settings", async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole("switch", { name: /Sound/ }));
    await waitFor(async () => expect((await settingsRow()).sound).toBe(false));
  });

  it("adds a rest override starting at the program rest", async () => {
    await renderSettings();
    const timers = screen.getByRole("region", { name: "Timers and sound" });
    fireEvent.click(within(timers).getByRole("button", { name: "Add a rest time" }));
    fireEvent.change(within(timers).getByRole("searchbox"), { target: { value: "lateral raise" } });
    fireEvent.click(within(timers).getByRole("button", { name: /^Dumbbell lateral raise/ }));
    await waitFor(async () => expect((await settingsRow()).rest_overrides).toEqual({ lateral_raise: 60 }));
    fireEvent.click(await within(timers).findByRole("button", { name: "Increase rest" }));
    await waitFor(async () => expect((await settingsRow()).rest_overrides).toEqual({ lateral_raise: 75 }));
    fireEvent.click(within(timers).getByRole("button", { name: "Use default" }));
    await waitFor(async () => expect((await settingsRow()).rest_overrides).toEqual({}));
  });

  it("sets a dumbbell load step from the quick chips", async () => {
    await renderSettings();
    const eq = screen.getByRole("region", { name: "Equipment" });
    fireEvent.click(within(eq).getByRole("button", { name: "Add a load step" }));
    fireEvent.change(within(eq).getByRole("searchbox"), { target: { value: "incline dumbbell press" } });
    fireEvent.click(within(eq).getByRole("button", { name: /^Incline dumbbell press/ }));
    fireEvent.click(await within(eq).findByRole("button", { name: "2.5" }));
    await waitFor(async () => expect((await settingsRow()).increment_overrides).toEqual({ incline_dumbbell_press: 2.5 }));
  });

  it("tests the typed sync key and saves it on this device", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get("Authorization");
      return auth === "Bearer good-key-123456789" ? json(200, { ok: true, method: "token" }) : json(401, { error: "unauthorized", reason: "invalid_credentials" });
    });
    vi.stubGlobal("fetch", fetchMock);
    await renderSettings();
    const input = screen.getByLabelText("Sync key") as HTMLInputElement;
    expect(input.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Show key" }));
    expect(input.type).toBe("text");

    fireEvent.change(input, { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    expect(await screen.findByText(/does not know this key/)).toBeTruthy();

    fireEvent.change(input, { target: { value: " good-key-123456789 " } });
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    expect(await screen.findByText(/Key accepted/)).toBeTruthy();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/auth/check", expect.objectContaining({ method: "GET" }));

    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    await waitFor(async () => expect((await db.meta.get("sync_key"))?.value).toBe("good-key-123456789"));
    expect(input.value).toBe("");
    expect(await screen.findByText(/Key saved on this phone/)).toBeTruthy();

    // With the field empty, Test uses the stored key.
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    expect(await screen.findByText(/Key accepted/)).toBeTruthy();
  });

  it("merges an export file into this phone", async () => {
    const s = await repo.startSession({ code: "A", mode: "full" });
    const file = await exportLocal();
    await repo.discardSession(s.id);
    await renderSettings();

    const blob = new File([JSON.stringify(file)], "backup.json", { type: "application/json" });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Export file"), { target: { files: [blob] } });
    });
    expect(await screen.findByText("backup.json")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Import to this phone" }));
    expect(await screen.findByText(/Merged on this phone/)).toBeTruthy();
  });

  it("asks inline before a replace import", async () => {
    await repo.startSession({ code: "A", mode: "full" });
    const file = await exportLocal();
    const extra = await repo.startSession({ code: "B", mode: "full" });
    await renderSettings();

    const blob = new File([JSON.stringify(file)], "backup.json", { type: "application/json" });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Export file"), { target: { files: [blob] } });
    });
    await screen.findByText("backup.json");
    fireEvent.click(screen.getByRole("radio", { name: "Replace" }));
    fireEvent.click(screen.getByRole("button", { name: "Import to this phone" }));
    // Nothing written yet: the confirm is inline.
    expect((await db.session.get(extra.id))?.deleted_at).toBeNull();
    const confirm = screen.getByRole("group", { name: "Confirm replace" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Replace this phone" }));
    expect(await screen.findByText(/Replaced on this phone/)).toBeTruthy();
    expect((await db.session.get(extra.id))?.deleted_at).not.toBeNull();
  });

  it("explains a file that is not an export", async () => {
    await renderSettings();
    const blob = new File(["{\"hello\":1}"], "notes.json", { type: "application/json" });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Export file"), { target: { files: [blob] } });
    });
    expect(await screen.findByText(/Not a Workout OS export/)).toBeTruthy();
  });
});

describe("settings lib", () => {
  it("words sync states calmly", () => {
    const base = { lastSyncAt: null, pending: 0, lastError: null };
    expect(syncStateText({ ...base, state: "idle" })).toBe("Not synced yet");
    expect(syncStateText({ ...base, state: "idle", lastSyncAt: "2026-11-08T10:00:00.000Z" })).toBe("Up to date");
    expect(syncStateText({ ...base, state: "offline" })).toBe("Offline. Changes wait on this phone");
    expect(syncStateText({ ...base, state: "auth_required" })).toBe("Needs the sync key");
    expect(pendingText(0)).toBe("Nothing waiting");
    expect(pendingText(1)).toBe("1 change waiting");
    expect(pendingText(3)).toBe("3 changes waiting");
    for (const s of ["idle", "syncing", "offline", "auth_required", "error"] as const) {
      expect(syncStateText({ ...base, state: s })).not.toMatch(/fail/i);
    }
  });

  it("formats times and sizes", () => {
    const now = Date.parse("2026-11-08T12:00:00.000Z");
    expect(fmtAgo(null, now)).toBe("never");
    expect(fmtAgo("2026-11-08T11:59:40.000Z", now)).toBe("just now");
    expect(fmtAgo("2026-11-08T11:56:00.000Z", now)).toBe("4 min ago");
    expect(fmtAgo("2026-11-08T10:00:00.000Z", now)).toBe("2 h ago");
    expect(fmtBytes(null)).toBe("unknown");
    expect(fmtBytes(1536)).toBe("1.5 KB");
    expect(fmtBytes(25 * 1024 * 1024)).toBe("25 MB");
  });

  it("maps auth check answers", async () => {
    const answer = (status: number, body: unknown) => vi.fn(async () => json(status, body)) as unknown as typeof fetch;
    expect((await testSyncKey("k", answer(200, { ok: true, method: "dev" }))).outcome).toBe("dev");
    expect((await testSyncKey("k", answer(200, { ok: true, method: "access" }))).outcome).toBe("access");
    expect((await testSyncKey("k", answer(401, { reason: "auth_not_configured" }))).outcome).toBe("not_configured");
    expect((await testSyncKey(null, answer(401, { reason: "missing_credentials" }))).outcome).toBe("missing");
    expect((await testSyncKey("k", answer(500, {}))).ok).toBe(false);
    const offline = vi.fn(async () => {
      throw new TypeError("network");
    }) as unknown as typeof fetch;
    expect((await testSyncKey("k", offline)).outcome).toBe("offline");
  });
});
