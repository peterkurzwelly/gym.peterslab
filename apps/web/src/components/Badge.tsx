import type { ReactNode } from "react";
import { cx } from "../lib/cx";

export type BadgeTone = "neutral" | "outline" | "go" | "solid";

const TONE: Record<BadgeTone, string> = {
  neutral: "bg-raise text-fg-dim border-transparent",
  outline: "border-fg/35 text-fg",
  go: "border-volt/60 text-volt",
  solid: "bg-fg text-night border-fg",
};

/** Small inline label: ★, "Top set", "Stalled", "Superset C5". */
export function Badge({ tone = "outline", className, children, title }: { tone?: BadgeTone; className?: string; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cx("inline-flex h-[20px] items-center gap-1 whitespace-nowrap rounded-lg border px-1.5 text-[10.5px] font-medium uppercase leading-none tracking-[0.06em]", TONE[tone], className)}
    >
      {children}
    </span>
  );
}
