import type { BlockState, DotState, WeekState } from "@gym/engine";
import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { fmtWeekRange } from "../lib/format";
import { Card } from "./Card";

/** Week goals from config/engine.json `week`. Pass them to show "2 of 4 done". */
export interface WeekGoals {
  strength_target: number;
  cardio_target: number;
  strength_floor: number;
}

export interface WeekCardProps {
  week: WeekState;
  block: BlockState;
  goals?: WeekGoals;
  className?: string;
}

/** "2 of 4 done", counting only up to each target so bonus sessions show separately. */
export function weekDoneText(week: WeekState, goals?: WeekGoals): string {
  if (!goals) {
    const n = week.strength_done + week.cardio_done;
    return `${n} ${n === 1 ? "session" : "sessions"} done`;
  }
  const done = Math.min(week.strength_done, goals.strength_target) + Math.min(week.cardio_done, goals.cardio_target);
  return `${done} of ${goals.strength_target + goals.cardio_target} done`;
}

/** The status phrase. Below the floor it says nothing: a fresh week is not a problem. */
export function weekStatusText(week: WeekState): string | null {
  if (week.target_reached) return "Target reached ✓";
  if (week.floor_reached) return "Floor reached ✓";
  return null;
}

export function WeekCard({ week, block, goals, className }: WeekCardProps) {
  const status = weekStatusText(week);
  const tone = week.target_reached ? "go-strong" : week.floor_reached ? "go" : "default";
  const hint = week.floor_reached ? week.to_target_text : week.to_floor_text;
  const headline = block.complete ? "Block done" : `Week ${week.training_week} of ${block.block_weeks}`;

  return (
    <Card
      tone={tone}
      className={className}
      label={fmtWeekRange(week.start_date, week.end_date)}
      meta={week.phase_label}
      aria-label={`${headline}. ${weekDoneText(week, goals)}${status ? `. ${status}` : ""}`}
    >
      <div className="font-display text-[38px] leading-[1.02] tracking-[-0.01em] text-paper">{headline}</div>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-2 text-[15px] text-paper">
        <span className="whitespace-nowrap">{weekDoneText(week, goals)}</span>
        {status && <Seg className="font-medium text-go">{status}</Seg>}
        {week.bonus_done > 0 && <Seg className="text-paper-dim">+{week.bonus_done} bonus</Seg>}
      </p>
      {hint && <p className="mt-1 text-[13px] leading-snug text-paper-dim">{hint}</p>}
      <BlockDots dots={block.dots} className="mt-4" />
      {block.extension_weeks > 0 && (
        <p className="mt-2 text-[11px] uppercase tracking-[0.12em] text-paper-faint">
          Block runs {block.extension_weeks} {block.extension_weeks === 1 ? "week" : "weeks"} longer
        </p>
      )}
    </Card>
  );
}

/** A "· text" segment that wraps as one unit, so a line never ends on a lone "·". */
function Seg({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="mr-2 text-paper-faint">·</span>
      <span className={className}>{children}</span>
    </span>
  );
}

const DOT_CLASS: Record<DotState, string> = {
  target: "bg-go border-go",
  floor: "bg-go-dim border-go",
  // A below floor week still kept the streak alive: a calm solid dot, never a warning.
  below_floor: "bg-paper-faint border-paper-faint",
  current: "border-paper border-[1.5px] bg-transparent",
  future: "border-line bg-transparent",
};

const DOT_WORD: Record<DotState, string> = {
  target: "target",
  floor: "floor",
  below_floor: "trained",
  current: "this week",
  future: "ahead",
};

/** 12 dots on a scale line, one per training week. */
export function BlockDots({ dots, className }: { dots: DotState[]; className?: string }) {
  const label = dots.map((d, i) => `week ${i + 1} ${DOT_WORD[d]}`).join(", ");
  return (
    <div className={cx("relative", className)} role="img" aria-label={`Block: ${label}`}>
      <div aria-hidden className="absolute inset-x-[10px] top-[7px] h-px bg-line" />
      <ol className="relative grid list-none gap-0 p-0" style={{ gridTemplateColumns: `repeat(${dots.length}, minmax(0, 1fr))` }}>
        {dots.map((d, i) => (
          <li key={i} className="flex flex-col items-center gap-1.5">
            <span className={cx("h-[15px] w-[15px] rounded-full border", DOT_CLASS[d])} />
            <span className={cx("text-[9.5px] tabular-nums", d === "current" ? "text-paper" : "text-paper-faint")}>{i + 1}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** One line version for the summary: "Week 3 of 12 · 2 of 4 done · Floor reached ✓". */
export function WeekLine({ week, blockWeeks, goals, className }: { week: WeekState; blockWeeks?: number; goals?: WeekGoals; className?: string }) {
  const status = weekStatusText(week);
  return (
    <p className={cx("flex flex-wrap items-baseline gap-x-2 text-[14px]", className)}>
      <span className="whitespace-nowrap text-paper">
        Week {week.training_week}
        {blockWeeks ? ` of ${blockWeeks}` : ""}
      </span>
      <Seg className="text-paper">{weekDoneText(week, goals)}</Seg>
      {status && <Seg className="font-medium text-go">{status}</Seg>}
    </p>
  );
}
