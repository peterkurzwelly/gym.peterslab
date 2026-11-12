import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { InfoIcon } from "./Icons";

/** Calm notice. Never red, never alarming: a dashed hairline and an info mark. */
export function Pill({ children, className, icon }: { children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <div className={cx("flex items-start gap-2 rounded-2xl border border-dashed border-fg-faint/70 px-3 py-2 text-[13px] leading-snug text-fg-dim", className)}>
      <span className="mt-[1px] shrink-0 text-fg-faint">{icon ?? <InfoIcon size={16} />}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}
