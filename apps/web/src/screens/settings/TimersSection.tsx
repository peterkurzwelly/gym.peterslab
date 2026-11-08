/** Timers and sound: the rest timer beep and optional per exercise rest overrides. */
import type { Exercise, Settings } from "@gym/schema";
import { Card, Toggle } from "../../components";
import { updateSettings } from "../../data";
import { fmtClock } from "../../lib/format";
import { setSoundEnabled } from "../../lib/sound";
import { Field, Rule, Section } from "./fields";
import { OverrideList } from "./OverrideList";
import type { SettingsDefaults } from "./useSettingsData";

const QUICK_REST = [60, 90, 120, 150, 180, 240] as const;

export function TimersSection({ index, settings, defaults, exercises }: { index: string; settings: Settings; defaults: SettingsDefaults; exercises: Record<string, Exercise> }) {
  const restDefault = (ex: Exercise) => defaults.programRest[ex.id] ?? ex.default_rest_s;
  return (
    <Section id="timers" index={index} title="Timers and sound">
      <Card>
        <div className="flex flex-col gap-4">
          <Toggle
            label="Sound"
            description="A short beep when rest is over. The screen flashes either way."
            checked={settings.sound}
            onChange={(sound) => {
              setSoundEnabled(sound);
              void updateSettings({ sound });
            }}
          />
          <Rule />
          <Field label="Rest per exercise" help="Optional. Without an entry the rest comes from the program.">
            <OverrideList
              entries={settings.rest_overrides}
              exercises={exercises}
              programIds={defaults.programIds}
              onChange={(rest_overrides) => void updateSettings({ rest_overrides })}
              defaultFor={restDefault}
              format={fmtClock}
              valueLabel="Rest"
              step={15}
              min={15}
              max={600}
              inputMode="numeric"
              quick={QUICK_REST}
              addLabel="Add a rest time"
              emptyText="No rest overrides."
            />
          </Field>
        </div>
      </Card>
    </Section>
  );
}
