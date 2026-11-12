import type { PlannedExercise } from "@gym/engine";
import { cx } from "../lib/cx";
import { fmtRangeAmount } from "../lib/format";
import { ChevronIcon, CloseIcon } from "./Icons";
import { plain } from "../lib/plain";

export interface AlternativesPanelProps {
  exercise: PlannedExercise;
  onSelect: (exerciseId: string) => void;
  onClose?: () => void;
  className?: string;
}

/** Inline swap list. Allowed options are buttons; filtered ones stay visible with the reason. */
export function AlternativesPanel({ exercise, onSelect, onClose, className }: AlternativesPanelProps) {
  const options = exercise.alternatives.filter((a) => a.exercise_id !== exercise.exercise_id);
  // A limitation swap exists because the default is avoided, so do not offer it back.
  const primaryListed = exercise.alternatives.some((a) => a.exercise_id === exercise.primary_exercise_id);
  const offerPrimary = exercise.swapped != null && exercise.swapped !== "limitation" && !primaryListed;
  return (
    <div className={cx("border-y border-line bg-night/60", className)} role="group" aria-label={`Alternatives for ${exercise.name}`}>
      <div className="flex min-h-11 items-center justify-between pl-4">
        <span className="text-[11px] uppercase tracking-[0.08em] text-fg-faint">Swap for today</span>
        {onClose && (
          <button type="button" aria-label="Close alternatives" onClick={onClose} className="grid h-11 w-11 place-items-center text-fg-dim active:bg-raise">
            <CloseIcon size={18} />
          </button>
        )}
      </div>
      <ul className="m-0 list-none p-0">
        {offerPrimary && (
          <li className="border-t border-line/70">
            <button type="button" onClick={() => onSelect(exercise.primary_exercise_id)} className="gym-press flex min-h-12 w-full items-center gap-3 px-4 text-left active:bg-raise">
              <span className="flex-1 text-[14px] text-fg">Back to the program exercise</span>
              <ChevronIcon size={18} className="text-fg-faint" />
            </button>
          </li>
        )}
        {options.map((a) =>
          a.allowed ? (
            <li key={a.exercise_id} className="border-t border-line/70">
              <button type="button" onClick={() => onSelect(a.exercise_id)} className="gym-press flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left active:bg-raise">
                <span className="min-w-0 flex-1 text-[14px] text-fg">{a.name}</span>
                <span className="shrink-0 text-[12px] tabular-nums text-fg-dim">{fmtRangeAmount(a.rep_min, a.rep_max, { measure: a.measure })}</span>
                <ChevronIcon size={18} className="shrink-0 text-fg-faint" />
              </button>
            </li>
          ) : (
            <li key={a.exercise_id} className="flex min-h-12 flex-col justify-center border-t border-line/70 px-4 py-2" aria-disabled="true">
              <span className="text-[14px] text-fg-faint line-through decoration-fg-faint/50">{a.name}</span>
              {a.reason && <span className="text-[12px] leading-snug text-fg-faint">{plain(a.reason)}</span>}
            </li>
          ),
        )}
        {options.length === 0 && <li className="border-t border-line/70 px-4 py-3 text-[13px] text-fg-faint">No alternatives listed for this exercise.</li>}
      </ul>
    </div>
  );
}
