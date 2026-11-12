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
    <div role="radiogroup" aria-label={label} className={cx("flex rounded-[16px] bg-card p-1", className)}>
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
              "gym-press min-h-11 flex-1 whitespace-nowrap rounded-[12px] px-2 text-[14px] font-semibold",
              on ? "bg-fg text-night" : "text-fg-dim active:bg-raise",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
