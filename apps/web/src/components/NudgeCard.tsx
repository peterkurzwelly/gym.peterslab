import type { Nudge } from "@gym/engine";
import { cx } from "../lib/cx";
import { Button } from "./Button";

const CAPTION: Record<Nudge["kind"], string> = {
  never_miss_twice: "Today",
  comeback: "Welcome back",
  break_resume: "Welcome back",
  long_break: "Fresh start",
  book_floor: "This week",
  sunday_review: "Sunday review",
  block_complete: "Week 12",
};

/**
 * Default button text from the suggested action. "Show", not "Start": the button picks the version and
 * scrolls to it; the session starts with the first logged set.
 */
export function nudgeActionText(n: Nudge): string | null {
  if (!n.action) return null;
  const { mode, code } = n.action;
  if (mode === "short") return `Show ★ 30 min ${code}`;
  if (code === "TRAVEL") return "Show travel version";
  if (code === "CARDIO") return "Show cardio";
  if (mode === "comeback") return `Show comeback session ${code}`;
  return `Show session ${code}`;
}

export interface NudgeCardProps {
  nudge: Nudge;
  onAction?: (nudge: Nudge) => void;
  /** Button text for nudges without a session action (book floor, review). */
  actionLabel?: string;
  className?: string;
}

export function NudgeCard({ nudge, onAction, actionLabel, className }: NudgeCardProps) {
  const label = actionLabel ?? nudgeActionText(nudge);
  return (
    <aside className={cx("rounded-[3px] border border-line bg-ink-2/50 px-4 py-3", className)}>
      <div className="text-[11px] uppercase tracking-[0.14em] text-paper-faint">{CAPTION[nudge.kind]}</div>
      <p className="mt-1.5 text-[15px] leading-snug text-paper">{nudge.text}</p>
      {onAction && label && (
        <Button variant="secondary" size="md" className="mt-3" block onClick={() => onAction(nudge)}>
          {label}
        </Button>
      )}
    </aside>
  );
}
