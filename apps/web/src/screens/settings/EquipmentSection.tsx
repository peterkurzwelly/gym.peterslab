/** Equipment: the smallest load step per exercise at Peter's gym. Targets round to it. */
import type { Exercise, Settings } from "@gym/schema";
import { Card } from "../../components";
import { updateSettings } from "../../data";
import { fmtKg } from "../../lib/format";
import { Field, Section } from "./fields";
import { OverrideList } from "./OverrideList";
import type { SettingsDefaults } from "./useSettingsData";

const QUICK_STEP = [1, 1.25, 2, 2.5, 5, 10] as const;

const loaded = (ex: Exercise) => ex.measure === "reps" || ex.measure === "meters";

export function EquipmentSection({ index, settings, defaults, exercises }: { index: string; settings: Settings; defaults: SettingsDefaults; exercises: Record<string, Exercise> }) {
  return (
    <Section id="equipment" index={index} title="Equipment">
      <Card>
        <Field
          label="Load steps"
          help="Dumbbells in 2 or 2.5 kg steps, a machine stack in 5 or 7 kg. Set what your gym has and targets round to it."
        >
          <OverrideList
            entries={settings.increment_overrides}
            exercises={exercises}
            programIds={defaults.programIds}
            onChange={(increment_overrides) => void updateSettings({ increment_overrides })}
            defaultFor={(ex) => ex.increment_kg}
            format={fmtKg}
            valueLabel="Step"
            unit="kg"
            step={0.25}
            min={0.25}
            max={20}
            inputMode="decimal"
            quick={QUICK_STEP}
            filter={loaded}
            addLabel="Add a load step"
            emptyText="Library steps: barbell 2.5 · dumbbells 2 · machines 5 kg."
          />
        </Field>
      </Card>
    </Section>
  );
}
