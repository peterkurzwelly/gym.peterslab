/**
 * The You tab: goal and body details first, then Sync, Program, Timers and sound, Equipment, Data, About.
 * Every write goes through updateSettings or the data layer. No keyboard opens unless a field is tapped.
 */
import { useEffect } from "react";
import { Page, PageTitle, ShellTitle, Skeleton } from "../components";
import { ensureSettings, useBody, useSettings } from "../data";
import { AboutSection } from "./settings/AboutSection";
import { DataSection } from "./settings/DataSection";
import { EquipmentSection } from "./settings/EquipmentSection";
import { GoalSection } from "./settings/GoalSection";
import { ProgramSection } from "./settings/ProgramSection";
import { SyncSection } from "./settings/SyncSection";
import { TimersSection } from "./settings/TimersSection";
import { settingsDefaults, useExercises } from "./settings/useSettingsData";

const JUMPS = [
  { id: "goal", label: "Goal" },
  { id: "sync", label: "Sync" },
  { id: "program", label: "Program" },
  { id: "timers", label: "Timers" },
  { id: "equipment", label: "Equipment" },
  { id: "data", label: "Data" },
  { id: "about", label: "About" },
] as const;

export function SettingsScreen() {
  const settings = useSettings();
  const body = useBody();
  const exercises = useExercises();
  const defaults = settingsDefaults();

  useEffect(() => {
    if (settings === null) void ensureSettings().catch(() => undefined);
  }, [settings]);

  return (
    <Page className="gap-8 pb-6">
      <ShellTitle>
        <span className="text-fg-dim">Workout OS</span>
      </ShellTitle>

      <div className="flex flex-col gap-2">
        <PageTitle eyebrow="Goal · sync · settings">You</PageTitle>
        <nav aria-label="Settings sections" className="gym-scroll-x -mx-4 flex gap-2 overflow-x-auto px-4">
          {JUMPS.map((j) => (
            <button
              key={j.id}
              type="button"
              onClick={() => document.getElementById(j.id)?.scrollIntoView({ block: "start", behavior: "smooth" })}
              className="min-h-10 shrink-0 rounded-full bg-card px-4 text-[13.5px] font-semibold text-fg-dim active:bg-raise active:text-fg"
            >
              {j.label}
            </button>
          ))}
        </nav>
      </div>

      {settings && body && <GoalSection settings={settings} body={body} />}

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
