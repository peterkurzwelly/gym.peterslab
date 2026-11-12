import type { ReactNode } from "react";
import { cx } from "../lib/cx";

/** Section title in the display face, with an optional note on the right. `index` is accepted for older callers and not shown. */
export function SectionHeader({ children, right, className, as: Tag = "h2" }: { children: ReactNode; index?: string; right?: ReactNode; className?: string; as?: "h2" | "h3" | "div" }) {
  return (
    <div className={cx("flex items-baseline justify-between gap-3 px-1", className)}>
      <Tag className="m-0 font-display text-[26px] uppercase leading-none text-fg">{children}</Tag>
      {right && <span className="shrink-0 text-[12.5px] font-semibold text-fg-faint">{right}</span>}
    </div>
  );
}
