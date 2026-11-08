import type { SessionMode } from "@gym/schema";
import type { ReactNode } from "react";
import { cx } from "../lib/cx";

export interface ModeBarProps {
  mode: SessionMode;
  /** Swap mode shows a swap button on every exercise card. */
  swapping: boolean;
  onModeChange: (mode: SessionMode) => void;
  onSwappingChange: (on: boolean) => void;
  shortAvailable?: boolean;
  travelAvailable?: boolean;
  className?: string;
}

function ModeButton({ on, onClick, top, bottom, disabled }: { on: boolean; onClick: () => void; top: ReactNode; bottom: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "gym-press flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-[3px] border px-1 transition-colors duration-100 motion-reduce:transition-none disabled:opacity-35",
        on ? "border-paper bg-paper text-ink" : "border-line text-paper active:bg-ink-3",
      )}
    >
      <span className="text-[14px] font-medium leading-tight">{top}</span>
      <span className={cx("text-[10px] uppercase leading-tight tracking-[0.14em]", on ? "text-ink/70" : "text-paper-faint")}>{bottom}</span>
    </button>
  );
}

/** ★ 30 min version · Travel version · Swap exercise. Toggling a mode off returns to the full session. */
export function ModeBar({ mode, swapping, onModeChange, onSwappingChange, shortAvailable = true, travelAvailable = true, className }: ModeBarProps) {
  return (
    <div className={cx("flex gap-2", className)} role="group" aria-label="Session options">
      <ModeButton on={mode === "short"} disabled={!shortAvailable} onClick={() => onModeChange(mode === "short" ? "full" : "short")} top="★ 30 min" bottom="version" />
      <ModeButton on={mode === "travel"} disabled={!travelAvailable} onClick={() => onModeChange(mode === "travel" ? "full" : "travel")} top="Travel" bottom="version" />
      <ModeButton on={swapping} onClick={() => onSwappingChange(!swapping)} top="Swap" bottom="exercise" />
    </div>
  );
}
