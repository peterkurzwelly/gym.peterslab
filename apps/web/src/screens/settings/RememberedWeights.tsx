/**
 * Remembered working weights (weight × reps) for week 1 calibration. The four main lifts are always
 * listed first; any other loaded exercise can be added. Edits are drafts until Save: these numbers
 * set week 1, so nothing is written by a stray stepper tap.
 */
import { useMemo, useState } from "react";
import type { Exercise, RememberedWeight } from "@gym/schema";
import { Button, PlusIcon, Stepper } from "../../components";
import { fmtKg } from "../../lib/format";
import { ExercisePicker } from "./ExercisePicker";

export interface RememberedWeightsProps {
  entries: Record<string, RememberedWeight>;
  /** Main lift exercise ids in program order. */
  mainIds: readonly string[];
  exercises: Record<string, Exercise>;
  programIds: ReadonlySet<string>;
  incrementOverrides: Record<string, number>;
  onChange: (next: Record<string, RememberedWeight>) => void;
}

/** A starting point for the stepper only. Peter types or steps to his real number before saving. */
const START_KG: Partial<Record<Exercise["equipment"], number>> = {
  barbell: 60,
  trap_bar: 80,
  dumbbell: 16,
  kettlebell: 16,
  machine: 50,
  cable: 30,
};

const loadable = (ex: Exercise) => !ex.bodyweight && ex.measure === "reps";

export function RememberedWeights({ entries, mainIds, exercises, programIds, incrementOverrides, onChange }: RememberedWeightsProps) {
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<RememberedWeight>({ weight: 0, reps: 8 });
  const [picking, setPicking] = useState(false);
  /** Picked from the library but not saved yet: listed (open) until Save or Cancel. */
  const [added, setAdded] = useState<string | null>(null);

  const ids = useMemo(() => {
    const others = Object.keys(entries)
      .filter((id) => !mainIds.includes(id))
      .sort((a, b) => (exercises[a]?.name ?? a).localeCompare(exercises[b]?.name ?? b));
    const extra = added && !mainIds.includes(added) && !entries[added] ? [added] : [];
    return [...mainIds, ...others, ...extra];
  }, [entries, mainIds, exercises, added]);
  const exclude = useMemo(() => new Set(ids), [ids]);
  const all = useMemo(() => Object.values(exercises), [exercises]);

  const close = () => {
    setOpen(null);
    setAdded(null);
  };

  const edit = (id: string) => {
    if (open === id) return close();
    const ex = exercises[id];
    setDraft(entries[id] ?? { weight: (ex && START_KG[ex.equipment]) ?? 20, reps: 8 });
    setOpen(id);
  };

  const save = (id: string) => {
    onChange({ ...entries, [id]: { weight: draft.weight, reps: draft.reps } });
    close();
  };

  const clear = (id: string) => {
    const next = { ...entries };
    delete next[id];
    onChange(next);
    close();
  };

  return (
    <div className="flex flex-col">
      <ul className="m-0 flex list-none flex-col divide-y divide-line/70 p-0">
        {ids.map((id) => {
          const ex = exercises[id];
          const name = ex?.name ?? id;
          const rem = entries[id];
          const isOpen = open === id;
          const step = incrementOverrides[id] ?? ex?.increment_kg ?? 2.5;
          const perHand = ex?.per_hand ? "/hand" : "";
          return (
            <li key={id} className="py-1">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-label={`${name}: ${rem ? `${fmtKg(rem.weight)} kg${perHand} × ${rem.reps}` : "not set"}. Edit`}
                onClick={() => edit(id)}
                className="gym-press flex min-h-11 w-full items-center gap-3 rounded-2xl text-left active:bg-raise"
              >
                <span className="min-w-0 flex-1 truncate text-[14px] text-fg">{name}</span>
                {rem ? (
                  <span className="shrink-0 text-[15px] tabular-nums text-fg">
                    {fmtKg(rem.weight)}
                    <span className="text-[11px] text-fg-dim"> kg{perHand}</span> × {rem.reps}
                  </span>
                ) : (
                  <span className="shrink-0 text-[12px] uppercase tracking-[0.06em] text-fg-faint">Not set</span>
                )}
              </button>
              {isOpen && (
                <div className="flex flex-col gap-3 pb-2 pt-2">
                  <Stepper
                    label="Weight"
                    value={draft.weight}
                    onChange={(weight) => setDraft((d) => ({ ...d, weight }))}
                    step={step}
                    min={0}
                    max={500}
                    format={fmtKg}
                    unit={`kg${perHand}`}
                    inputMode="decimal"
                  />
                  <Stepper label="Reps" value={draft.reps} onChange={(reps) => setDraft((d) => ({ ...d, reps: Math.max(1, Math.round(reps)) }))} step={1} min={1} max={30} inputMode="numeric" />
                  <div className="flex gap-2">
                    {rem && (
                      <Button variant="ghost" size="sm" onClick={() => clear(id)}>
                        Clear
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" className="ml-auto" onClick={close}>
                      Cancel
                    </Button>
                    <Button variant="primary" size="sm" onClick={() => save(id)} disabled={draft.weight <= 0}>
                      Save
                    </Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {picking ? (
        <ExercisePicker
          title="Add another exercise"
          exercises={all}
          programIds={programIds}
          exclude={exclude}
          filter={loadable}
          onCancel={() => setPicking(false)}
          onPick={(id) => {
            setPicking(false);
            const ex = exercises[id];
            setDraft({ weight: (ex && START_KG[ex.equipment]) ?? 20, reps: 8 });
            setAdded(id);
            setOpen(id);
          }}
        />
      ) : (
        <Button variant="ghost" size="sm" className="mt-1 self-start" icon={<PlusIcon size={16} />} onClick={() => setPicking(true)}>
          Add another exercise
        </Button>
      )}
    </div>
  );
}
