import { cx } from "../lib/cx";

export type SyncStatus = "idle" | "syncing" | "offline" | "auth_required" | "error";

const LABEL: Record<SyncStatus, string> = {
  idle: "Synced",
  syncing: "Syncing",
  offline: "Offline · saved here",
  auth_required: "Sign in to sync",
  error: "Sync paused",
};

// Calm by design: data is always safe locally. Only "sign in" asks for an action, so only it is orange.
const DOT: Record<SyncStatus, string> = {
  idle: "bg-fg-faint",
  syncing: "bg-fg gym-pulse",
  offline: "border border-fg-faint bg-transparent",
  auth_required: "bg-volt",
  error: "border border-fg-dim bg-transparent",
};

export interface SyncDotProps {
  status: SyncStatus;
  /** Override the short label. */
  label?: string;
  /** Hide the label visually (kept for screen readers). */
  compact?: boolean;
  /** Makes it a button, e.g. to sign in again or retry. */
  onClick?: () => void;
  className?: string;
}

export function SyncDot({ status, label, compact, onClick, className }: SyncDotProps) {
  const text = label ?? LABEL[status];
  const inner = (
    <>
      <span aria-hidden className={cx("h-2 w-2 shrink-0 rounded-full", DOT[status])} />
      <span className={cx("whitespace-nowrap text-[11px] uppercase tracking-[0.08em]", compact && "sr-only", status === "auth_required" ? "text-fg" : "text-fg-faint")}>
        {text}
      </span>
    </>
  );
  const base = cx("inline-flex items-center gap-2 px-2", className);
  return onClick ? (
    <button type="button" onClick={onClick} className={cx(base, "min-h-11 rounded-2xl active:bg-raise")} aria-label={text}>
      {inner}
    </button>
  ) : (
    <span role="status" className={cx(base, "min-h-6")}>
      {inner}
    </span>
  );
}
