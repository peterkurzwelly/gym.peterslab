/** One exercise, full screen: demo photos, what to do, the sets. */
import type { PlannedExercise, PlannedSet } from "@gym/engine";
import type { Equipment, SetLog } from "@gym/schema";
import { useState } from "react";
import { AlternativesPanel, Badge, ExerciseDemo, InfoIcon, SetRow, SwapIcon, Toggle, VideoIcon, calibrationStartWeight, lastTimeText, useGuide, type SetValues } from "../../components";
import { cx } from "../../lib/cx";
import { targetLine } from "../../lib/effort";
import { fmtLocalDate, fmtRelativeDate } from "../../lib/format";
import { guideFor } from "../../lib/guides";
import { plain } from "../../lib/plain";

export interface ExercisePageProps {
  exercise: PlannedExercise;
  logged: SetLog[];
  activeSetIndex: number | null;
  pain: boolean;
  equipment?: Equipment;
  today: string;
  position: number;
  total: number;
  circuit: boolean;
  onConfirmSet: (set: PlannedSet, values: SetValues, existing: SetLog | null) => void;
  onRemoveSet: (existing: SetLog) => void;
  onPainChange: (on: boolean) => void;
  onSwap: (exerciseId: string) => void;
}

const SWAP_LABEL = { session: "Swapped today", block: "Swapped for the block", limitation: "Swapped for you" } as const;

/** Weight picked on an earlier set of this exercise this session (calibration rows reuse it). */
export function pickedBefore(logs: SetLog[], index: number): number | null {
  const before = logs.filter((l) => l.set_index < index);
  return before.length ? before[before.length - 1]!.weight : null;
}

export function ExercisePage({ exercise: ex, logged, activeSetIndex, pain, equipment, today, position, total, circuit, onConfirmSet, onRemoveSet, onPainChange, onSwap }: ExercisePageProps) {
  const openGuide = useGuide();
  const [altOpen, setAltOpen] = useState(false);
  const logs = logged.filter((l) => l.deleted_at == null && !l.is_warmup).sort((a, b) => a.set_index - b.set_index);
  const byIndex = new Map(logs.map((l) => [l.set_index, l]));
  const barbell = equipment ? equipment === "barbell" || equipment === "trap_bar" : ex.main_lift && ex.increment_kg >= 2.5;
  const startWeight = calibrationStartWeight(ex, barbell);
  const hasVideo = !!guideFor(ex.exercise_id)?.video;

  return (
    <article aria-label={ex.name} className="flex flex-col gap-4" data-pid={ex.prescription_id}>
      <button type="button" onClick={() => openGuide(ex.exercise_id)} aria-label={`How to do ${ex.name}`} className="gym-press relative block w-full overflow-hidden rounded-[22px] bg-black text-left">
        <ExerciseDemo exerciseId={ex.exercise_id} name={ex.name} className="aspect-[16/10] w-full" />
        <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/85 to-transparent p-3 pt-10">
          <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-fg px-3.5 text-[13px] font-semibold text-night">
            <InfoIcon size={16} /> How to
          </span>
          {hasVideo && (
            <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-black/60 px-3 text-[13px] font-semibold text-fg backdrop-blur">
              <VideoIcon size={18} /> Video
            </span>
          )}
        </span>
      </button>

      <header className="px-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="gym-label">
            Exercise {position} of {total}
          </span>
          {ex.starred && <Badge tone="outline">In the 30 min version</Badge>}
          {ex.superset_group && !circuit && <Badge tone="go">Superset</Badge>}
          {ex.swapped && <Badge tone="neutral">{SWAP_LABEL[ex.swapped]}</Badge>}
          {ex.stalled && <Badge tone="neutral">Stalled</Badge>}
        </div>
        <h2 className="m-0 mt-2 font-display text-[38px] uppercase leading-[0.95] text-fg">{ex.name}</h2>
        <p className="m-0 mt-2 text-[15px] font-medium text-fg">{targetLine(ex)}</p>
        <p className="m-0 mt-1.5 text-[13.5px] leading-snug text-fg-dim">{plain(ex.reason)}</p>
        {ex.last_time && ex.last_time.sets.length > 0 && (
          <p className="m-0 mt-1 text-[13px] leading-snug text-fg-faint">
            Last time · {fmtRelativeDate(ex.last_time.date, today) || fmtLocalDate(ex.last_time.date)} · <span className="tabular-nums text-fg-dim">{lastTimeText(ex.last_time, ex)}</span>
          </p>
        )}
        {ex.note && <p className="m-0 mt-1 text-[13px] italic leading-snug text-fg-faint">{ex.note}</p>}
      </header>

      <div className="flex flex-col gap-2">
        {ex.sets.map((set) => {
          const log = byIndex.get(set.index) ?? null;
          return (
            <SetRow
              key={`${ex.exercise_id}:${set.index}`}
              set={set}
              exercise={ex}
              logged={log ? { weight: log.weight, reps: log.reps, rir: log.rir } : null}
              isNext={activeSetIndex === set.index}
              last={ex.last_time?.sets[set.index] ?? null}
              fallbackWeight={set.weight == null ? pickedBefore(logs, set.index) : null}
              startWeight={startWeight}
              onConfirm={(values) => onConfirmSet(set, values, log)}
              onRemove={log ? () => onRemoveSet(log) : undefined}
            />
          );
        })}
      </div>

      <div className="overflow-hidden rounded-[20px] bg-card">
        <button
          type="button"
          aria-expanded={altOpen}
          onClick={() => setAltOpen((o) => !o)}
          className={cx("flex min-h-[52px] w-full items-center gap-3 px-4 text-left text-[15px] active:bg-raise", altOpen ? "text-fg" : "text-fg-dim")}
        >
          <SwapIcon size={20} />
          <span className="flex-1">Machine taken or not for you? Swap it</span>
        </button>
        {altOpen && (
          <AlternativesPanel
            exercise={ex}
            onClose={() => setAltOpen(false)}
            onSelect={(id) => {
              onSwap(id);
              setAltOpen(false);
            }}
          />
        )}
        <div className="border-t border-line/70 px-4 py-1">
          <Toggle
            checked={pain}
            onChange={onPainChange}
            label="Pain"
            description={pain ? "Logged. No load increase next time, a swap is suggested." : ex.pain_last_time ? "Pain was logged last time. Not soreness." : "Real pain, not soreness."}
          />
        </div>
      </div>
    </article>
  );
}
