import { useEffect, useRef, useState } from "react";
import { cx } from "../lib/cx";
import { MinusIcon, PlusIcon } from "./Icons";

export interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  step: number;
  min?: number;
  max?: number;
  /** Accessible name and visible caption, e.g. "Weight". */
  label: string;
  /** Format the shown value. Defaults to the number. */
  format?: (n: number) => string;
  /** Small unit after the value ("kg", "min"). */
  unit?: string;
  /** Keyboard to show when the value is tapped. Tapping the value is the only way to get a keyboard. */
  inputMode?: "decimal" | "numeric";
  /** Hide the caption visually (still read by screen readers). */
  hideLabel?: boolean;
  className?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function Stepper({ value, onChange, step, min = 0, max = Infinity, label, format, unit, inputMode = "decimal", hideLabel, className }: StepperProps) {
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const clamp = (n: number) => Math.min(max, Math.max(min, round2(n)));
  const shown = format ? format(value) : String(value);

  useEffect(() => {
    if (typing) inputRef.current?.select();
  }, [typing]);

  const commit = () => {
    const n = Number(draft.replace(",", "."));
    if (draft.trim() !== "" && Number.isFinite(n)) onChange(clamp(n));
    setTyping(false);
  };

  const stepBtn = "gym-press grid h-12 w-14 shrink-0 place-items-center rounded-2xl bg-raise-2 text-fg active:brightness-125 disabled:opacity-30";

  return (
    <div className={cx("flex items-center gap-3", className)}>
      <span className={cx("gym-label w-16 shrink-0", hideLabel && "sr-only")}>{label}</span>
      <div className="flex flex-1 items-center gap-2">
        <button type="button" className={stepBtn} aria-label={`Decrease ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(clamp(value - step))}>
          <MinusIcon size={22} />
        </button>
        {typing ? (
          <input
            ref={inputRef}
            autoFocus
            aria-label={label}
            inputMode={inputMode}
            enterKeyHint="done"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setTyping(false);
            }}
            className="h-12 min-w-0 flex-1 rounded-2xl border border-fg/60 bg-night text-center text-[22px] font-semibold tabular-nums text-fg outline-none"
          />
        ) : (
          <button
            type="button"
            aria-label={`${label} ${shown}${unit ? ` ${unit}` : ""}. Tap to type`}
            onClick={() => {
              setDraft(String(value));
              setTyping(true);
            }}
            className="flex h-12 min-w-0 flex-1 items-baseline justify-center gap-1 rounded-2xl tabular-nums active:bg-raise"
          >
            <span className="font-display text-[30px] leading-[48px] text-fg">{shown}</span>
            {unit && <span className="text-[13px] font-medium text-fg-dim">{unit}</span>}
          </button>
        )}
        <button type="button" className={stepBtn} aria-label={`Increase ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(clamp(value + step))}>
          <PlusIcon size={22} />
        </button>
      </div>
    </div>
  );
}
