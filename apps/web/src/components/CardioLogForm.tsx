import type { CardioIntensity, CardioModality } from "@gym/schema";
import { useState } from "react";
import { cx } from "../lib/cx";
import { Button } from "./Button";
import { ChipGroup } from "./Chip";
import { SegmentedControl } from "./SegmentedControl";
import { Stepper } from "./Stepper";

export interface CardioLogValues {
  modality: CardioModality;
  minutes: number;
  intensity: CardioIntensity;
  /** Minutes at hard intensity (from the interval timer), null when unknown. Always null for easy. */
  hard_minutes: number | null;
  avg_hr: number | null;
}

export interface CardioLogFormProps {
  /** Modality chips to offer, e.g. CardioPlan.modality_options plus walk. */
  modalities: readonly CardioModality[];
  initial?: Partial<CardioLogValues>;
  onSave: (values: CardioLogValues) => void;
  onCancel?: () => void;
  className?: string;
}

const MODALITY_LABEL: Record<CardioModality, string> = { bike: "Bike", rower: "Rower", run: "Run", walk: "Walk", other: "Other" };

export function CardioLogForm({ modalities, initial, onSave, onCancel, className }: CardioLogFormProps) {
  const [modality, setModality] = useState<CardioModality>(initial?.modality ?? modalities[0] ?? "bike");
  const [minutes, setMinutes] = useState(initial?.minutes ?? 30);
  const [intensity, setIntensity] = useState<CardioIntensity>(initial?.intensity ?? "easy");
  const [hr, setHr] = useState(initial?.avg_hr != null ? String(initial.avg_hr) : "");

  const hrNum = hr.trim() === "" ? null : Math.round(Number(hr));
  const hrValid = hrNum == null || (Number.isFinite(hrNum) && hrNum > 0 && hrNum < 250);

  return (
    <form
      className={cx("flex flex-col gap-4", className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (!hrValid || minutes <= 0) return;
        onSave({
          modality,
          minutes,
          intensity,
          hard_minutes: intensity === "hard" ? (initial?.hard_minutes ?? null) : null,
          avg_hr: hrNum,
        });
      }}
    >
      <div>
        <div className="mb-1.5 text-[11px] uppercase tracking-[0.14em] text-paper-faint">Modality</div>
        <ChipGroup label="Modality" value={modality} onChange={setModality} options={modalities.map((m) => ({ value: m, label: MODALITY_LABEL[m] }))} chipClassName="text-[14px]" />
      </div>
      <Stepper label="Minutes" value={minutes} step={5} min={0} max={600} onChange={setMinutes} unit="min" inputMode="numeric" />
      <div className="flex items-center gap-3">
        <span className="w-16 shrink-0 text-[11px] uppercase tracking-[0.14em] text-paper-faint">Effort</span>
        <SegmentedControl
          label="Intensity"
          className="flex-1"
          value={intensity}
          onChange={setIntensity}
          options={[
            { value: "easy", label: "Easy" },
            { value: "hard", label: "Hard" },
          ]}
        />
      </div>
      <label className="flex items-center gap-3">
        <span className="w-16 shrink-0 text-[11px] uppercase leading-tight tracking-[0.14em] text-paper-faint">Avg HR</span>
        <input
          inputMode="numeric"
          enterKeyHint="done"
          placeholder="optional"
          value={hr}
          onChange={(e) => setHr(e.target.value.replace(/[^\d]/g, ""))}
          aria-invalid={!hrValid}
          className="h-12 min-w-0 flex-1 rounded-[3px] border border-line bg-transparent px-3 font-mono text-[16px] tabular-nums text-paper placeholder:text-paper-faint focus:border-paper/60 focus:outline-none"
        />
        <span className="w-10 text-[12px] text-paper-faint">bpm</span>
      </label>
      <div className="mt-1 flex gap-2">
        <Button type="submit" variant="primary" size="lg" className="flex-1" disabled={!hrValid || minutes <= 0}>
          Save cardio
        </Button>
        {onCancel && (
          <Button variant="ghost" size="lg" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
