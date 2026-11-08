import type { ReactNode } from "react";
import { cx } from "../lib/cx";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}

export function SegmentedControl<T extends string>({ options, value, onChange, label, className }: SegmentedControlProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={cx("flex rounded-[3px] border border-line p-[3px]", className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cx(
              "gym-press min-h-11 flex-1 rounded-[2px] px-3 font-mono text-[13px] uppercase tracking-[0.08em] transition-colors duration-100 motion-reduce:transition-none",
              on ? "bg-paper font-semibold text-ink" : "text-paper-dim active:bg-ink-3",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
