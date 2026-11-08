import type { ReactNode } from "react";
import { cx } from "../lib/cx";

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/** Switch row. The whole row is the tap target (≥ 44 px). */
export function Toggle({ checked, onChange, label, description, disabled, className }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx("gym-press flex min-h-11 w-full items-center gap-3 rounded-[3px] py-1.5 text-left disabled:opacity-40", className)}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] text-paper">{label}</span>
        {description && <span className="block text-[12px] leading-snug text-paper-faint">{description}</span>}
      </span>
      <span
        aria-hidden
        className={cx(
          "relative h-[26px] w-[44px] shrink-0 rounded-full border transition-colors duration-150 motion-reduce:transition-none",
          checked ? "border-paper bg-paper" : "border-line bg-ink-3",
        )}
      >
        <span
          className={cx(
            "absolute top-[2px] h-5 w-5 rounded-full transition-[left,background-color] duration-150 motion-reduce:transition-none",
            checked ? "left-[20px] bg-ink" : "left-[2px] bg-paper-faint",
          )}
        />
      </span>
    </button>
  );
}
