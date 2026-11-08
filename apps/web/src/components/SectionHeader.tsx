import type { ReactNode } from "react";
import { cx } from "../lib/cx";

/** Drawing sheet section label: "02 · EXERCISES ───────── right". */
export function SectionHeader({ children, index, right, className, as: Tag = "h2" }: { children: ReactNode; index?: string; right?: ReactNode; className?: string; as?: "h2" | "h3" | "div" }) {
  return (
    <div className={cx("flex min-h-8 items-center gap-3", className)}>
      <Tag className="m-0 shrink-0 text-[11px] font-normal uppercase tracking-[0.16em] text-paper-faint">
        {index && <span className="text-paper-dim">{index} · </span>}
        {children}
      </Tag>
      <span aria-hidden className="h-px flex-1 bg-line" />
      {right && <div className="shrink-0 text-[12px] text-paper-dim">{right}</div>}
    </div>
  );
}
