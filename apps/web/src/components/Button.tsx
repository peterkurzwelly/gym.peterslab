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
  // The volt accent. Night text on volt is about 15:1.
  primary: "bg-volt text-night active:brightness-90 disabled:bg-raise disabled:text-fg-faint disabled:opacity-100",
  secondary: "bg-raise text-fg active:bg-raise-2",
  ghost: "text-fg-dim active:text-fg active:bg-raise/60",
};

// Every size is at least 44 px tall. Large buttons use the display face.
const SIZE: Record<ButtonSize, string> = {
  sm: "min-h-11 px-4 text-[14px] font-semibold gap-1.5 rounded-full",
  md: "min-h-12 px-5 text-[15px] font-semibold gap-2 rounded-2xl",
  lg: "min-h-[58px] px-6 font-display text-[22px] uppercase tracking-[0.03em] gap-2.5 rounded-[18px]",
};

export function Button({ variant = "secondary", size = "md", block, icon, className, children, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "gym-press inline-flex select-none items-center justify-center",
        "disabled:pointer-events-none disabled:opacity-40",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg",
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
