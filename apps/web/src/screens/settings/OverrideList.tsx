/**
 * Per exercise number overrides (rest seconds, load increments). Optional list: empty means the
 * program and library defaults apply. Edits write straight through onChange.
 */
import { useMemo, useState } from "react";
import type { Exercise } from "@gym/schema";
import { Button, Chip, PlusIcon, Stepper } from "../../components";
import { cx } from "../../lib/cx";
import { ExercisePicker } from "./ExercisePicker";

export interface OverrideListProps {
  entries: Record<string, number>;
  exercises: Record<string, Exercise>;
  programIds: ReadonlySet<string>;
  onChange: (next: Record<string, number>) => void;
  /** Value a new entry starts at (the current default, so adding changes nothing until edited). */
  defaultFor: (ex: Exercise) => number;
  format: (n: number) => string;
  /** Stepper caption, e.g. "Rest". */
  valueLabel: string;
  unit?: string;
  step: number;
  min: number;
  max: number;
  inputMode?: "decimal" | "numeric";
  quick?: readonly number[];
  filter?: (ex: Exercise) => boolean;
  addLabel: string;
  emptyText: string;
}

export function OverrideList(props: OverrideListProps) {
  const { entries, exercises, programIds, onChange, defaultFor, format, valueLabel, unit, step, min, max, inputMode, quick, filter, addLabel, emptyText } = props;
  const [open, setOpen] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const ids = useMemo(
    () => Object.keys(entries).sort((a, b) => (exercises[a]?.name ?? a).localeCompare(exercises[b]?.name ?? b)),
    [entries, exercises],
  );
  const exclude = useMemo(() => new Set(ids), [ids]);
  const all = useMemo(() => Object.values(exercises), [exercises]);

  const set = (id: string, value: number) => onChange({ ...entries, [id]: value });
  const remove = (id: string) => {
    const next = { ...entries };
    delete next[id];
    onChange(next);
    setOpen(null);
  };

  return (
    <div className="flex flex-col">
      {ids.length === 0 && !picking && <p className="py-1 text-[13px] text-fg-faint">{emptyText}</p>}
      {ids.length > 0 && (
        <ul className="m-0 flex list-none flex-col divide-y divide-line/70 p-0">
          {ids.map((id) => {
            const ex = exercises[id];
            const value = entries[id]!;
            const isOpen = open === id;
            const name = ex?.name ?? id;
            const fallback = ex ? defaultFor(ex) : null;
            return (
              <li key={id} className="py-1">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : id)}
                  className="gym-press flex min-h-11 w-full items-center gap-3 rounded-2xl text-left active:bg-raise"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] text-fg">{name}</span>
                    {fallback != null && fallback !== value && <span className="block text-[11.5px] text-fg-faint">default {format(fallback)}</span>}
                  </span>
                  <span className="shrink-0 text-[15px] tabular-nums text-fg">
                    {format(value)}
                    {unit && <span className="ml-1 text-[11px] text-fg-dim">{unit}</span>}
                  </span>
                </button>
                {isOpen && (
                  <div className="flex flex-col gap-3 pb-2 pt-2">
                    <Stepper value={value} onChange={(v) => set(id, v)} step={step} min={min} max={max} label={valueLabel} format={format} unit={unit} inputMode={inputMode} />
                    {quick && (
                      <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Common ${valueLabel.toLowerCase()} values`}>
                        {quick.map((q) => (
                          <Chip key={q} selected={q === value} onClick={() => set(id, q)} className="text-[13px]">
                            {format(q)}
                          </Chip>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => remove(id)}>
                        Use default
                      </Button>
                      <Button variant="secondary" size="sm" className="ml-auto" onClick={() => setOpen(null)}>
                        Done
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {picking ? (
        <ExercisePicker
          title={addLabel}
          exercises={all}
          programIds={programIds}
          exclude={exclude}
          filter={filter}
          onCancel={() => setPicking(false)}
          onPick={(id) => {
            const ex = exercises[id];
            if (ex) set(id, defaultFor(ex));
            setPicking(false);
            setOpen(id);
          }}
        />
      ) : (
        <Button variant="ghost" size="sm" className={cx("self-start", ids.length > 0 && "mt-1")} icon={<PlusIcon size={16} />} onClick={() => setPicking(true)}>
          {addLabel}
        </Button>
      )}
    </div>
  );
}
