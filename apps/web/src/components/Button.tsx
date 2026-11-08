import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "../lib/cx";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Full width. */
  block?: boolean;
  icon?: ReactNode;
}

const VARIANT: Record<ButtonVariant, string> = {
  // The single orange accent. Ink text on orange is about 5:1.
  primary: "bg-orange text-ink font-semibold active:brightness-90 disabled:bg-ink-3 disabled:text-paper-faint disabled:opacity-100",
  secondary: "border border-paper/35 text-paper active:bg-ink-3",
  ghost: "text-paper-dim active:text-paper active:bg-ink-3/60",
};

// Every size is at least 44 px tall.
const SIZE: Record<ButtonSize, string> = {
  sm: "min-h-11 px-3 text-[12px] gap-1.5",
  md: "min-h-12 px-4 text-[13px] gap-2",
  lg: "min-h-14 px-5 text-[15px] gap-2",
};

export function Button({ variant = "secondary", size = "md", block, icon, className, children, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "gym-press inline-flex select-none items-center justify-center rounded-[3px] font-mono uppercase tracking-[0.08em]",
        "transition-[background-color,color,filter,transform] duration-100 motion-reduce:transition-none",
        "disabled:pointer-events-none disabled:opacity-40",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper",
        VARIANT[variant],
        SIZE[size],
        block && "w-full",
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
