/**
 * Settings (gear in the header): Sync, Program, Timers and sound, Equipment, Data, About.
 * Every write goes through updateSettings or the data layer. No keyboard opens unless a field is tapped.
 */
import { useEffect } from "react";
import { Page, ShellTitle, Skeleton } from "../components";
import { ensureSettings, useSettings } from "../data";
import { AboutSection } from "./settings/AboutSection";
import { DataSection } from "./settings/DataSection";
import { EquipmentSection } from "./settings/EquipmentSection";
import { ProgramSection } from "./settings/ProgramSection";
import { SyncSection } from "./settings/SyncSection";
import { TimersSection } from "./settings/TimersSection";
import { settingsDefaults, useExercises } from "./settings/useSettingsData";

const JUMPS = [
  { id: "sync", label: "Sync" },
  { id: "program", label: "Program" },
  { id: "timers", label: "Timers" },
  { id: "equipment", label: "Equipment" },
  { id: "data", label: "Data" },
  { id: "about", label: "About" },
] as const;

export function SettingsScreen() {
  const settings = useSettings();
  const exercises = useExercises();
  const defaults = settingsDefaults();

  useEffect(() => {
    if (settings === null) void ensureSettings().catch(() => undefined);
  }, [settings]);

  return (
    <Page className="gap-8 pb-6">
      <ShellTitle>
        <span className="text-paper">Settings</span>
      </ShellTitle>

      <div className="flex flex-col gap-3">
        <h1 className="m-0 font-display text-[40px] font-normal leading-none text-paper">Settings</h1>
        <nav aria-label="Settings sections" className="-mx-1 flex flex-wrap gap-x-1 gap-y-0">
          {JUMPS.map((j) => (
            <button
              key={j.id}
              type="button"
              onClick={() => document.getElementById(j.id)?.scrollIntoView({ block: "start", behavior: "smooth" })}
              className="min-h-11 rounded-[3px] px-2 text-[11.5px] uppercase tracking-[0.12em] text-paper-dim active:bg-ink-3 active:text-paper"
            >
              {j.label}
            </button>
          ))}
        </nav>
      </div>

      <SyncSection index="01" />

      {settings ? (
        <>
          <ProgramSection index="02" settings={settings} defaults={defaults} exercises={exercises} />
          <TimersSection index="03" settings={settings} defaults={defaults} exercises={exercises} />
          <EquipmentSection index="04" settings={settings} defaults={defaults} exercises={exercises} />
        </>
      ) : (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading settings">
          <Skeleton height={180} />
          <Skeleton height={120} />
        </div>
      )}

      <DataSection index="05" />
      <AboutSection index="06" programName={defaults.program.name} />
    </Page>
  );
}
