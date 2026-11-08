import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../lib/cx";

export type CardTone = "default" | "raised" | "go" | "go-strong";

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** Small caption in the top left, like a drawing title block. */
  label?: ReactNode;
  /** Caption on the right of the label row. */
  meta?: ReactNode;
  tone?: CardTone;
  /** Remove inner padding (for cards made of full width rows). */
  flush?: boolean;
  as?: "section" | "div" | "article";
}

const TONE: Record<CardTone, string> = {
  default: "border-line bg-ink-2/50",
  raised: "border-line bg-ink-2",
  go: "border-go/45 bg-ink-2/50",
  "go-strong": "border-go/70 bg-go-dim/25",
};

export function Card({ label, meta, tone = "default", flush, as: Tag = "section", className, children, ...rest }: CardProps) {
  return (
    <Tag className={cx("relative rounded-[3px] border", TONE[tone], className)} {...rest}>
      {(label || meta) && (
        <div className="flex min-h-9 items-center justify-between gap-3 border-b border-line/80 px-4 text-[11px] uppercase tracking-[0.14em] text-paper-faint">
          <span className="truncate">{label}</span>
          {meta && <span className="shrink-0 text-right">{meta}</span>}
        </div>
      )}
      <div className={flush ? undefined : "p-4"}>{children}</div>
    </Tag>
  );
}
