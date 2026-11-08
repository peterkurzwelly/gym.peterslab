import type { ReactNode } from "react";
import { cx } from "../lib/cx";

export type BadgeTone = "neutral" | "outline" | "go" | "solid";

const TONE: Record<BadgeTone, string> = {
  neutral: "bg-ink-3 text-paper-dim border-transparent",
  outline: "border-paper/35 text-paper",
  go: "border-go/60 text-go",
  solid: "bg-paper text-ink border-paper",
};

/** Small inline label: ★, "Top set", "Stalled", "Superset C5". */
export function Badge({ tone = "outline", className, children, title }: { tone?: BadgeTone; className?: string; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cx("inline-flex h-[20px] items-center gap-1 whitespace-nowrap rounded-[2px] border px-1.5 text-[10.5px] font-medium uppercase leading-none tracking-[0.1em]", TONE[tone], className)}
    >
      {children}
    </span>
  );
}
