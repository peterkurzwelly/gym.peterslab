/** Small pieces of the Today screen. Presentational. */
import type { SessionPlan } from "@gym/engine";
import type { Session, SessionMode } from "@gym/schema";
import { Button, Pill, SectionHeader, SwapIcon, WeekLine, type WeekGoals } from "../../components";
import type { WeekState } from "@gym/engine";
import { cx } from "../../lib/cx";
import { fmtApproxMin } from "../../lib/format";

export function modeLabel(mode: SessionMode, code?: string): string {
  if (code === "TRAVEL" || mode === "travel") return "Travel version";
  if (mode === "short") return "★ 30 min version";
  if (mode === "comeback") return "Comeback session";
  return "Full session";
}

/** "Session A", "★ Session A", "Travel version". */
export function sessionTitle(code: string, mode: SessionMode): string {
  if (code === "TRAVEL") return "Travel version";
  if (code === "CARDIO") return "Cardio";
  return `${mode === "short" ? "★ " : ""}Session ${code}`;
}

const timeOf = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** Week as one line while a session runs: the week card stays, just smaller. */
export function WeekStrip({ week, blockWeeks, goals }: { week: WeekState; blockWeeks: number; goals: WeekGoals }) {
  return (
    <div className={cx("rounded-[3px] border px-4 py-2.5", week.floor_reached ? "border-go/45" : "border-line")}>
      <WeekLine week={week} blockWeeks={blockWeeks} goals={goals} />
    </div>
  );
}

/** Header of a running session: what it is, when it started, swap toggle. */
export function SessionHeader({ session, plan, swapping, onSwappingChange }: { session: Session; plan: SessionPlan; swapping: boolean; onSwappingChange: (on: boolean) => void }) {
  return (
    <div className="flex items-end gap-3 pt-1">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-[0.14em] text-paper-faint">In progress · since {timeOf(session.started_at)}</div>
        <h1 className="m-0 mt-1 font-display text-[40px] font-normal leading-none text-paper">{sessionTitle(session.program_day_id, session.mode)}</h1>
        <p className="mt-1.5 text-[13px] text-paper-dim">
          {session.program_day_id === "TRAVEL" ? `${roundsOf(plan)} rounds` : plan.name} · {plan.phase_label}
        </p>
      </div>
      <button
        type="button"
        aria-pressed={swapping}
        onClick={() => onSwappingChange(!swapping)}
        className={cx(
          "gym-press flex min-h-12 shrink-0 items-center gap-1.5 rounded-[3px] border px-3 text-[12px] uppercase tracking-[0.1em] transition-colors duration-100 motion-reduce:transition-none",
          swapping ? "border-paper bg-paper text-ink" : "border-line text-paper active:bg-ink-3",
        )}
      >
        <SwapIcon size={18} /> Swap
      </button>
    </div>
  );
}

/** When the engine leads with the ★ 30 min version: why, and one tap back to the full session. */
export function RecommendNote({ reason, onFull }: { reason: string | null; onFull: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-[3px] border border-line bg-ink-2/50 py-2 pl-4 pr-2">
      <p className="min-w-0 flex-1 text-[13px] leading-snug text-paper">
        <span className="font-medium">★ 30 min first.</span> <span className="text-paper-dim">{reason ?? "It counts fully."}</span>
      </p>
      <Button variant="ghost" size="sm" className="shrink-0" onClick={onFull}>
        Full instead
      </Button>
    </div>
  );
}

/** Circuit rounds as planned today (readiness can drop one). */
export function roundsOf(plan: SessionPlan): number {
  const most = Math.max(0, ...plan.exercises.map((e) => e.sets.length));
  return most || plan.rounds || 0;
}

/** Section line above the exercise cards: which version and how long. */
export function PlanHeading({ plan }: { plan: SessionPlan }) {
  const travel = plan.code === "TRAVEL";
  const rounds = roundsOf(plan);
  return (
    <div className="flex flex-col gap-2">
      <SectionHeader right={fmtApproxMin(plan.est_minutes)}>
        {modeLabel(plan.mode, plan.code)}
        {travel && rounds ? ` · ${rounds} rounds` : ""}
      </SectionHeader>
      {travel && <Pill>Circuit: one set of each exercise in a row, then rest. {rounds} rounds.</Pill>}
    </div>
  );
}
