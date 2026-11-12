/** Sheets for the daily body numbers (weight, protein, steps) and the profile the targets are built from. */
import type { BodyState } from "@gym/engine";
import type { Settings } from "@gym/schema";
import { useEffect, useState, type ReactNode } from "react";
import { Button, SegmentedControl, Sheet, Stepper } from "../../components";
import { addToBodyLog, saveBodyLog, updateSettings } from "../../data";
import { fmtInt, fmtKg } from "../../lib/format";

const warn = (what: string) => (e: unknown) => console.warn(`[body] ${what}`, e);

// ---------------- weight ----------------

export function WeightSheet({ open, onClose, body }: { open: boolean; onClose: () => void; body: BodyState }) {
  const start = body.log_today?.weight_kg ?? body.latest_weight ?? 80;
  const [weight, setWeight] = useState(start);
  const [waist, setWaist] = useState<number | null>(body.log_today?.waist_cm ?? null);
  useEffect(() => {
    if (open) {
      setWeight(start);
      setWaist(body.log_today?.waist_cm ?? null);
    }
    // Reset only when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const lastWaist = body.waist?.latest ?? 90;

  return (
    <Sheet open={open} onClose={onClose} title="Body weight" eyebrow="Morning, before breakfast">
      <div className="flex flex-col gap-4 pt-2">
        <Stepper label="Weight" value={weight} step={0.1} min={30} max={300} onChange={setWeight} format={(v) => v.toFixed(1)} unit="kg" inputMode="decimal" />
        <p className="m-0 text-[13.5px] leading-snug text-fg-dim">
          Single days jump around with water and salt. The app looks at the 7 day trend, so weigh in most mornings and ignore the daily number.
        </p>
        <div className="rounded-2xl bg-raise p-3">
          {waist == null ? (
            <button type="button" onClick={() => setWaist(lastWaist)} className="min-h-11 w-full text-left text-[15px] text-fg">
              Add waist measurement <span className="text-fg-dim">· once a week, at the navel</span>
            </button>
          ) : (
            <Stepper label="Waist" value={waist} step={0.5} min={40} max={200} onChange={setWaist} format={(v) => v.toFixed(1)} unit="cm" inputMode="decimal" />
          )}
        </div>
        <Button
          variant="primary"
          size="lg"
          block
          onClick={() => {
            void saveBodyLog(body.today, { weight_kg: Math.round(weight * 10) / 10, ...(waist != null ? { waist_cm: waist } : {}) }).catch(warn("weight"));
            onClose();
          }}
        >
          Save
        </Button>
      </div>
    </Sheet>
  );
}

// ---------------- protein ----------------

const PROTEIN_ADDS = [10, 20, 30, 40] as const;

export function ProteinSheet({ open, onClose, body }: { open: boolean; onClose: () => void; body: BodyState }) {
  const [total, setTotal] = useState(body.protein_today);
  const [kcal, setKcal] = useState<number | null>(body.kcal_today);
  useEffect(() => {
    if (open) {
      setTotal(body.protein_today);
      setKcal(body.kcal_today);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const target = body.targets.protein_g;
  const kcalTarget = body.targets.kcal;

  return (
    <Sheet open={open} onClose={onClose} title="Protein today" eyebrow={target ? `Target ${target} g` : "Fuel"}>
      <div className="flex flex-col gap-4 pt-2">
        <Stepper label="Protein" value={total} step={5} min={0} max={500} onChange={(v) => setTotal(Math.round(v))} unit="g" inputMode="numeric" />
        <div className="flex gap-2">
          {PROTEIN_ADDS.map((g) => (
            <button key={g} type="button" onClick={() => setTotal((t) => Math.min(500, t + g))} className="gym-press min-h-12 flex-1 rounded-2xl bg-raise text-[15px] font-semibold text-fg active:bg-raise-2">
              +{g}
            </button>
          ))}
        </div>
        <p className="m-0 text-[13.5px] leading-snug text-fg-dim">
          Rough is fine. A palm of meat or fish is about 25 to 30 g, a scoop of whey 25 g, 250 g of quark or skyr 25 to 30 g, three eggs 20 g.
        </p>
        <div className="rounded-2xl bg-raise p-3">
          {kcal == null ? (
            <button type="button" onClick={() => setKcal(kcalTarget ?? 2000)} className="min-h-11 w-full text-left text-[15px] text-fg">
              Add calories <span className="text-fg-dim">· optional{kcalTarget ? `, target ${fmtInt(kcalTarget)}` : ""}</span>
            </button>
          ) : (
            <Stepper label="Calories" value={kcal} step={50} min={0} max={10000} onChange={(v) => setKcal(Math.round(v))} unit="kcal" inputMode="numeric" />
          )}
        </div>
        <Button
          variant="primary"
          size="lg"
          block
          onClick={() => {
            void saveBodyLog(body.today, { protein_g: total, ...(kcal != null ? { kcal } : {}) }).catch(warn("protein"));
            onClose();
          }}
        >
          Save
        </Button>
      </div>
    </Sheet>
  );
}

/** One tap from the Today card: add a portion without opening anything. */
export function quickAddProtein(date: string, grams: number): void {
  void addToBodyLog(date, "protein_g", grams).catch(warn("protein"));
}

// ---------------- steps ----------------

export function StepsSheet({ open, onClose, body }: { open: boolean; onClose: () => void; body: BodyState }) {
  const [steps, setSteps] = useState(body.steps_today);
  useEffect(() => {
    if (open) setSteps(body.steps_today);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Sheet open={open} onClose={onClose} title="Steps today" eyebrow={`Target ${fmtInt(body.targets.steps)}`}>
      <div className="flex flex-col gap-4 pt-2">
        <Stepper label="Steps" value={steps} step={500} min={0} max={100000} onChange={(v) => setSteps(Math.round(v))} format={fmtInt} inputMode="numeric" />
        <p className="m-0 text-[13.5px] leading-snug text-fg-dim">
          Read the number from the Health app in the evening and type it here. Walking is the cheapest fat loss there is: it burns calories without making you hungrier or more tired for the gym.
        </p>
        <Button
          variant="primary"
          size="lg"
          block
          onClick={() => {
            void saveBodyLog(body.today, { steps }).catch(warn("steps"));
            onClose();
          }}
        >
          Save
        </Button>
      </div>
    </Sheet>
  );
}

// ---------------- profile and goal ----------------

type Goal = Settings["goal"];
const GOALS: { value: Goal; label: string }[] = [
  { value: "cut", label: "Lose fat" },
  { value: "recomp", label: "Recomp" },
  { value: "gain", label: "Build" },
];
const GOAL_HELP: Record<Goal, string> = {
  cut: "Eat a bit under what you burn, keep protein high, keep lifting. Fat goes, muscle stays. This is the road to ripped.",
  recomp: "Eat around maintenance. Slow fat loss and slow muscle gain at the same time. Works best when you are new or returning.",
  gain: "Eat a little over maintenance to build muscle. For when you are already lean.",
};
const PACES = [
  { value: 0.35, label: "Easy" },
  { value: 0.5, label: "Steady" },
  { value: 0.75, label: "Fast" },
] as const;
const JOBS: { value: Settings["job_activity"]; label: string }[] = [
  { value: "desk", label: "Desk" },
  { value: "feet", label: "On my feet" },
  { value: "physical", label: "Physical" },
];

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <div className="gym-label">{label}</div>
        {hint && <div className="mt-1 text-[13px] leading-snug text-fg-dim">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

export function ProfileSheet({ open, onClose, settings, body }: { open: boolean; onClose: () => void; settings: Settings; body: BodyState }) {
  const year = Number(body.today.slice(0, 4));
  const [sex, setSex] = useState<Settings["sex"]>(settings.sex);
  const [birthYear, setBirthYear] = useState(settings.birth_year ?? year - 40);
  const [height, setHeight] = useState(settings.height_cm ?? 180);
  const [weight, setWeight] = useState(body.latest_weight ?? 85);
  const [job, setJob] = useState(settings.job_activity);
  const [goal, setGoal] = useState<Goal>(settings.goal);
  const [rate, setRate] = useState(settings.cut_rate_pct);
  const [goalWeight, setGoalWeight] = useState<number | null>(settings.goal_weight_kg);
  const [steps, setSteps] = useState(settings.steps_target);

  useEffect(() => {
    if (!open) return;
    setSex(settings.sex);
    setBirthYear(settings.birth_year ?? year - 40);
    setHeight(settings.height_cm ?? 180);
    setWeight(body.latest_weight ?? 85);
    setJob(settings.job_activity);
    setGoal(settings.goal);
    setRate(settings.cut_rate_pct);
    setGoalWeight(settings.goal_weight_kg);
    setSteps(settings.steps_target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const paceValue = PACES.reduce((best, p) => (Math.abs(p.value - rate) < Math.abs(best - rate) ? p.value : best), PACES[0].value as number);

  const save = () => {
    // A new goal or pace is judged from today on. The weeks before keep the verdict of their time, and the
    // calorie correction they earned is carried over as it stands (ENGINE_RULES 10).
    const goalChanged = body.profile_complete && (goal !== settings.goal || rate !== settings.cut_rate_pct);
    void updateSettings({
      sex,
      birth_year: birthYear,
      height_cm: height,
      job_activity: job,
      goal,
      cut_rate_pct: rate,
      goal_weight_kg: goalWeight,
      steps_target: steps,
      ...(goalChanged ? { body_adjust_since: body.today, body_adjust_base_kcal: body.targets.adjustments_kcal } : {}),
    }).catch(warn("profile"));
    const rounded = Math.round(weight * 10) / 10;
    if (body.latest_weight !== rounded) void saveBodyLog(body.today, { weight_kg: rounded }).catch(warn("weight"));
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="You and your goal" eyebrow="Used for calories and protein">
      <div className="flex flex-col gap-5 pt-2">
        <Field label="Goal" hint={GOAL_HELP[goal]}>
          <SegmentedControl label="Goal" options={GOALS} value={goal} onChange={setGoal} />
        </Field>

        <Field label="Sex" hint="Only for the calorie estimate.">
          <SegmentedControl
            label="Sex"
            options={[
              { value: "male", label: "Male" },
              { value: "female", label: "Female" },
            ]}
            value={sex ?? ("" as "male")}
            onChange={setSex}
          />
        </Field>

        <div className="flex flex-col gap-2.5">
          <Stepper label="Born" value={birthYear} step={1} min={1930} max={year - 14} onChange={(v) => setBirthYear(Math.round(v))} inputMode="numeric" />
          <Stepper label="Height" value={height} step={1} min={130} max={230} onChange={(v) => setHeight(Math.round(v))} unit="cm" inputMode="numeric" />
          <Stepper label="Weight" value={weight} step={0.5} min={30} max={300} onChange={setWeight} format={(v) => v.toFixed(1)} unit="kg" inputMode="decimal" />
        </div>

        <Field label="Day job">
          <SegmentedControl label="Day job" options={JOBS} value={job} onChange={setJob} />
        </Field>

        {goal === "cut" && (
          <Field label="Pace" hint="Steady keeps strength and mood. Fast is for short stretches.">
            <div role="radiogroup" aria-label="Pace" className="grid grid-cols-3 gap-2">
              {PACES.map((p) => {
                const on = p.value === paceValue;
                return (
                  <button
                    key={p.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setRate(p.value)}
                    className={`gym-press flex min-h-[58px] flex-col items-center justify-center rounded-2xl px-1 ${on ? "bg-fg text-night" : "bg-raise text-fg"}`}
                  >
                    <span className="text-[15px] font-semibold leading-tight">{p.label}</span>
                    <span className={`text-[12px] tabular-nums leading-tight ${on ? "text-night/70" : "text-fg-dim"}`}>{((weight * p.value) / 100).toFixed(1)} kg a week</span>
                  </button>
                );
              })}
            </div>
          </Field>
        )}

        <div className="rounded-2xl bg-raise p-3">
          {goalWeight == null ? (
            <button type="button" onClick={() => setGoalWeight(Math.round(weight * (goal === "gain" ? 1.03 : goal === "recomp" ? 1 : 0.92)))} className="min-h-11 w-full text-left text-[15px] text-fg">
              Add a goal weight <span className="text-fg-dim">· optional</span>
            </button>
          ) : (
            <div className="flex flex-col gap-1">
              <Stepper label="Goal weight" value={goalWeight} step={0.5} min={30} max={300} onChange={setGoalWeight} format={(v) => v.toFixed(1)} unit="kg" inputMode="decimal" />
              <button type="button" onClick={() => setGoalWeight(null)} className="min-h-11 self-end px-2 text-[13px] text-fg-dim">
                Remove
              </button>
            </div>
          )}
        </div>

        <Stepper label="Steps" value={steps} step={500} min={2000} max={30000} onChange={(v) => setSteps(Math.round(v))} format={fmtInt} unit="a day" inputMode="numeric" />

        <Button variant="primary" size="lg" block disabled={sex == null} onClick={save}>
          {sex == null ? "Pick male or female first" : "Save"}
        </Button>
        <p className="m-0 text-center text-[12.5px] leading-snug text-fg-faint">Estimates, not medical advice. The app corrects the calories from your real weight trend after two weeks.</p>
      </div>
    </Sheet>
  );
}
