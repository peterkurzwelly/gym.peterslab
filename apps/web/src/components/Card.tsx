import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../lib/cx";

export type CardTone = "default" | "raised" | "go" | "go-strong";

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** Small caption in the top left. */
  label?: ReactNode;
  /** Caption on the right of the label row. */
  meta?: ReactNode;
  tone?: CardTone;
  /** Remove inner padding (for cards made of full width rows). */
  flush?: boolean;
  as?: "section" | "div" | "article";
}

const TONE: Record<CardTone, string> = {
  default: "bg-card",
  raised: "bg-raise",
  go: "bg-card ring-1 ring-inset ring-volt/40",
  "go-strong": "bg-card ring-1 ring-inset ring-volt",
};

export function Card({ label, meta, tone = "default", flush, as: Tag = "section", className, children, ...rest }: CardProps) {
  return (
    <Tag className={cx("relative overflow-hidden rounded-[20px]", TONE[tone], className)} {...rest}>
      {(label || meta) && (
        <div className="gym-label flex min-h-10 items-center justify-between gap-3 px-4 pt-1">
          <span className="truncate">{label}</span>
          {meta && <span className="shrink-0 text-right">{meta}</span>}
        </div>
      )}
      <div className={flush ? undefined : cx("px-4 pb-4", label || meta ? "pt-1" : "pt-4")}>{children}</div>
    </Tag>
  );
}
