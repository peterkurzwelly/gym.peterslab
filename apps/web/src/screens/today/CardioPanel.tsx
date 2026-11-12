/**
 * Cardio inline on Today: interval timer (segments from the plan, screen kept awake), then a log form
 * prefilled from the timer. "Log without timer" goes straight to the form (offered until the timer starts).
 * The timer run is kept in sessionStorage per session, so a tab switch or a reload resumes it.
 */
import type { CardioPlan } from "@gym/engine";
import type { CardioModality, Session } from "@gym/schema";
import { useMemo, useRef, useState } from "react";
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
  type IntervalRun,
} from "../../components";
import { discardSession, finishSession, logCardio, startCardioSession } from "../../data";
import { fmtApproxMin, fmtClock } from "../../lib/format";
import { markSessionOpen } from "../../lib/updatePolicy";
import { readCardioModality, readIntervalRun, writeCardioModality, writeIntervalRun } from "./storage";
import { plain } from "../../lib/plain";

export interface CardioPanelProps {
  plan: CardioPlan;
  /** A cardio session already in progress (resumed after a reload or from another device). */
  session: Session | null;
  sound: boolean;
  /** Close without logging. */
  onClose: () => void;
  onSaved: (sessionId: string) => void;
  /** The screen around the panel already says what the session is: show only the timer and the log form. */
  bare?: boolean;
  className?: string;
}

const round = (n: number) => Math.max(1, Math.round(n));

export function CardioPanel({ plan, session, sound, onClose, onSaved, bare = false, className }: CardioPanelProps) {
  const [stage, setStage] = useState<"timer" | "log">("timer");
  const [result, setResult] = useState<IntervalResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  // A retried Save after a half done one: reuse the session it made and do not log the minutes twice.
  const made = useRef<Session | null>(null);
  const loggedFor = useRef<string | null>(null);
  const sessionId = session?.id ?? null;
  // A run from before a remount or reload of this panel, for this session only.
  const storedRun = useMemo(() => readIntervalRun(sessionId), [sessionId]);
  const [timerStarted, setTimerStarted] = useState(storedRun != null);
  const onRunChange = (run: IntervalRun | null) => {
    setTimerStarted(run != null);
    writeIntervalRun(sessionId, run);
  };

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
      const s = session ?? made.current ?? (made.current = await startCardioSession());
      if (loggedFor.current !== s.id) {
        await logCardio({
          sessionId: s.id,
          modality: v.modality,
          minutes: v.minutes,
          hardMinutes: v.intensity === "hard" ? (v.hard_minutes ?? (hard ? plan.hard_minutes : null)) : 0,
          intensity: v.intensity,
          avgHr: v.avg_hr,
          source: result ? "timer" : "manual",
        });
        loggedFor.current = s.id;
      }
      const fin = await finishSession(s.id);
      if (fin.error) console.warn("[today] cardio decisions not stored", fin.error);
      writeCardioModality(v.modality);
      writeIntervalRun(null, null);
      markSessionOpen(null);
      onSaved(s.id);
    } catch (e) {
      console.warn("[today] cardio save", e);
      setNotice("That did not save. Try again.");
      setSaving(false);
    }
  };

  const close = async () => {
    setAsking(false);
    writeIntervalRun(null, null);
    if (session) {
      await discardSession(session.id).catch((e) => console.warn("[today] cardio discard", e));
      markSessionOpen(null);
    }
    onClose();
  };
  // Nothing to lose before the timer starts: close at once. After that, ask inline first.
  const onX = () => (session && (timerStarted || stage === "log") ? setAsking(true) : void close());

  return (
    <Card
      className={className}
      label={bare ? (stage === "log" ? "Log it" : "Timer") : `Cardio · ${plan.counts_as === "target" ? "counts toward target" : "bonus"}`}
      meta={
        <button type="button" aria-label={session ? "Discard cardio" : "Close cardio"} onClick={onX} className="-mr-3 -my-1 grid h-11 w-11 place-items-center text-fg-dim active:text-fg">
          <CloseIcon size={18} />
        </button>
      }
    >
      {!bare && (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[16px] text-fg">{describeCardio(plan)}</p>
            <span className="shrink-0 text-[13px] text-fg-dim">{fmtApproxMin(plan.total_min)}</span>
          </div>
          <p className="mt-1 text-[12px] leading-snug text-fg-faint">{plain(plan.reason)}</p>
          {hard && <SpacingWarnings warnings={plan.warnings} className="mt-3" />}
        </>
      )}

      {asking && (
        <div className="mt-4 rounded-2xl border border-line bg-card/50 px-4 py-3" role="group" aria-label="Discard cardio">
          <p className="m-0 text-[14px] leading-snug text-fg">
            Discard this cardio? <span className="text-fg-dim">The timer stops and nothing is logged.</span>
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" size="md" className="flex-1" onClick={() => void close()}>
              Discard
            </Button>
            <Button variant="ghost" size="md" className="flex-1" onClick={() => setAsking(false)}>
              Keep it
            </Button>
          </div>
        </div>
      )}

      {stage === "timer" ? (
        <>
          <IntervalTimer
            className={bare ? "mt-1" : "mt-5"}
            plan={plan}
            sound={sound}
            initialRun={storedRun}
            onRunChange={onRunChange}
            onComplete={(r) => {
              setResult(r);
              setStage("log");
            }}
          />
          {/* Once the timer runs, End is the way out: it carries the minutes into the log. */}
          {!timerStarted && (
            <Button variant="ghost" size="md" block className="mt-2" onClick={() => setStage("log")}>
              Log without timer
            </Button>
          )}
        </>
      ) : (
        <div className="mt-5">
          {result && (
            <p className="mb-3 text-[13px] tabular-nums text-fg-dim">
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
