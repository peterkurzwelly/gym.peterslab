/** Who you are and what you are going for: the inputs behind the calorie, protein and steps targets. */
import type { BodyState } from "@gym/engine";
import type { Settings } from "@gym/schema";
import { useState } from "react";
import { Button } from "../../components";
import { fmtInt } from "../../lib/format";
import { ProfileSheet } from "../home/BodySheets";
import { plain } from "../../lib/plain";

const GOAL_NAME: Record<Settings["goal"], string> = { cut: "Lose fat, keep muscle", recomp: "Recomp", gain: "Build muscle" };
const JOB_NAME: Record<Settings["job_activity"], string> = { desk: "desk job", feet: "on your feet", physical: "physical job" };

function Stat({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-raise px-3 py-3">
      <div className="gym-label truncate" style={{ color }}>
        {label}
      </div>
      <div className="mt-1.5 font-display text-[28px] leading-none text-fg">{value}</div>
      <div className="mt-1 text-[11.5px] text-fg-faint">{unit}</div>
    </div>
  );
}

export function GoalSection({ settings, body }: { settings: Settings; body: BodyState }) {
  const [open, setOpen] = useState(false);
  const t = body.targets;
  const facts = [
    settings.birth_year ? `Born ${settings.birth_year}` : null,
    settings.height_cm ? `${settings.height_cm} cm` : null,
    body.latest_weight != null ? `${body.latest_weight.toFixed(1)} kg` : null,
    JOB_NAME[settings.job_activity],
  ].filter(Boolean);

  return (
    <section id="goal" className="scroll-mt-16 rounded-[20px] bg-card p-4" aria-label="Your goal">
      <div className="gym-label text-volt">Your goal</div>
      <h2 className="m-0 mt-2 font-display text-[30px] uppercase leading-none text-fg">{GOAL_NAME[settings.goal]}</h2>
      {body.profile_complete ? (
        <>
          <p className="m-0 mt-2 text-[13.5px] leading-snug text-fg-dim">
            {facts.join(" · ")}
            {settings.goal === "cut" ? ` · ${settings.cut_rate_pct}% of body weight a week` : ""}
            {settings.goal_weight_kg != null ? ` · goal ${settings.goal_weight_kg.toFixed(1)} kg` : ""}
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Stat label="Calories" value={t.kcal != null ? fmtInt(t.kcal) : "·"} unit="kcal a day" color="var(--color-fuel)" />
            <Stat label="Protein" value={t.protein_g != null ? String(t.protein_g) : "·"} unit="g a day" color="var(--color-fuel)" />
            <Stat label="Steps" value={fmtInt(t.steps)} unit="a day" color="var(--color-move)" />
          </div>
          <p className="m-0 mt-3 text-[13px] leading-snug text-fg-dim">{plain(t.reason)}</p>
        </>
      ) : (
        <p className="m-0 mt-2 text-[14.5px] leading-snug text-fg-dim">Add four numbers and the app works out your calories, protein and steps, then corrects them from your real weight trend.</p>
      )}
      <Button variant="secondary" size="md" block className="mt-4" onClick={() => setOpen(true)}>
        {body.profile_complete ? "Change goal or details" : "Set up · 30 seconds"}
      </Button>
      <ProfileSheet open={open} onClose={() => setOpen(false)} settings={settings} body={body} />
    </section>
  );
}
