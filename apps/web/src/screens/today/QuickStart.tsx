/**
 * Dock bar before the first set: the first set of the plan with a big check, in the bottom third.
 * Cold open → one tap logs it and starts the session (SPEC 9, criterion 1). A set without a weight yet
 * (calibration) scrolls to its row and opens the steppers there, so Done is the second tap.
 */
import type { PlannedExercise, PlannedSet } from "@gym/engine";
import { CheckIcon, SetFigure } from "../../components";
import { cx } from "../../lib/cx";

export interface QuickStartBarProps {
  exercise: PlannedExercise;
  set: PlannedSet;
  onConfirm: () => void;
  onPick: () => void;
  busy?: boolean;
  className?: string;
}

export function QuickStartBar({ exercise: ex, set, onConfirm, onPick, busy, className }: QuickStartBarProps) {
  const pick = set.weight == null;
  const setWord = set.kind === "top" ? "top set" : `set ${set.index + 1} of ${ex.sets.length}`;
  return (
    <div
      className={cx("flex items-center gap-3 rounded-[4px] border border-line bg-ink-2 py-2 pl-4 pr-2 shadow-[0_8px_24px_rgba(0,0,0,0.45)]", className)}
      role="group"
      aria-label="Start with"
    >
      <button type="button" onClick={onPick} className="min-w-0 flex-1 text-left" aria-label={`Adjust ${ex.name} ${setWord}`}>
        <span className="block truncate text-[10.5px] uppercase tracking-[0.14em] text-paper-faint">Start with · {setWord}</span>
        <span className="mt-0.5 block truncate text-[15px] font-medium leading-tight text-paper">{ex.name}</span>
        <span className="mt-1 block">
          <SetFigure weight={set.weight} reps={set.reps} rir={set.rir} ex={ex} small />
        </span>
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={pick ? onPick : onConfirm}
        aria-label={pick ? `Pick weight for ${ex.name} ${setWord}` : `Confirm ${ex.name} ${setWord}`}
        className="gym-press grid h-14 w-14 shrink-0 place-items-center rounded-full bg-orange text-ink shadow-[0_0_0_4px_rgba(242,103,22,0.18)] transition-transform duration-100 disabled:opacity-60 motion-reduce:transition-none"
      >
        <CheckIcon size={26} strokeWidth={2.25} />
      </button>
    </div>
  );
}
