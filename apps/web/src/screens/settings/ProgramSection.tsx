/** Program: block start, week 1 start %, remembered weights, interval modality, limitations, evening hour, week killers. */
import { useId, useState } from "react";
import type { Exercise, Settings, WeekKiller } from "@gym/schema";
import { Card, SegmentedControl, Stepper, Toggle } from "../../components";
import { updateSettings } from "../../data";
import { Field, Rule, Section, TextInput } from "./fields";
import { fmtHour, fmtPct } from "./lib";
import { RememberedWeights } from "./RememberedWeights";
import type { SettingsDefaults } from "./useSettingsData";

const MODALITY = [
  { value: "bike", label: "Bike" },
  { value: "rower", label: "Rower" },
  { value: "both", label: "Both" },
] as const;

const KILLERS: { value: WeekKiller; label: string; description: string }[] = [
  { value: "work_peaks", label: "Work peaks", description: "Lead with ★ 30 min when the floor is at risk." },
  { value: "travel", label: "Travel", description: "Keep the travel version one tap away." },
  { value: "evenings", label: "Evenings", description: "Lead with ★ 30 min after the evening hour." },
  { value: "low_energy", label: "Low energy", description: "The check-in already trims the session on low days." },
];

const DATE_RE = /^(20[2-9]\d)-\d{2}-\d{2}$/;

export interface ProgramSectionProps {
  index: string;
  settings: Settings;
  defaults: SettingsDefaults;
  exercises: Record<string, Exercise>;
}

export function ProgramSection({ index, settings, defaults, exercises }: ProgramSectionProps) {
  const { program, calibration, mainIds, programIds } = defaults;
  const dateId = useId();
  const [dateDraft, setDateDraft] = useState<string | null>(null);
  const eveningOn = settings.evening_hour != null;
  const killers = new Set(settings.week_killers);

  const saveDate = (v: string) => {
    if (DATE_RE.test(v) && v !== settings.block_start_date) void updateSettings({ block_start_date: v });
    setDateDraft(null);
  };

  const toggleLimitation = (key: string, on: boolean) => {
    const rest = settings.limitations.filter((l) => l !== key);
    void updateSettings({ limitations: on ? [...rest, key] : rest });
  };

  const toggleKiller = (k: WeekKiller, on: boolean) => {
    const rest = settings.week_killers.filter((x) => x !== k);
    // Keep config order so the row reads the same everywhere.
    const next = on ? KILLERS.map((x) => x.value).filter((v) => v === k || rest.includes(v)) : rest;
    void updateSettings({ week_killers: next });
  };

  return (
    <Section id="program" index={index} title="Program" right={<span className="text-paper-faint">Block {settings.block_number}</span>}>
      <Card>
        <div className="flex flex-col gap-4">
          <Field label="Block start" htmlFor={dateId} help="Week 1 is the Monday to Sunday week of this date.">
            <TextInput
              id={dateId}
              type="date"
              value={dateDraft ?? settings.block_start_date}
              onChange={(e) => setDateDraft(e.target.value)}
              onBlur={(e) => saveDate(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveDate((e.target as HTMLInputElement).value);
              }}
              className="appearance-none"
            />
          </Field>

          <Rule />

          <Field label="Week 1 start" help="Share of your remembered weights for the first sessions. It should feel light.">
            <Stepper
              label="Start"
              hideLabel
              value={settings.start_pct}
              onChange={(v) => void updateSettings({ start_pct: Math.min(calibration.max, Math.max(calibration.min, Math.round(v * 100) / 100)) })}
              step={0.05}
              min={calibration.min}
              max={calibration.max}
              format={fmtPct}
              inputMode="decimal"
            />
          </Field>

          <Rule />

          <Field label="Remembered working weights" help={`A recent set you could do for those reps, not a max. Week 1 starts at ${fmtPct(settings.start_pct)} of it.`}>
            <RememberedWeights
              entries={settings.remembered_weights}
              mainIds={mainIds}
              exercises={exercises}
              programIds={programIds}
              incrementOverrides={settings.increment_overrides}
              onChange={(remembered_weights) => void updateSettings({ remembered_weights })}
            />
          </Field>
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-4">
          <Field label="Intervals on" help="Bike or rower keeps the 4x4 easy on the legs before A and B.">
            <SegmentedControl label="Interval modality" options={MODALITY} value={settings.interval_modality} onChange={(interval_modality) => void updateSettings({ interval_modality })} />
          </Field>

          <Rule />

          <Field label="Limitations" help="Exercise choices follow these. Off means the program as written.">
            <div className="flex flex-col">
              {Object.entries(program.limitations).map(([key, lim]) => (
                <Toggle key={key} label={lim.label} description={lim.description} checked={settings.limitations.includes(key)} onChange={(on) => toggleLimitation(key, on)} />
              ))}
            </div>
          </Field>
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-4">
          <Field label="What usually kills your week" help="The app pushes the fallback that fits.">
            <div className="flex flex-col">
              {KILLERS.map((k) => (
                <Toggle key={k.value} label={k.label} description={k.description} checked={killers.has(k.value)} onChange={(on) => toggleKiller(k.value, on)} />
              ))}
            </div>
          </Field>

          <Rule />

          <Field label="Evening hour" help={eveningOn ? `From ${fmtHour(settings.evening_hour!)} Today leads with the ★ 30 min version.` : "Off. Today leads with the full session at any hour."}>
            <Toggle
              label="Lead with ★ 30 min in the evening"
              checked={eveningOn}
              onChange={(on) => void updateSettings({ evening_hour: on ? defaults.eveningDefault : null })}
              description={!killers.has("evenings") && eveningOn ? "Turn on Evenings above for this to apply." : undefined}
            />
            {eveningOn && (
              <Stepper
                label="From"
                value={settings.evening_hour!}
                onChange={(v) => void updateSettings({ evening_hour: Math.min(23, Math.max(0, Math.round(v))) })}
                step={1}
                min={0}
                max={23}
                format={fmtHour}
                inputMode="numeric"
              />
            )}
          </Field>
        </div>
      </Card>
    </Section>
  );
}
