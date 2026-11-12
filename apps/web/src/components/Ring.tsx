import type { ReactNode } from "react";
import { cx } from "../lib/cx";

export interface RingProps {
  /** 0..1 (values above 1 are drawn as a full ring). */
  value: number;
  size?: number;
  stroke?: number;
  /** CSS color for the progress arc. */
  color?: string;
  children?: ReactNode;
  className?: string;
  label?: string;
}

/** Progress ring. The number it shows lives in `children`; `label` names it for screen readers. */
export function Ring({ value, size = 56, stroke = 6, color = "var(--color-volt)", children, className, label }: RingProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <div className={cx("relative grid shrink-0 place-items-center", className)} style={{ width: size, height: size }} role="img" aria-label={label ?? `${Math.round(v * 100)}%`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-raise-2)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          style={{ transition: "stroke-dashoffset 400ms var(--ease-out)" }}
        />
      </svg>
      <div className="relative">{children}</div>
    </div>
  );
}

/** Thin horizontal progress bar. */
export function Bar({ value, color = "var(--color-volt)", className }: { value: number; color?: string; className?: string }) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <div className={cx("h-1.5 overflow-hidden rounded-full bg-raise-2", className)} aria-hidden>
      <div className="h-full rounded-full" style={{ width: `${v * 100}%`, background: color, transition: "width 400ms var(--ease-out)" }} />
    </div>
  );
}
