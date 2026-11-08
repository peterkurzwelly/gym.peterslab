/**
 * Cardio inline on Today: interval timer (segments from the plan, screen kept awake), then a log form
 * prefilled from the timer. "Log without timer" goes straight to the form.
 */
import type { CardioPlan } from "@gym/engine";
import type { CardioModality, Session } from "@gym/schema";
import { useState } from "react";
import {
  Button,
  Card,
  CardioLogForm,
  CloseIcon,
  IntervalTimer,
  Pill,
  SpacingWarnings,
  describeCardio,
  type CardioLogValues,
  type IntervalResult,
} from "../../components";
import { discardSession, finishSession, logCardio, startCardioSession } from "../../data";
import { fmtApproxMin, fmtClock } from "../../lib/format";
import { readCardioModality, writeCardioModality } from "./storage";

export interface CardioPanelProps {
  plan: CardioPlan;
  /** A cardio session already in progress (resumed after a reload or from another device). */
  session: Session | null;
  sound: boolean;
  /** Close without logging. */
  onClose: () => void;
  onSaved: (sessionId: string) => void;
  className?: string;
}

const round = (n: number) => Math.max(1, Math.round(n));

export function CardioPanel({ plan, session, sound, onClose, onSaved, className }: CardioPanelProps) {
  const [stage, setStage] = useState<"timer" | "log">("timer");
  const [result, setResult] = useState<IntervalResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const modalities: CardioModality[] = plan.modality_options.length ? plan.modality_options : ["bike", "rower"];
  const remembered = readCardioModality() as CardioModality | null;
  const modality = remembered && modalities.includes(remembered) ? remembered : modalities[0]!;
  const hard = plan.kind === "intervals";

  // Resumed session without timer data: prefill the minutes since it started, capped at the plan.
  const resumedMin = session ? Math.min(plan.total_min, (Date.now() - Date.parse(session.started_at)) / 60_000) : null;

  const initial: Partial<CardioLogValues> = result
    ? {
        modality,
        minutes: round(result.minutes),
        intensity: hard && result.hardMinutes > 0 ? "hard" : "easy",
        hard_minutes: hard && result.hardMinutes > 0 ? result.hardMinutes : null,
      }
    : {
        modality,
        minutes: resumedMin != null && resumedMin >= 5 ? round(resumedMin) : plan.total_min,
        intensity: hard ? "hard" : "easy",
        hard_minutes: hard ? plan.hard_minutes : null,
      };

  const save = async (v: CardioLogValues) => {
    if (saving) return;
    setSaving(true);
    setNotice(null);
    try {
      const s = session ?? (await startCardioSession());
      await logCardio({
        sessionId: s.id,
        modality: v.modality,
        minutes: v.minutes,
        hardMinutes: v.intensity === "hard" ? (v.hard_minutes ?? (hard ? plan.hard_minutes : null)) : 0,
        intensity: v.intensity,
        avgHr: v.avg_hr,
        source: result ? "timer" : "manual",
      });
      const fin = await finishSession(s.id);
      if (fin.error) console.warn("[today] cardio decisions not stored", fin.error);
      writeCardioModality(v.modality);
      onSaved(s.id);
    } catch (e) {
      console.warn("[today] cardio save", e);
      setNotice("That did not save. Try again.");
      setSaving(false);
    }
  };

  const close = async () => {
    if (session) await discardSession(session.id).catch((e) => console.warn("[today] cardio discard", e));
    onClose();
  };

  return (
    <Card
      className={className}
      label={`Cardio · ${plan.counts_as === "target" ? "counts toward target" : "bonus"}`}
      meta={
        <button type="button" aria-label={session ? "Discard cardio" : "Close cardio"} onClick={() => void close()} className="-mr-3 grid h-9 w-11 place-items-center text-paper-dim active:text-paper">
          <CloseIcon size={18} />
        </button>
      }
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[16px] text-paper">{describeCardio(plan)}</p>
        <span className="shrink-0 text-[13px] text-paper-dim">{fmtApproxMin(plan.total_min)}</span>
      </div>
      <p className="mt-1 text-[12px] leading-snug text-paper-faint">{plan.reason}</p>
      {hard && <SpacingWarnings warnings={plan.warnings} className="mt-3" />}

      {stage === "timer" ? (
        <>
          <IntervalTimer
            className="mt-5"
            plan={plan}
            sound={sound}
            onComplete={(r) => {
              setResult(r);
              setStage("log");
            }}
          />
          <Button variant="ghost" size="md" block className="mt-2" onClick={() => setStage("log")}>
            Log without timer
          </Button>
        </>
      ) : (
        <div className="mt-5">
          {result && (
            <p className="mb-3 text-[13px] tabular-nums text-paper-dim">
              Timer · {fmtClock(result.minutes * 60)} total
              {result.hardMinutes > 0 ? ` · ${result.hardMinutes} min hard` : ""}
            </p>
          )}
          {notice && <Pill className="mb-3">{notice}</Pill>}
          <CardioLogForm
            key={result ? "timer" : "manual"}
            modalities={modalities}
            initial={initial}
            onSave={(v) => void save(v)}
            onCancel={result ? undefined : () => setStage("timer")}
          />
        </div>
      )}
    </Card>
  );
}
