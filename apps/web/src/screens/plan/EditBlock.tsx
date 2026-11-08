/**
 * Edit: swap an exercise for the block (non main lifts) and change the session order.
 * Writes go through updateSettings ({ block_swaps } / { session_order }); the engine replans from there.
 */
import { planSession, type AlternativeOption, type EngineContext, type EngineState, type PlannedExercise, type SessionPlan } from "@gym/engine";
import type { Prescription, StrengthDayCode } from "@gym/schema";
import { useMemo, useState } from "react";
import { Badge, Button, Card, CheckIcon, ChevronIcon, SegmentedControl } from "../../components";
import { updateSettings } from "../../data";
import { cx } from "../../lib/cx";
import { fmtRangeAmount } from "../../lib/format";
import { ArrowDownIcon, ArrowUpIcon, LockIcon } from "./ui";

export const MAIN_LIFT_NOTE = "Main lifts stay fixed for the block. Swap for one session on Today.";

interface SwapOption extends AlternativeOption {
  primary: boolean;
}

function findPrescription(ctx: EngineContext, id: string): Prescription | undefined {
  for (const d of ctx.program.days) {
    const p = d.prescriptions.find((x) => x.id === id);
    if (p) return p;
  }
  return undefined;
}

/**
 * Program exercise first, then the listed alternatives (with their allowed state). The exercise in use is
 * always in the list: the engine leaves it out of `alternatives`, so after a block swap it is added back here.
 */
export function swapOptions(ex: PlannedExercise, ctx: EngineContext): SwapOption[] {
  const p = findPrescription(ctx, ex.prescription_id);
  const primary: SwapOption = {
    exercise_id: ex.primary_exercise_id,
    name: ex.primary_name ?? ctx.exercises[ex.primary_exercise_id]?.name ?? ex.primary_exercise_id,
    rep_min: p?.rep_min ?? ex.rep_min,
    rep_max: p?.rep_max ?? ex.rep_max,
    measure: p?.measure ?? ex.measure,
    allowed: ex.swapped !== "limitation",
    reason: ex.swapped === "limitation" ? "Set aside for your limitations." : null,
    primary: true,
  };
  const alternatives = ex.alternatives.filter((a) => a.exercise_id !== primary.exercise_id).map((a) => ({ ...a, primary: false }));
  const current: SwapOption[] =
    ex.exercise_id !== primary.exercise_id && !alternatives.some((a) => a.exercise_id === ex.exercise_id)
      ? [{ exercise_id: ex.exercise_id, name: ex.name, rep_min: ex.rep_min, rep_max: ex.rep_max, measure: ex.measure, allowed: true, reason: null, primary: false }]
      : [];
  return [primary, ...current, ...alternatives];
}

function safePlan(ctx: EngineContext, code: StrengthDayCode): SessionPlan | null {
  try {
    return planSession(ctx, { code, mode: "full" });
  } catch {
    return null;
  }
}

function ExerciseRow({ ex, ctx, open, onToggle }: { ex: PlannedExercise; ctx: EngineContext; open: boolean; onToggle: () => void }) {
  const [saving, setSaving] = useState(false);
  const options = swapOptions(ex, ctx);
  const primaryName = options[0]!.name;
  const amount = fmtRangeAmount(ex.rep_min, ex.rep_max, { measure: ex.measure, per_side: ex.per_side, name: ex.name });
  const hasChoice = options.length > 1;

  const choose = async (o: SwapOption) => {
    if (o.exercise_id === ex.exercise_id || !o.allowed) return;
    setSaving(true);
    try {
      const swaps = { ...ctx.settings.block_swaps };
      if (o.primary) delete swaps[ex.prescription_id];
      else swaps[ex.prescription_id] = o.exercise_id;
      await updateSettings({ block_swaps: swaps });
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="border-t border-line/70">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="gym-press flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left active:bg-ink-3"
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[14.5px] text-paper">{ex.name}</span>
            {ex.starred && (
              <Badge tone="outline" title="In the 30 min version">
                ★
              </Badge>
            )}
            {ex.swapped === "block" && <Badge tone="neutral">For the block</Badge>}
          </span>
          <span className="mt-0.5 block text-[12px] text-paper-dim">
            {ex.sets.length} × {amount}
            {ex.swapped === "block" && <span className="text-paper-faint"> · program: {primaryName}</span>}
          </span>
        </span>
        {ex.main_lift ? (
          <LockIcon size={18} className="shrink-0 text-paper-faint" aria-label="Main lift, fixed for the block" />
        ) : hasChoice ? (
          <ChevronIcon size={18} className={cx("shrink-0 text-paper-faint transition-transform duration-100 motion-reduce:transition-none", open && "rotate-90")} />
        ) : null}
      </button>
      {open && ex.main_lift && (
        <p className="m-0 flex items-start gap-2 px-4 pb-3 text-[13px] leading-snug text-paper-dim">
          <LockIcon size={16} className="mt-[1px] shrink-0 text-paper-faint" />
          <span>{MAIN_LIFT_NOTE}</span>
        </p>
      )}
      {open && !ex.main_lift && (
        <div className="bg-ink/60 pb-1">
          <div className="px-4 pb-1 pt-1 text-[11px] uppercase tracking-[0.14em] text-paper-faint">Swap for the block</div>
          {!hasChoice ? (
            <p className="m-0 px-4 py-2 text-[13px] text-paper-faint">No alternatives listed for this exercise.</p>
          ) : (
            <ul role="radiogroup" aria-label={`Exercise for ${primaryName} this block`} className="m-0 list-none p-0">
              {options.map((o) => {
                const on = o.exercise_id === ex.exercise_id;
                const range = fmtRangeAmount(o.rep_min, o.rep_max, { measure: o.measure, per_side: ex.per_side, name: o.name });
                return (
                  <li key={o.exercise_id}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={`${o.name}${o.primary ? ", program exercise" : ""}, ${range}${!o.allowed && o.reason ? `. ${o.reason}` : ""}`}
                      disabled={!o.allowed || saving}
                      onClick={() => void choose(o)}
                      className="gym-press flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left active:bg-ink-3 disabled:active:bg-transparent"
                    >
                      <span className={cx("grid h-5 w-5 shrink-0 place-items-center rounded-full border", on ? "border-paper bg-paper text-ink" : "border-paper-faint")}>
                        {on && <CheckIcon size={14} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cx("block text-[14px]", o.allowed ? "text-paper" : "text-paper-faint line-through decoration-paper-faint/50")}>
                          {o.name}
                          {o.primary && <span className="text-paper-faint"> · program</span>}
                        </span>
                        {!o.allowed && o.reason && <span className="block text-[12px] leading-snug text-paper-faint">{o.reason}</span>}
                      </span>
                      <span className="shrink-0 text-[12px] tabular-nums text-paper-dim">{range}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function SessionOrder({ state, ctx }: { state: EngineState; ctx: EngineContext }) {
  const order = ctx.settings.session_order.length ? ctx.settings.session_order : ctx.program.rotation;
  const def = ctx.program.rotation;
  const isDefault = order.join() === def.join();
  const [saving, setSaving] = useState(false);
  const names = Object.fromEntries(ctx.program.days.map((d) => [d.code, d.name]));

  const save = async (next: StrengthDayCode[]) => {
    setSaving(true);
    try {
      await updateSettings({ session_order: next });
    } finally {
      setSaving(false);
    }
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j]!, next[i]!];
    void save(next);
  };

  return (
    <Card label="Session order" meta={order.join(" → ")} flush>
      <ol className="m-0 list-none p-0" aria-label="Session order">
        {order.map((code, i) => (
          <li key={code} className={cx("flex min-h-12 items-center gap-3 pl-4 pr-2", i > 0 && "border-t border-line/70")}>
            <span className="w-4 text-[12px] text-paper-faint">{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] text-paper">Session {code}</span>
              {names[code] && <span className="block truncate text-[12px] text-paper-dim">{names[code]}</span>}
            </span>
            {state.next.code === code && <Badge tone="outline">Next</Badge>}
            <button
              type="button"
              aria-label={`Move session ${code} earlier`}
              disabled={i === 0 || saving}
              onClick={() => move(i, -1)}
              className="gym-press grid h-11 w-11 place-items-center rounded-[3px] text-paper-dim active:bg-ink-3 disabled:opacity-25"
            >
              <ArrowUpIcon size={18} />
            </button>
            <button
              type="button"
              aria-label={`Move session ${code} later`}
              disabled={i === order.length - 1 || saving}
              onClick={() => move(i, 1)}
              className="gym-press grid h-11 w-11 place-items-center rounded-[3px] text-paper-dim active:bg-ink-3 disabled:opacity-25"
            >
              <ArrowDownIcon size={18} />
            </button>
          </li>
        ))}
      </ol>
      <div className="flex min-h-11 items-center justify-between gap-3 border-t border-line/70 pl-4 pr-1">
        <span className="text-[12px] leading-snug text-paper-faint">The next session follows this order. No fixed days.</span>
        {!isDefault && (
          <Button variant="ghost" size="sm" disabled={saving} onClick={() => void save([...def])}>
            Reset
          </Button>
        )}
      </div>
    </Card>
  );
}

export function EditBlock({ state, ctx }: { state: EngineState; ctx: EngineContext }) {
  const codes = ctx.program.rotation;
  const [code, setCode] = useState<StrengthDayCode>(codes[0] ?? "A");
  const [open, setOpen] = useState<string | null>(null);
  const plans = useMemo(() => Object.fromEntries(codes.map((c) => [c, safePlan(ctx, c)])) as Record<string, SessionPlan | null>, [ctx, codes]);
  const plan = plans[code] ?? null;

  return (
    <div className="flex flex-col gap-3">
      <Card label="Swap for the block" flush>
        <div className="px-4 pb-3 pt-3">
          <SegmentedControl
            label="Session"
            value={code}
            onChange={(c) => {
              setCode(c);
              setOpen(null);
            }}
            options={codes.map((c) => ({ value: c, label: `Session ${c}` }))}
          />
        </div>
        {plan ? (
          <ul className="m-0 list-none p-0">
            {plan.exercises.map((ex) => (
              <ExerciseRow
                key={ex.prescription_id}
                ex={ex}
                ctx={ctx}
                open={open === ex.prescription_id}
                onToggle={() => setOpen((o) => (o === ex.prescription_id ? null : ex.prescription_id))}
              />
            ))}
          </ul>
        ) : (
          <p className="m-0 border-t border-line/70 px-4 py-3 text-[13px] text-paper-faint">This session could not be planned right now. Your log is safe.</p>
        )}
        <p className="m-0 flex items-start gap-2 border-t border-line/70 px-4 py-3 text-[12px] leading-snug text-paper-faint">
          <LockIcon size={15} className="mt-[1px] shrink-0" />
          <span>{MAIN_LIFT_NOTE}</span>
        </p>
      </Card>
      <SessionOrder state={state} ctx={ctx} />
    </div>
  );
}
