/**
 * One set: target big, last time small, a large check button.
 * One tap on check confirms exactly the prescribed values. Tapping the numbers opens inline steppers.
 * No keyboard appears unless the user taps a stepper's number.
 */
import type { PlannedExercise, PlannedSet } from "@gym/engine";
import { useEffect, useRef, useState } from "react";
import { cx } from "../lib/cx";
import { effortTag } from "../lib/effort";
import { fmtKg, fmtLoad, sideSuffix } from "../lib/format";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { ChipGroup } from "./Chip";
import { CheckIcon, CloseIcon } from "./Icons";
import { Stepper } from "./Stepper";

export interface SetValues {
  weight: number;
  reps: number;
  rir: number | null;
}

export type SetRowExercise = Pick<PlannedExercise, "name" | "measure" | "per_side" | "per_hand" | "bodyweight" | "increment_kg">;

export interface SetRowProps {
  set: PlannedSet;
  exercise: SetRowExercise;
  /** The logged result for this set, if any. */
  logged?: SetValues | null;
  /** Next set up: highlighted, filled check button. */
  isNext?: boolean;
  /** Same set last time. */
  last?: SetValues | null;
  /** Used when the plan has no weight (calibration) but one was picked earlier this session. */
  fallbackWeight?: number | null;
  /** Editor start weight when calibrating with nothing picked yet. */
  startWeight?: number;
  onConfirm: (values: SetValues) => void;
  /** Removes the logged set (done rows only): a quiet "Remove set" in the editor. */
  onRemove?: () => void;
  /** Start in the editing state (Kit preview). */
  defaultEditing?: boolean;
  className?: string;
}

const RIR_OPTIONS = [0, 1, 2, 3, 4].map((n) => ({ value: n, label: n === 4 ? "4+" : n, ariaLabel: n === 0 ? "No reps left" : `${n}${n === 4 ? " or more" : ""} ${n === 1 ? "rep" : "reps"} left` }));

/** Calibration start: 20 kg for a barbell, else five increments. Bodyweight starts at bodyweight. */
export function calibrationStartWeight(ex: Pick<PlannedExercise, "increment_kg" | "bodyweight">, barbell: boolean): number {
  if (ex.bodyweight) return 0;
  return barbell ? 20 : Math.round(ex.increment_kg * 5 * 100) / 100;
}

/** Plain text for aria labels: "60 kg × 8, 3 left". */
export function describeSet(v: { weight: number | null; reps: number; rir: number | null }, ex: SetRowExercise): string {
  const amount = ex.measure === "seconds" ? `${v.reps} seconds` : ex.measure === "meters" ? `${v.reps} meters` : `${v.reps}${ex.per_side ? " per side" : ""}`;
  const load = v.weight == null ? "weight to pick" : ex.bodyweight ? (v.weight > 0 ? `bodyweight plus ${fmtKg(v.weight)} kg` : "bodyweight") : `${fmtKg(v.weight)} kg${ex.per_hand ? " per hand" : ""}`;
  return `${load} × ${amount}${v.rir != null ? `, ${effortTag(v.rir)}` : ""}`;
}

/** Hide the load for timed or distance bodyweight work (plank 30 s). */
function showsLoad(ex: SetRowExercise, weight: number | null): boolean {
  return !(ex.bodyweight && ex.measure !== "reps" && (weight ?? 0) === 0);
}

/** The big "80 kg × 8", with the effort as a small tag ("3 left"). */
export function SetFigure({ weight, reps, rir, ex, muted, small }: { weight: number | null; reps: number; rir: number | null; ex: SetRowExercise; muted?: boolean; small?: boolean }) {
  const big = small ? "text-[19px]" : "text-[32px]";
  const unit = small ? "text-[11px]" : "text-[13px]";
  const tone = muted ? "text-fg-dim" : "text-fg";
  const amountUnit = ex.measure === "seconds" ? " s" : ex.measure === "meters" ? " m" : sideSuffix(ex);
  return (
    <span className={cx("inline-flex flex-wrap items-baseline tabular-nums leading-none", tone)}>
      {weight == null ? (
        <span className={cx(small ? "text-[15px]" : "text-[19px]", "font-semibold text-volt")}>Pick weight</span>
      ) : (
        showsLoad(ex, weight) && (
          <>
            <span className={cx(big, "font-display")}>{ex.bodyweight ? fmtLoad(weight, { bodyweight: true }) : fmtKg(weight)}</span>
            {!ex.bodyweight && <span className={cx(unit, "ml-1 font-medium text-fg-dim")}>{ex.per_hand ? "kg each" : "kg"}</span>}
          </>
        )
      )}
      {(weight == null || showsLoad(ex, weight)) && <span className={cx(small ? "mx-1.5 text-[13px]" : "mx-2 text-[17px]", "text-fg-faint")}>×</span>}
      <span className={cx(big, "font-display")}>{reps}</span>
      <span className={cx(unit, "ml-1 font-medium text-fg-dim")}>{amountUnit ? amountUnit.trim() : ex.measure === "reps" ? "reps" : ""}</span>
      {rir != null && <span className={cx(small ? "text-[11px]" : "text-[12px]", "ml-2.5 self-center rounded-full bg-raise-2 px-2 py-[3px] font-semibold text-fg-dim")}>{effortTag(rir)}</span>}
    </span>
  );
}

export function SetRow({ set, exercise: ex, logged, isNext, last, fallbackWeight, startWeight, onConfirm, onRemove, defaultEditing, className }: SetRowProps) {
  const targetWeight = set.weight ?? fallbackWeight ?? null;
  const initialDraft = (): SetValues =>
    logged ? { ...logged } : { weight: targetWeight ?? startWeight ?? calibrationStartWeight(ex, false), reps: set.reps, rir: set.rir };
  const [editing, setEditing] = useState(!!defaultEditing);
  const [draft, setDraft] = useState<SetValues>(initialDraft);
  const editorRef = useRef<HTMLDivElement>(null);
  const openedByTap = useRef(false);

  // Bring the steppers and Done above the dock (scroll-margin uses --shell-bottom from AppShell).
  useEffect(() => {
    if (!editing || !openedByTap.current) return;
    openedByTap.current = false;
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    editorRef.current?.scrollIntoView?.({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [editing]);

  const n = set.index + 1;
  const isTop = set.kind === "top";
  const done = logged != null;
  const repStep = ex.measure === "reps" ? 1 : 5;
  // Timed or distance bodyweight work (plank) leads with the amount; added load stays one stepper away,
  // so "add load" advice from the engine can be followed (a plate on the back).
  const amountFirst = ex.bodyweight && ex.measure !== "reps";
  // A calibration set has no target weight until one is picked: it reads "aim 8 @ 3", never "target pick".
  const calibrating = set.weight == null;
  const targetWord = calibrating && targetWeight == null ? "aim" : "target";

  const openEditor = () => {
    setDraft(initialDraft());
    openedByTap.current = true;
    setEditing(true);
  };

  const confirmPrescribed = () => {
    if (targetWeight == null) return openEditor(); // calibration: pick a weight first
    onConfirm({ weight: targetWeight, reps: set.reps, rir: set.rir });
  };

  const setLabel = isTop ? "Top set" : `Set ${n}`;

  const weightStepper = (
    <Stepper
      label={ex.bodyweight ? "Added" : "Weight"}
      value={draft.weight}
      step={ex.increment_kg}
      min={0}
      onChange={(weight) => setDraft((d) => ({ ...d, weight }))}
      format={(v) => (ex.bodyweight ? fmtLoad(v, { bodyweight: true }) : fmtKg(v))}
      unit={ex.bodyweight ? undefined : ex.per_hand ? "kg/hand" : "kg"}
      inputMode="decimal"
    />
  );
  const amountStepper = (
    <Stepper
      label={ex.measure === "seconds" ? "Seconds" : ex.measure === "meters" ? "Meters" : "Reps"}
      value={draft.reps}
      step={repStep}
      min={0}
      onChange={(reps) => setDraft((d) => ({ ...d, reps: Math.round(reps) }))}
      unit={ex.measure === "seconds" ? "s" : ex.measure === "meters" ? "m" : ex.per_side ? sideSuffix(ex) : undefined}
      inputMode="numeric"
    />
  );

  if (editing) {
    return (
      <div
        ref={editorRef}
        className={cx("scroll-mt-20 rounded-[20px] bg-card px-4 pb-4 pt-2 ring-1 ring-inset ring-fg/25", className)}
        style={{ scrollMarginBottom: "var(--shell-bottom, 96px)" }}
        data-state="editing"
      >
        <div className="flex min-h-11 items-center gap-2">
          <span className="gym-label shrink-0 whitespace-nowrap">{setLabel}</span>
          <span className="min-w-0 truncate text-[12px] tabular-nums text-fg-faint">
            · {targetWord} {describeShort({ weight: targetWeight, reps: set.reps, rir: set.rir }, ex)}
          </span>
          <button type="button" aria-label="Cancel editing" onClick={() => setEditing(false)} className="-mr-2 ml-auto grid h-11 w-11 place-items-center rounded-full text-fg-dim active:bg-raise">
            <CloseIcon size={20} />
          </button>
        </div>
        <div className="flex flex-col gap-2.5">
          {!amountFirst && weightStepper}
          {amountStepper}
          {amountFirst && weightStepper}
          {/* Label above so five chips get the full width (≥ 44 px each at 375 px). */}
          <div className="flex flex-col gap-1.5">
            <span className="gym-label">How many more could you have done?</span>
            <ChipGroup label="Reps left" fill options={RIR_OPTIONS} value={draft.rir} onChange={(rir) => setDraft((d) => ({ ...d, rir }))} chipClassName="min-h-12" />
          </div>
          <Button
            variant="primary"
            size="lg"
            block
            className="mt-1"
            icon={<CheckIcon size={20} />}
            onClick={() => {
              onConfirm({ ...draft });
              setEditing(false);
            }}
          >
            Done
          </Button>
          {done && onRemove && (
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                onRemove();
              }}
              className="min-h-11 self-center px-3 text-[14px] font-medium text-fg-dim active:text-fg"
            >
              Remove set
            </button>
          )}
        </div>
      </div>
    );
  }

  // A calibration set has no target weight: any picked weight matches it, only reps and RIR can differ.
  const differs = done && ((targetWeight != null && logged.weight !== targetWeight) || logged.reps !== set.reps || logged.rir !== set.rir);

  const lastLine = last ? `last ${describeShort(last, ex)}` : null;

  return (
    <div
      data-state={done ? "done" : isNext ? "next" : "pending"}
      className={cx(
        "flex min-h-[76px] items-center gap-3 rounded-[20px] py-2 pl-3 pr-2.5 transition-colors duration-150 motion-reduce:transition-none",
        isNext && !done ? "bg-raise ring-1 ring-inset ring-volt/60" : "bg-card",
        className,
      )}
    >
      <span
        className={cx("grid h-8 w-8 shrink-0 place-items-center rounded-full text-[13px] font-semibold tabular-nums", done ? "bg-volt/15 text-volt" : isNext ? "bg-fg text-night" : "bg-raise-2 text-fg-faint")}
        aria-hidden
      >
        {isTop ? "T" : n}
      </span>
      <button
        type="button"
        onClick={openEditor}
        aria-label={`${done ? "Edit" : "Adjust"} ${setLabel.toLowerCase()}: ${describeSet(done ? logged : { weight: targetWeight, reps: set.reps, rir: set.rir }, ex)}`}
        className="flex min-h-14 min-w-0 flex-1 flex-col items-start justify-center gap-1.5 rounded-2xl text-left"
      >
        {done ? (
          <SetFigure weight={logged.weight} reps={logged.reps} rir={logged.rir} ex={ex} muted />
        ) : (
          <SetFigure weight={targetWeight} reps={set.reps} rir={null} ex={ex} muted={!isNext} />
        )}
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] leading-none text-fg-faint">
          {isTop && <Badge tone="outline">Top set</Badge>}
          {differs && (
            <span>
              {targetWord} {describeShort({ weight: targetWeight, reps: set.reps, rir: set.rir }, ex)}
            </span>
          )}
          {!differs && lastLine && <span>{lastLine}</span>}
          {!done && set.weight == null && fallbackWeight != null ? <span>same as the set before</span> : !done && !lastLine && !isTop && isNext && <span>tap the numbers to change them</span>}
        </span>
      </button>
      <button
        type="button"
        onClick={done ? openEditor : confirmPrescribed}
        aria-label={done ? `Edit ${setLabel.toLowerCase()}` : targetWeight == null ? `Pick weight for ${setLabel.toLowerCase()}` : `Confirm ${setLabel.toLowerCase()}`}
        className={cx(
          "gym-press grid h-12 w-12 shrink-0 place-items-center rounded-full",
          done ? "bg-volt text-night" : isNext ? "bg-raise-2 text-volt ring-2 ring-inset ring-volt" : "bg-raise-2 text-fg-faint",
        )}
      >
        <CheckIcon size={24} strokeWidth={done ? 2.75 : 2.25} />
      </button>
    </div>
  );
}

/** Compact "60 × 8, 3 left" for secondary lines. No weight yet (calibration) reads "8, 3 left". */
export function describeShort(v: { weight: number | null; reps: number; rir: number | null }, ex: SetRowExercise): string {
  const amount = ex.measure === "seconds" ? `${v.reps} s` : ex.measure === "meters" ? `${v.reps} m` : `${v.reps}${sideSuffix(ex)}`;
  const head = v.weight != null && showsLoad(ex, v.weight) ? `${fmtLoad(v.weight, { bodyweight: ex.bodyweight, per_hand: ex.per_hand })} × ${amount}` : amount;
  return `${head}${v.rir != null ? `, ${effortTag(v.rir)}` : ""}`;
}
