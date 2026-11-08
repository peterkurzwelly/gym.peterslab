import type { LastTime, PlannedExercise, PlannedSet } from "@gym/engine";
import type { Equipment, SetLog } from "@gym/schema";
import { useState } from "react";
import { cx } from "../lib/cx";
import { fmtLocalDate, fmtLoad, fmtRangeAmount, fmtRelativeDate, sideSuffix } from "../lib/format";
import { AlternativesPanel } from "./AlternativesPanel";
import { Badge } from "./Badge";
import { SwapIcon } from "./Icons";
import { SetRow, calibrationStartWeight, type SetValues } from "./SetRow";
import { Toggle } from "./Toggle";

export interface ExerciseCardProps {
  exercise: PlannedExercise;
  /** Set logs of this exercise in the active session. Deleted rows and warm-ups are ignored. */
  logged: SetLog[];
  /** Index of the next set up (highlighted), or null when none. */
  activeSetIndex: number | null;
  /** Pain toggle state for this exercise in this session (separate from soreness). */
  pain: boolean;
  /** `existing` is the log being edited, or null for a new set. */
  onConfirmSet: (set: PlannedSet, values: SetValues, existing: SetLog | null) => void;
  /** Removes a logged set (a mis-tap). Offered in the editor of done sets when set. */
  onRemoveSet?: (set: PlannedSet, existing: SetLog) => void;
  onPainChange: (on: boolean) => void;
  /** Session swap. The panel is only offered when this is set. */
  onSwap?: (exerciseId: string) => void;
  /** Swap mode from the ModeBar: shows the swap button. */
  swapMode?: boolean;
  /** Equipment of the performed exercise, for the calibration start weight (20 kg barbell). */
  equipment?: Equipment;
  /** 1-based position in the session. */
  position?: number;
  /** Local date today, to say "Yesterday" in the last time line. */
  today?: string;
  /** Part of a travel circuit: every card shares one group, so the superset badge says nothing. */
  circuit?: boolean;
  className?: string;
}

/** "3 × 6–8 @ RIR 2", plus "+ top set". */
export function exerciseSummary(ex: PlannedExercise): string {
  const work = ex.sets.filter((s) => s.kind === "work").length;
  const top = ex.sets.some((s) => s.kind === "top");
  return `${work} × ${fmtRangeAmount(ex.rep_min, ex.rep_max, ex)} @ RIR ${ex.target_rir}${top ? " + top set" : ""}`;
}

/** "60 × 8, 8, 7 @ 3" when the load is constant, else "60 × 8 · 62.5 × 7". */
export function lastTimeText(last: LastTime, ex: PlannedExercise): string {
  if (!last.sets.length) return "";
  const amount = (r: number) => (ex.measure === "seconds" ? `${r} s` : ex.measure === "meters" ? `${r} m` : `${r}${sideSuffix(ex)}`);
  const load = (w: number) => fmtLoad(w, ex);
  const hideLoad = ex.bodyweight && ex.measure !== "reps" && last.sets.every((s) => s.weight === 0);
  const sameLoad = last.sets.every((s) => s.weight === last.sets[0]!.weight);
  const rirs = new Set(last.sets.map((s) => s.rir));
  const rir = rirs.size === 1 && last.sets[0]!.rir != null ? ` @ ${last.sets[0]!.rir}` : "";
  if (hideLoad) return last.sets.map((s) => amount(s.reps)).join(", ") + rir;
  if (sameLoad) return `${load(last.sets[0]!.weight)} × ${last.sets.map((s) => amount(s.reps)).join(", ")}${rir}`;
  return last.sets.map((s) => `${load(s.weight)} × ${amount(s.reps)}`).join(" · ");
}

const SWAP_LABEL = { session: "Swapped today", block: "Swapped for block", limitation: "Limitation swap" } as const;

export function ExerciseCard({ exercise: ex, logged, activeSetIndex, pain, onConfirmSet, onRemoveSet, onPainChange, onSwap, swapMode, equipment, position, today, circuit, className }: ExerciseCardProps) {
  const [altOpen, setAltOpen] = useState(false);
  const logs = logged.filter((l) => l.deleted_at == null && !l.is_warmup).sort((a, b) => a.set_index - b.set_index);
  const byIndex = new Map(logs.map((l) => [l.set_index, l]));
  const barbell = equipment ? equipment === "barbell" || equipment === "trap_bar" : ex.main_lift && ex.increment_kg >= 2.5;
  const startWeight = calibrationStartWeight(ex, barbell);
  const doneCount = ex.sets.filter((s) => byIndex.has(s.index)).length;
  // Swapping is offered in swap mode, and whenever pain is logged (the engine suggests a swap then).
  const canSwap = !!onSwap && (swapMode || pain);

  // Calibration rows reuse the weight picked on an earlier set this session.
  const pickedBefore = (index: number): number | null => {
    const before = logs.filter((l) => l.set_index < index);
    return before.length ? before[before.length - 1]!.weight : null;
  };

  return (
    <article className={cx("overflow-hidden rounded-[3px] border border-line bg-ink-2/50", className)} aria-label={ex.name}>
      <header className="px-4 pb-3 pt-3">
        <div className="flex min-h-6 items-center gap-1.5">
          {position != null && <span className="mr-1 text-[11px] tabular-nums tracking-[0.14em] text-paper-faint">{String(position).padStart(2, "0")}</span>}
          {ex.starred && (
            <Badge tone="outline" title="In the 30 min version">
              ★
            </Badge>
          )}
          {ex.superset_group && !circuit && <Badge tone="neutral">Superset {ex.superset_group}</Badge>}
          {ex.swapped && <Badge tone="neutral">{SWAP_LABEL[ex.swapped]}</Badge>}
          {ex.stalled && <Badge tone="neutral">Stalled</Badge>}
          <span className="ml-auto text-[11px] tabular-nums text-paper-faint">
            {doneCount}/{ex.sets.length}
          </span>
        </div>
        <div className="mt-1.5 flex items-start gap-2">
          <h3 className="m-0 min-w-0 flex-1 text-[19px] font-medium leading-tight text-paper">{ex.name}</h3>
          {canSwap && (
            <button
              type="button"
              aria-expanded={altOpen}
              onClick={() => setAltOpen((o) => !o)}
              className={cx("-mr-2 -mt-2 flex h-11 shrink-0 items-center gap-1.5 rounded-[3px] px-2 text-[12px] uppercase tracking-[0.1em] active:bg-ink-3", altOpen ? "text-paper" : "text-paper-dim")}
            >
              <SwapIcon size={18} /> Swap
            </button>
          )}
        </div>
        <p className="mt-1 text-[14px] tabular-nums text-paper-dim">{exerciseSummary(ex)}</p>
        <p className="mt-1.5 text-[12.5px] leading-snug text-paper-faint">{ex.reason}</p>
        {ex.last_time && ex.last_time.sets.length > 0 && (
          <p className="mt-1 text-[12.5px] leading-snug text-paper-faint">
            Last time · {today ? fmtRelativeDate(ex.last_time.date, today) : fmtLocalDate(ex.last_time.date)} · <span className="tabular-nums text-paper-dim">{lastTimeText(ex.last_time, ex)}</span>
          </p>
        )}
        {ex.note && <p className="mt-1 text-[12.5px] italic leading-snug text-paper-faint">{ex.note}</p>}
      </header>

      {altOpen && canSwap && onSwap && (
        <AlternativesPanel
          exercise={ex}
          onClose={() => setAltOpen(false)}
          onSelect={(id) => {
            onSwap(id);
            setAltOpen(false);
          }}
        />
      )}

      <div className="divide-y divide-line/70 border-t border-line/70">
        {ex.sets.map((set) => {
          const log = byIndex.get(set.index) ?? null;
          const lastSet = ex.last_time?.sets[set.index] ?? null;
          return (
            <SetRow
              key={set.index}
              set={set}
              exercise={ex}
              logged={log ? { weight: log.weight, reps: log.reps, rir: log.rir } : null}
              isNext={activeSetIndex === set.index}
              last={lastSet}
              fallbackWeight={set.weight == null ? pickedBefore(set.index) : null}
              startWeight={startWeight}
              onConfirm={(values) => onConfirmSet(set, values, log)}
              onRemove={log && onRemoveSet ? () => onRemoveSet(set, log) : undefined}
            />
          );
        })}
      </div>

      <div className="border-t border-line/70 px-4 py-1">
        <Toggle
          checked={pain}
          onChange={onPainChange}
          label="Pain"
          description={pain ? "Logged. No load increase next time, a swap is suggested." : ex.pain_last_time ? "Pain was logged last time. Not soreness." : "Pain, not soreness."}
        />
      </div>
    </article>
  );
}
