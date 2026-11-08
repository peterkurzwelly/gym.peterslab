import type { SessionChange, SessionSummary } from "@gym/engine";
import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { fmtAmount, fmtInt, fmtKg, fmtKgDelta, fmtLoad, fmtMinutes, type AmountShape, type LoadShape } from "../lib/format";
import { ShellDock } from "./AppShell";
import { Button } from "./Button";
import { SectionHeader } from "./SectionHeader";
import { WeekLine, type WeekGoals } from "./WeekCard";

export interface SummaryViewProps {
  summary: SessionSummary;
  onDone: () => void;
  /** Block length for "Week 3 of 12" in the week line. */
  blockWeeks?: number;
  goals?: WeekGoals;
  /** Extra line under the stats, e.g. what a cardio session logged. */
  detail?: ReactNode;
  /** Exercise shapes by id (ctx.exercises), so bodyweight and timed work read "45 s" instead of "0 kg × 45". */
  exercises?: Record<string, ExerciseShape>;
  /** Put Done in the shell dock (bottom third) instead of under the content. */
  docked?: boolean;
  className?: string;
}

export type ExerciseShape = LoadShape & AmountShape;

const round1 = (n: number) => Math.round(n * 10) / 10;

function sessionTitle(s: SessionSummary): string {
  if (s.code === "CARDIO") return "Cardio done.";
  if (s.code === "TRAVEL") return "Travel session done.";
  if (s.mode === "short") return `★ Session ${s.code} done.`;
  return `Session ${s.code} done.`;
}

/** The headline delta for a change: "+2.5 kg", "aim 8", "same". */
export function changeDelta(c: SessionChange): string {
  return changeDeltaFor(c);
}

/** A load with its unit: "25 kg", "10 kg/hand", "BW+5". Plain bodyweight (0) has no load to show: null. */
export function loadText(weight: number, shape?: ExerciseShape): string | null {
  if (weight <= 0) return null;
  return shape?.bodyweight ? fmtLoad(weight, { bodyweight: true }) : `${fmtKg(weight)} kg${shape?.per_hand ? "/hand" : ""}`;
}

/** The first base of a track (after a calibration session): the old base had no weight. */
export function isStartingLoad(c: Pick<SessionChange, "from" | "to">): boolean {
  return (!c.from || c.from.weight == null) && c.to != null && c.to.weight != null;
}

/** changeDelta with the exercise's shape: "aim 45 s" for timed work. */
export function changeDeltaFor(c: SessionChange, shape?: ExerciseShape): string {
  const { from, to } = c;
  if (!to) return "";
  if (from?.weight != null && to.weight != null && from.weight !== to.weight) return `${fmtKgDelta(to.weight - from.weight)} kg`;
  // After a calibration exposure the old base has no weight: show the new load, not "aim n".
  const start = isStartingLoad(c) ? loadText(to.weight!, shape) : null;
  if (start) return start;
  if (from && to.reps !== from.reps) return `aim ${fmtAmount(to.reps, shape)}`;
  if (!from) return `aim ${fmtAmount(to.reps, shape)}`;
  return "same";
}

/**
 * "Next: 62.5 kg × 8", "Next: 10 kg/hand × 12", "Next: BW+5 × 6", "Next: 45 s" (no load for plain bodyweight work).
 * The first base after calibration reads "Start at 25 kg × 5 next time".
 */
export function changeNextLine(to: { weight: number | null; reps: number }, shape?: ExerciseShape, opts: { start?: boolean } = {}): string {
  const amount = fmtAmount(to.reps, shape);
  const load = loadText(to.weight ?? 0, shape);
  const what = load ? `${load} × ${amount}` : amount;
  return opts.start ? `Start at ${what} next time` : `Next: ${what}`;
}

export function SummaryView({ summary, onDone, blockWeeks, goals, detail, exercises, docked, className }: SummaryViewProps) {
  const s = summary;
  const done = (
    <Button variant="primary" size="lg" block onClick={onDone} className={docked ? undefined : "mt-2"}>
      Done
    </Button>
  );
  return (
    <div className={cx("flex flex-col gap-5", className)}>
      <header>
        <div className="text-[11px] uppercase tracking-[0.16em] text-paper-faint">Summary</div>
        <h1 className="m-0 mt-1 font-display text-[46px] font-normal leading-[1.02] tracking-[-0.01em] text-paper">{sessionTitle(s)}</h1>
        {/* Cardio with a detail line says what was logged; the session clock adds nothing there. */}
        {!(s.code === "CARDIO" && detail) && (
          <p className="mt-2 text-[14px] tabular-nums text-paper-dim">
            {fmtMinutes(s.duration_min)}
            {s.code !== "CARDIO" && ` · ${s.sets_logged} sets`}
            {s.kg_lifted > 0 && ` · ${fmtInt(s.kg_lifted)} kg`}
          </p>
        )}
        {detail && <div className="mt-2 text-[14px] tabular-nums text-paper">{detail}</div>}
      </header>

      <div className="rounded-[3px] border border-line px-4 py-3">
        <WeekLine week={s.week} blockWeeks={blockWeeks} goals={goals} />
        {!s.week.floor_reached && s.week.to_floor_text && <p className="mt-1 text-[13px] text-paper-dim">{s.week.to_floor_text}</p>}
        {s.week.floor_reached && !s.week.target_reached && s.week.to_target_text && <p className="mt-1 text-[13px] text-paper-dim">{s.week.to_target_text}</p>}
      </div>

      {s.changes.length > 0 && (
        <section>
          <SectionHeader>Next time</SectionHeader>
          <ul className="m-0 mt-1 list-none divide-y divide-line/70 p-0">
            {s.changes.map((c) => (
              <li key={c.decision_id} className="py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 text-[15px] font-medium text-paper">{c.name}</span>
                  <span className="shrink-0 text-[15px] font-semibold tabular-nums text-paper">{changeDeltaFor(c, exercises?.[c.exercise_id])}</span>
                </div>
                <p className="mt-1 text-[13px] leading-snug text-paper-dim">{c.explanation}</p>
                {c.to && c.to.weight != null && (
                  <p className="mt-0.5 text-[12px] tabular-nums text-paper-faint">{changeNextLine(c.to, exercises?.[c.exercise_id], { start: isStartingLoad(c) })}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {s.prs.length > 0 && (
        <section>
          <SectionHeader>Personal bests</SectionHeader>
          <ul className="m-0 mt-1 list-none divide-y divide-line/70 p-0">
            {s.prs.map((p) => (
              <li key={p.exercise_id} className="py-3">
                <div className="text-[15px] font-medium text-paper">{p.name}</div>
                <div className="mt-0.5 text-[13px] tabular-nums text-paper-dim">
                  e1RM <span className="font-semibold text-paper">{fmtKg(round1(p.e1rm))}</span> kg
                  {p.previous_best != null && <span className="text-paper-faint"> · was {fmtKg(round1(p.previous_best))}</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {docked ? <ShellDock>{done}</ShellDock> : done}
    </div>
  );
}
