import { useEffect, useState } from "react";
import { cx } from "../lib/cx";
import { fmtScore } from "../lib/format";
import { Button } from "./Button";
import { ChipGroup } from "./Chip";

/** 1..5, higher is better for all four (DECISIONS D4). */
export interface CheckinScores {
  sleep: number;
  soreness: number;
  stress: number;
  energy: number;
}

type Metric = keyof CheckinScores;

const METRICS: { key: Metric; label: string; low: string; high: string }[] = [
  { key: "sleep", label: "Sleep", low: "poor", high: "great" },
  { key: "soreness", label: "Soreness", low: "very sore", high: "fresh" },
  { key: "stress", label: "Stress", low: "high", high: "calm" },
  { key: "energy", label: "Energy", low: "low", high: "high" },
];

const SCORES = [1, 2, 3, 4, 5] as const;

export function checkinAverage(s: CheckinScores): number {
  return (s.sleep + s.soreness + s.stress + s.energy) / 4;
}

export interface CheckinCardProps {
  /** Today's saved check-in, or null. */
  value: CheckinScores | null;
  /** The user skipped today. */
  skipped?: boolean;
  onSave: (scores: CheckinScores) => void;
  onSkip: () => void;
  /** Open the form when nothing is saved or skipped yet (default). False: start as one quiet row. */
  startOpen?: boolean;
  className?: string;
}

type Draft = Record<Metric, number | null>;
const empty: Draft = { sleep: null, soreness: null, stress: null, energy: null };

export function CheckinCard({ value, skipped, onSave, onSkip, startOpen = true, className }: CheckinCardProps) {
  const [open, setOpen] = useState(startOpen && !value && !skipped);
  const [draft, setDraft] = useState<Draft>(value ?? empty);
  // Shown until the parent passes the saved row back as `value`.
  const [savedLocal, setSavedLocal] = useState<CheckinScores | null>(null);
  const shown = value ?? savedLocal;

  // Collapse when a saved value or a skip arrives from the parent.
  useEffect(() => {
    if (value || skipped) setOpen(false);
    if (value) setDraft(value);
  }, [value, skipped]);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={cx("gym-press flex min-h-[56px] w-full items-center justify-between gap-3 rounded-[20px] bg-card px-4 py-2.5 text-left active:bg-raise", className)}>
        <span className="min-w-0 text-[15px] text-fg">
          {shown ? (
            <>
              Check-in <span className="font-semibold">{fmtScore(checkinAverage(shown))}</span>
              <span className="text-fg-dim">/5</span>
            </>
          ) : skipped ? (
            <span className="text-fg-dim">Check-in skipped</span>
          ) : (
            <>
              <span className="font-semibold">Slept badly or drained?</span>
              <span className="block text-[13px] text-fg-dim">Check in and the app lightens today's session.</span>
            </>
          )}
        </span>
        <span className="shrink-0 text-[13px] font-semibold text-fg-dim">{shown ? "Edit" : "Check in"}</span>
      </button>
    );
  }

  const complete = METRICS.every((m) => draft[m.key] != null);

  return (
    <section className={cx("rounded-[20px] bg-card", className)} aria-label="Daily check-in">
      <div className="gym-label flex min-h-10 items-center justify-between px-4 pt-1">
        <span>Check-in</span>
        <span>1 to 5 · 20 s</span>
      </div>
      <div className="flex flex-col gap-3.5 px-4 pb-4 pt-1">
        {METRICS.map((m) => (
          <div key={m.key}>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <span className="text-[15px] font-semibold text-fg">{m.label}</span>
              <span className="text-[12px] text-fg-faint">
                1 {m.low} · 5 {m.high}
              </span>
            </div>
            <ChipGroup
              label={m.label}
              fill
              value={draft[m.key]}
              onChange={(v) => setDraft((d) => ({ ...d, [m.key]: v }))}
              options={SCORES.map((n) => ({
                value: n,
                label: n,
                ariaLabel: `${m.label} ${n}${n === 1 ? ` ${m.low}` : n === 5 ? ` ${m.high}` : ""}`,
              }))}
            />
          </div>
        ))}
        <div className="mt-1 flex gap-2">
          <Button
            variant="primary"
            size="lg"
            className="flex-1"
            disabled={!complete}
            onClick={() => {
              if (!complete) return;
              onSave(draft as CheckinScores);
              setSavedLocal(draft as CheckinScores);
              setOpen(false);
            }}
          >
            Save
          </Button>
          <Button
            variant="ghost"
            size="lg"
            onClick={() => {
              // Editing a saved check-in: close without changes. Otherwise this is a skip.
              if (shown) setDraft(shown);
              else onSkip();
              setOpen(false);
            }}
          >
            {shown ? "Close" : "Skip"}
          </Button>
        </div>
      </div>
    </section>
  );
}
