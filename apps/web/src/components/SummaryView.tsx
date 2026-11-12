import type { SessionChange, SessionSummary } from "@gym/engine";
import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { fmtAmount, fmtInt, fmtKg, fmtKgDelta, fmtLoad, type AmountShape, type LoadShape } from "../lib/format";
import { ShellDock } from "./AppShell";
import { Button } from "./Button";
import { CheckIcon } from "./Icons";
import { SectionHeader } from "./SectionHeader";
import { WeekLine, type WeekGoals } from "./WeekCard";
import { plain } from "../lib/plain";

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
  if (s.mode === "short") return `Session ${s.code} done · short version.`;
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

function Tile({ value, unit }: { value: string; unit: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-card px-3 py-3 text-center">
      <div className="truncate font-display text-[32px] leading-none text-fg">{value}</div>
      <div className="mt-1.5 truncate text-[12px] text-fg-dim">{unit}</div>
    </div>
  );
}

export function SummaryView({ summary, onDone, blockWeeks, goals, detail, exercises, docked, className }: SummaryViewProps) {
  const s = summary;
  const cardio = s.code === "CARDIO";
  const done = (
    <Button variant="primary" size="lg" block onClick={onDone} className={docked ? undefined : "mt-2"}>
      Done
    </Button>
  );
  return (
    <div className={cx("flex flex-col gap-4", className)}>
      <header className="gym-hero rounded-[24px] bg-card px-5 pb-5 pt-6">
        <span aria-hidden className="grid h-12 w-12 place-items-center rounded-full bg-volt text-night">
          <CheckIcon size={26} strokeWidth={3} />
        </span>
        <div className="gym-label mt-4 text-volt">{cardio ? "Cardio logged" : "Workout logged"}</div>
        <h1 className="m-0 mt-1.5 font-display text-[40px] uppercase leading-[1.02] text-fg">{sessionTitle(s)}</h1>
        {detail && <div className="mt-2 text-[14.5px] tabular-nums text-fg">{detail}</div>}
      </header>

      {/* Cardio with a detail line says what was logged; the session clock adds nothing there. */}
      {!(cardio && detail) && (
        <div className={cx("grid gap-2", cardio ? "grid-cols-1" : s.kg_lifted > 0 ? "grid-cols-3" : "grid-cols-2")} role="group" aria-label="Session numbers">
          <Tile value={String(Math.max(0, Math.round(s.duration_min)))} unit="minutes" />
          {!cardio && <Tile value={String(s.sets_logged)} unit={s.sets_logged === 1 ? "set" : "sets"} />}
          {s.kg_lifted > 0 && <Tile value={fmtInt(s.kg_lifted)} unit="kg lifted" />}
        </div>
      )}

      <div className="rounded-[20px] bg-card px-4 py-3.5">
        <WeekLine week={s.week} blockWeeks={blockWeeks} goals={goals} />
        {!s.week.floor_reached && s.week.to_floor_text && <p className="mt-1 text-[13.5px] text-fg-dim">{plain(s.week.to_floor_text)}</p>}
        {s.week.floor_reached && !s.week.target_reached && s.week.to_target_text && <p className="mt-1 text-[13.5px] text-fg-dim">{plain(s.week.to_target_text)}</p>}
      </div>

      {s.prs.length > 0 && (
        <section>
          <SectionHeader>Personal bests</SectionHeader>
          <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
            {s.prs.map((p) => (
              <li key={p.exercise_id} className="rounded-[20px] bg-card px-4 py-3 ring-1 ring-volt/50">
                <div className="text-[15px] font-semibold text-fg">{p.name}</div>
                <div className="mt-0.5 text-[13.5px] tabular-nums text-fg-dim">
                  Est. max <span className="font-semibold text-volt">{fmtKg(round1(p.e1rm))}</span> kg
                  {p.previous_best != null && <span className="text-fg-faint"> · was {fmtKg(round1(p.previous_best))}</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {s.changes.length > 0 && (
        <section>
          <SectionHeader>Next time</SectionHeader>
          <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
            {s.changes.map((c) => {
              const delta = changeDeltaFor(c, exercises?.[c.exercise_id]);
              return (
                <li key={c.decision_id} className="rounded-[20px] bg-card px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 text-[15px] font-semibold text-fg">{c.name}</span>
                    <span className={cx("shrink-0 font-display text-[22px] leading-none tabular-nums", delta.startsWith("+") ? "text-volt" : "text-fg")}>{delta}</span>
                  </div>
                  <p className="mt-1.5 text-[13.5px] leading-snug text-fg-dim">{plain(c.explanation)}</p>
                  {c.to && c.to.weight != null && (
                    <p className="mt-1 text-[12.5px] tabular-nums text-fg-faint">{changeNextLine(c.to, exercises?.[c.exercise_id], { start: isStartingLoad(c) })}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {!cardio && (
        <p className="m-0 rounded-[20px] bg-card px-4 py-3.5 text-[13.5px] leading-snug text-fg-dim">
          <span className="font-semibold" style={{ color: "var(--color-fuel)" }}>
            Now fuel.
          </span>{" "}
          A meal with 30 to 40 g of protein in the next couple of hours is what turns this workout into muscle.
        </p>
      )}

      {docked ? <ShellDock>{done}</ShellDock> : done}
    </div>
  );
}
