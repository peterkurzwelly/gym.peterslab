/** Today's fat loss levers: protein, steps, weight. One tap each. */
import type { BodyState } from "@gym/engine";
import type { Settings } from "@gym/schema";
import { useState, type ReactNode } from "react";
import { Bar, Button, CheckIcon, ChevronIcon, FlameIcon, PlusIcon, ScaleIcon, Sheet, StepsIcon } from "../../components";
import { cx } from "../../lib/cx";
import { fmtInt, fmtKg } from "../../lib/format";
import { ProfileSheet, ProteinSheet, StepsSheet, WeightSheet, quickAddProtein } from "./BodySheets";
import { plain } from "../../lib/plain";

type Open = null | "weight" | "protein" | "steps" | "profile" | "why";

function Row({ icon, color, label, value, sub, progress, done, onOpen, action }: { icon: ReactNode; color: string; label: string; value: ReactNode; sub?: ReactNode; progress?: number; done?: boolean; onOpen: () => void; action?: ReactNode }) {
  return (
    <div className="flex items-stretch">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 pr-2 text-left active:bg-raise">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full" style={{ background: `color-mix(in oklab, ${color} 18%, transparent)`, color }}>
          {done ? <CheckIcon size={22} strokeWidth={2.5} /> : icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="text-[15px] font-semibold text-fg">{label}</span>
            <span className="truncate text-[15px] tabular-nums text-fg">{value}</span>
          </span>
          {progress != null && <Bar value={progress} color={color} className="mt-2" />}
          {sub && <span className="mt-1.5 block truncate text-[12.5px] text-fg-faint">{sub}</span>}
        </span>
      </button>
      <div className="flex shrink-0 items-center pr-3">{action ?? <ChevronIcon size={18} className="text-fg-faint" />}</div>
    </div>
  );
}

const signed = (n: number, digits = 1) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(digits)}`;

export function BodyCard({ body, settings }: { body: BodyState; settings: Settings }) {
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null);
  const t = body.targets;

  if (!body.profile_complete) {
    return (
      <section className="overflow-hidden rounded-[20px] bg-card p-4" aria-label="Fat loss targets">
        <div className="gym-label" style={{ color: "var(--color-fuel)" }}>
          The other half of ripped
        </div>
        <h2 className="m-0 mt-2 font-display text-[28px] uppercase text-fg">Set your fat loss targets</h2>
        <p className="m-0 mt-2 text-[14.5px] leading-snug text-fg-dim">
          Lifting keeps the muscle. What shows it is losing fat: a small calorie gap, enough protein, daily steps. Four numbers and the app does the maths.
        </p>
        <Button variant="secondary" size="md" block className="mt-4 !bg-fg !text-night" onClick={() => setOpen("profile")}>
          Set up · 30 seconds
        </Button>
        <ProfileSheet open={open === "profile"} onClose={close} settings={settings} body={body} />
      </section>
    );
  }

  const proteinTarget = t.protein_g ?? 0;
  const weightSub =
    body.current_is_trend && body.trend_weight != null
      ? `Trend ${fmtKg(Math.round(body.trend_weight * 10) / 10)} kg${body.rate_kg_per_week != null ? ` · ${signed(body.rate_kg_per_week)} kg a week` : ""}`
      : body.weighed_today
        ? undefined
        : "Most mornings, before breakfast";

  return (
    <section className="overflow-hidden rounded-[20px] bg-card" aria-label="Today's targets">
      <div className="flex items-center justify-between gap-3 px-4 pt-3.5">
        <span className="gym-label">Fuel and move</span>
        <button type="button" onClick={() => setOpen("why")} className="-mr-2 min-h-9 rounded-full px-2 text-[12.5px] font-semibold tabular-nums text-fg-dim active:bg-raise">
          {t.kcal != null ? `${fmtInt(t.kcal)} kcal a day` : "Targets"} ›
        </button>
      </div>

      <div className="divide-y divide-line/60">
        <Row
          icon={<FlameIcon size={22} />}
          color="var(--color-fuel)"
          label="Protein"
          value={
            <>
              {Math.round(body.protein_today)}
              <span className="text-fg-faint"> / {proteinTarget} g</span>
            </>
          }
          progress={proteinTarget ? body.protein_today / proteinTarget : 0}
          done={body.protein_hit}
          onOpen={() => setOpen("protein")}
          action={
            <button
              type="button"
              aria-label="Add 25 grams of protein"
              onClick={() => quickAddProtein(body.today, 25)}
              className="gym-press flex min-h-11 items-center gap-0.5 rounded-full bg-raise px-3 text-[13.5px] font-semibold tabular-nums text-fg active:bg-raise-2"
            >
              <PlusIcon size={16} strokeWidth={2.25} />
              25
            </button>
          }
        />
        <Row
          icon={<StepsIcon size={22} />}
          color="var(--color-move)"
          label="Steps"
          value={
            <>
              {fmtInt(body.steps_today)}
              <span className="text-fg-faint"> / {fmtInt(t.steps)}</span>
            </>
          }
          progress={t.steps ? body.steps_today / t.steps : 0}
          done={body.steps_hit}
          onOpen={() => setOpen("steps")}
        />
        <Row
          icon={<ScaleIcon size={22} />}
          color="var(--color-body)"
          label="Weight"
          value={body.weighed_today && body.log_today?.weight_kg != null ? `${body.log_today.weight_kg.toFixed(1)} kg` : <span className="font-semibold text-volt">Log</span>}
          sub={weightSub}
          done={body.weighed_today}
          onOpen={() => setOpen("weight")}
        />
      </div>

      {body.pace !== "setup" && (
        <div className={cx("border-t border-line/60 px-4 py-3 text-[13.5px] leading-snug", body.pace === "on_pace" ? "text-volt" : "text-fg-dim")}>{plain(body.pace_text)}</div>
      )}

      <WeightSheet open={open === "weight"} onClose={close} body={body} />
      <ProteinSheet open={open === "protein"} onClose={close} body={body} />
      <StepsSheet open={open === "steps"} onClose={close} body={body} />
      <ProfileSheet open={open === "profile"} onClose={close} settings={settings} body={body} />
      <Sheet open={open === "why"} onClose={close} title="Your daily targets" eyebrow="Fuel and move">
        <div className="flex flex-col gap-3 pt-2">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Calories" value={t.kcal != null ? fmtInt(t.kcal) : "·"} unit="kcal" color="var(--color-fuel)" />
            <Stat label="Protein" value={t.protein_g != null ? String(t.protein_g) : "·"} unit="g" color="var(--color-fuel)" />
            <Stat label="Steps" value={fmtInt(t.steps)} unit="a day" color="var(--color-move)" />
          </div>
          <p className="m-0 text-[15px] leading-snug text-fg">{plain(t.reason)}</p>
          {body.decisions
            .filter((d) => d.rule_id !== t.rule_id)
            .slice(-3)
            .map((d) => (
              <p key={d.id} className="m-0 rounded-2xl bg-raise px-4 py-3 text-[13.5px] leading-snug text-fg-dim">
                {plain(d.explanation)}
              </p>
            ))}
          <p className="m-0 text-[13.5px] leading-snug text-fg-dim">
            You do not have to count calories. Hit protein and steps, weigh in most mornings, and the app tells you when to eat a little less or more.
          </p>
          <Button variant="secondary" size="md" block onClick={() => setOpen("profile")}>
            Change goal or details
          </Button>
        </div>
      </Sheet>
    </section>
  );
}

function Stat({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <div className="rounded-2xl bg-raise px-3 py-3">
      <div className="gym-label" style={{ color }}>
        {label}
      </div>
      <div className="mt-1.5 font-display text-[30px] leading-none text-fg">{value}</div>
      <div className="mt-1 text-[11.5px] text-fg-faint">{unit}</div>
    </div>
  );
}
