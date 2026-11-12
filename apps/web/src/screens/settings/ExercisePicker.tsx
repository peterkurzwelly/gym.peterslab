/** Inline exercise picker: search the library (plus custom exercises), program exercises first. Not a modal. */
import { useId, useMemo, useState } from "react";
import type { Exercise } from "@gym/schema";
import { Button, PlusIcon } from "../../components";
import { TextInput } from "./fields";

export interface ExercisePickerProps {
  exercises: readonly Exercise[];
  /** Exercise ids in Peter's program; listed first when the search is empty. */
  programIds?: ReadonlySet<string>;
  /** Already chosen, hidden from the list. */
  exclude?: ReadonlySet<string>;
  /** Hide exercises this list makes no sense for (e.g. bodyweight for remembered weights). */
  filter?: (ex: Exercise) => boolean;
  onPick: (exerciseId: string) => void;
  onCancel: () => void;
  /** Visible caption, e.g. "Add an exercise". */
  title: string;
}

const EQUIPMENT: Record<string, string> = {
  barbell: "barbell",
  trap_bar: "trap bar",
  dumbbell: "dumbbells",
  kettlebell: "kettlebell",
  cable: "cable",
  machine: "machine",
  bodyweight: "bodyweight",
  band: "band",
  bench: "bench",
  other: "other",
};

const MAX_ROWS = 40;

export function ExercisePicker({ exercises, programIds, exclude, filter, onPick, onCancel, title }: ExercisePickerProps) {
  const [query, setQuery] = useState("");
  const searchId = useId();

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = exercises.filter((ex) => !exclude?.has(ex.id) && (!filter || filter(ex)));
    const matched = q
      ? list.filter((ex) => ex.name.toLowerCase().includes(q) || ex.id.includes(q.replace(/\s+/g, "_")) || (EQUIPMENT[ex.equipment] ?? "").includes(q))
      : list;
    const rank = (ex: Exercise) => (q && ex.name.toLowerCase().startsWith(q) ? 0 : !q && programIds?.has(ex.id) ? 0 : 1);
    return matched.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, MAX_ROWS);
  }, [exercises, exclude, filter, programIds, query]);

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-fg/30 bg-night p-3" role="group" aria-label={title}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={searchId} className="text-[11px] uppercase tracking-[0.08em] text-fg-faint">
          {title}
        </label>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <TextInput
        id={searchId}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search, e.g. curl or machine"
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
      />
      <ul className="m-0 flex max-h-[320px] list-none flex-col overflow-y-auto overscroll-contain p-0" aria-label="Exercises">
        {rows.map((ex) => (
          <li key={ex.id}>
            <button
              type="button"
              onClick={() => onPick(ex.id)}
              className="gym-press flex min-h-11 w-full items-center gap-3 rounded-2xl px-1 py-1.5 text-left active:bg-raise"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] text-fg">{ex.name}</span>
                <span className="block text-[11.5px] text-fg-faint">
                  {EQUIPMENT[ex.equipment] ?? ex.equipment}
                  {programIds?.has(ex.id) ? " · in your program" : ""}
                  {ex.custom ? " · custom" : ""}
                </span>
              </span>
              <PlusIcon size={18} className="shrink-0 text-fg-dim" />
            </button>
          </li>
        ))}
        {rows.length === 0 && <li className="px-1 py-3 text-[13px] text-fg-faint">Nothing matches. Try a shorter word.</li>}
      </ul>
    </div>
  );
}
