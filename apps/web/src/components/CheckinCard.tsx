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
  className?: string;
}

type Draft = Record<Metric, number | null>;
const empty: Draft = { sleep: null, soreness: null, stress: null, energy: null };

export function CheckinCard({ value, skipped, onSave, onSkip, className }: CheckinCardProps) {
  const [open, setOpen] = useState(!value && !skipped);
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
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cx("gym-press flex min-h-12 w-full items-center justify-between gap-3 rounded-[3px] border border-line bg-ink-2/50 px-4 text-left active:bg-ink-3", className)}
      >
        <span className="text-[14px] text-paper">
          {shown ? (
            <>
              Check-in <span className="font-semibold">{fmtScore(checkinAverage(shown))}</span>
              <span className="text-paper-dim">/5</span>
            </>
          ) : (
            <span className="text-paper-dim">Check-in skipped</span>
          )}
        </span>
        <span className="text-[12px] uppercase tracking-[0.12em] text-paper-faint">{shown ? "edit" : "add"}</span>
      </button>
    );
  }

  const complete = METRICS.every((m) => draft[m.key] != null);

  return (
    <section className={cx("rounded-[3px] border border-line bg-ink-2/50", className)} aria-label="Daily check-in">
      <div className="flex min-h-9 items-center justify-between border-b border-line/80 px-4 text-[11px] uppercase tracking-[0.14em] text-paper-faint">
        <span>Check-in</span>
        <span>1 to 5 · 20 s</span>
      </div>
      <div className="flex flex-col gap-3.5 p-4">
        {METRICS.map((m) => (
          <div key={m.key}>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <span className="text-[14px] text-paper">{m.label}</span>
              <span className="text-[11px] text-paper-faint">
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
