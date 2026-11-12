import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "../lib/cx";

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  selected?: boolean;
  /** Used inside a ChipGroup (radio semantics). Standalone chips are toggle buttons. */
  asRadio?: boolean;
}

export function Chip({ selected = false, asRadio, className, children, type = "button", ...rest }: ChipProps) {
  return (
    <button
      type={type}
      role={asRadio ? "radio" : undefined}
      aria-checked={asRadio ? selected : undefined}
      aria-pressed={asRadio ? undefined : selected}
      className={cx(
        "gym-press inline-flex min-h-11 min-w-11 select-none items-center justify-center rounded-2xl px-3 text-[15px] font-semibold tabular-nums",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg",
        selected ? "bg-fg text-night" : "bg-raise-2 text-fg active:brightness-125",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export interface ChipOption<T extends string | number> {
  value: T;
  label: ReactNode;
  /** Accessible name when the label is not plain text. */
  ariaLabel?: string;
}

export interface ChipGroupProps<T extends string | number> {
  options: readonly ChipOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  /** Accessible group name, e.g. "Sleep". */
  label: string;
  /** Stretch chips to fill the row evenly. */
  fill?: boolean;
  className?: string;
  chipClassName?: string;
}

export function ChipGroup<T extends string | number>({ options, value, onChange, label, fill, className, chipClassName }: ChipGroupProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={cx("flex gap-1.5", fill ? "w-full min-w-0 flex-1" : "flex-wrap", className)}>
      {options.map((o) => (
        <Chip
          key={String(o.value)}
          asRadio
          selected={value === o.value}
          aria-label={o.ariaLabel}
          onClick={() => onChange(o.value)}
          className={cx(fill && "flex-1 px-0", chipClassName)}
        >
          {o.label}
        </Chip>
      ))}
    </div>
  );
}
