/** The block as rows: one per calendar week so far, then the training weeks ahead, grouped by phase. */
import type { WeekState } from "@gym/engine";
import type { WeekGoals } from "../../components";
import { Badge } from "../../components";
import { cx } from "../../lib/cx";
import { fmtRange, fmtWeekRange } from "../../lib/format";
import type { BlockRow, PhaseGroup } from "./model";
import { Pips } from "./ui";

function statusOf(w: WeekState, goals: WeekGoals): { text: string; tone: "go" | "dim" | "faint" } {
  if (w.status === "target") return { text: "Target ✓", tone: "go" };
  if (w.status === "floor") return { text: "Floor ✓", tone: "go" };
  if (w.status === "zero") return { text: w.repaired ? "Paused · streak kept" : "Paused week · block extended", tone: "faint" };
  const n = w.strength_done + w.cardio_done;
  if (w.status === "below_floor") return { text: `${n} ${n === 1 ? "session" : "sessions"} · trained`, tone: "dim" };
  const done = Math.min(w.strength_done, goals.strength_target) + Math.min(w.cardio_done, goals.cardio_target);
  return { text: `${done} of ${goals.strength_target + goals.cardio_target}`, tone: "dim" };
}

function rowLabel(r: BlockRow, goals: WeekGoals): string {
  const base = `Week ${r.training_week}, ${r.phase.label}, ${fmtWeekRange(r.start_date, r.end_date)}`;
  if (!r.week) return `${base}, ahead`;
  return `${base}${r.kind === "current" ? ", this week" : ""}: ${statusOf(r.week, goals).text}`;
}

function Row({ row, goals }: { row: BlockRow; goals: WeekGoals }) {
  const w = row.week;
  const zero = w?.status === "zero";
  const status = w ? statusOf(w, goals) : null;
  const current = row.kind === "current";
  return (
    <li
      aria-label={rowLabel(row, goals)}
      aria-current={current ? "true" : undefined}
      className={cx(
        "relative grid min-h-12 grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-x-3 border-t border-line/70 py-2 pl-4 pr-4",
        current && "bg-ink-2",
      )}
    >
      {current && <span aria-hidden className="absolute inset-y-0 left-0 w-[2px] bg-paper" />}
      <span
        aria-hidden
        className={cx(
          "font-display text-[26px] leading-none tracking-[-0.01em] [font-variant-numeric:normal]",
          current ? "text-paper" : row.kind === "future" || zero ? "text-paper-faint" : "text-paper-dim",
        )}
      >
        {row.training_week}
      </span>
      <span aria-hidden className="flex min-w-0 flex-col gap-1">
        <span className={cx("flex items-center gap-2 text-[13px]", row.kind === "future" ? "text-paper-faint" : "text-paper")}>
          <span className="whitespace-nowrap">{fmtWeekRange(row.start_date, row.end_date)}</span>
          {current && <Badge tone="solid">This week</Badge>}
          {w?.reactive_deload && <Badge tone="neutral">Deload</Badge>}
        </span>
        {w && !zero && (
          <span className="flex items-center gap-2">
            <Pips done={w.strength_done} target={goals.strength_target} label="" />
            <Pips done={w.cardio_done} target={goals.cardio_target} label="" />
          </span>
        )}
        {zero && <span className="text-[12px] leading-snug text-paper-faint">{status?.text}</span>}
      </span>
      <span aria-hidden className="text-right text-[12.5px]">
        {status && !zero && (
          <span className={cx("whitespace-nowrap", status.tone === "go" ? "font-medium text-go" : status.tone === "dim" ? "text-paper-dim" : "text-paper-faint")}>
            {status.text}
          </span>
        )}
      </span>
    </li>
  );
}

export function BlockSheet({ groups, goals, extensionWeeks }: { groups: PhaseGroup[]; goals: WeekGoals; extensionWeeks: number }) {
  return (
    <div className="overflow-hidden rounded-[3px] border border-line bg-ink-2/50">
      {groups.map((g, gi) => (
        <section key={g.key} aria-label={g.phase.label}>
          <div className={cx("flex min-h-9 items-center justify-between px-4 text-[11px] uppercase tracking-[0.14em] text-paper-faint", gi > 0 && "border-t border-line")}>
            <span>{g.phase.label}</span>
            <span>RIR {fmtRange(g.phase.rir[0], g.phase.rir[1])}</span>
          </div>
          <ol className="m-0 list-none p-0">
            {g.rows.map((r) => (
              <Row key={r.key} row={r} goals={goals} />
            ))}
          </ol>
        </section>
      ))}
      <p className="m-0 border-t border-line px-4 py-3 text-[12px] leading-snug text-paper-faint">
        {extensionWeeks > 0
          ? `Paused weeks do not use up the block. It runs ${extensionWeeks} ${extensionWeeks === 1 ? "week" : "weeks"} longer, nothing to catch up.`
          : "A paused week never uses up the block. The block simply runs a week longer."}
      </p>
    </div>
  );
}
