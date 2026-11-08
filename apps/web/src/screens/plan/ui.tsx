/**
 * Small presentational pieces shared by the Plan and Progress tabs.
 * Same drawing style as the UI kit: hairlines, ink surfaces, paper marks, green only when a floor or target is reached.
 */
import type { ReactNode, SVGProps } from "react";
import { cx } from "../../lib/cx";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 18, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={rest["aria-label"] ? undefined : true}
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const LockIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5.75" y="10.75" width="12.5" height="9" rx="1" />
    <path d="M8.5 10.75V8a3.5 3.5 0 017 0v2.75" />
  </Svg>
);

export const ArrowUpIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 19V5M6.5 10.5L12 5l5.5 5.5" />
  </Svg>
);

export const ArrowDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M6.5 13.5L12 19l5.5-5.5" />
  </Svg>
);

export const CalendarIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="5.5" width="16" height="14" rx="1" />
    <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
  </Svg>
);

export const ExternalIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13.5 5.5H18.5V10.5M18.5 5.5l-8 8M16 13.5v5H5.5V8h5" />
  </Svg>
);

export interface MeterProps {
  value: number;
  /** Scale end. Defaults to the larger of target / band max (+ headroom) and value. */
  max?: number;
  /** A single goal (cardio 1, WHO 150). */
  target?: number;
  /** A range goal (sets per muscle 8 to 10). Drawn as a bracket on the track. */
  band?: { min: number; max: number } | null;
  /** Green fill: the goal is reached. */
  reached?: boolean;
  className?: string;
  label: string;
}

/** Thin horizontal meter: track in ink, fill in paper (green once reached), goal as a tick or bracket. */
export function Meter({ value, max, target, band, reached, className, label }: MeterProps) {
  const goal = band ? band.max : (target ?? 0);
  const end = Math.max(max ?? goal * 1.2, value, 1);
  const pct = (n: number) => `${Math.min(100, Math.max(0, (n / end) * 100))}%`;
  return (
    <div className={cx("relative h-[14px]", className)} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={end} aria-valuenow={value}>
      <div className="absolute inset-x-0 top-[3px] h-[8px] rounded-full bg-ink-3" />
      {band && (
        <div
          aria-hidden
          className="absolute top-0 h-[14px] rounded-[2px] border-x border-paper-faint bg-paper/10"
          style={{ left: pct(band.min), width: `calc(${pct(band.max)} - ${pct(band.min)})` }}
        />
      )}
      {value > 0 && (
        <div
          aria-hidden
          className={cx("absolute left-0 top-[3px] h-[8px] rounded-full", reached ? "bg-go" : "bg-paper")}
          style={{ width: pct(value) }}
        />
      )}
      {!band && target != null && target > 0 && (
        <div aria-hidden className="absolute top-0 h-[14px] w-px bg-paper-dim" style={{ left: pct(target) }} />
      )}
    </div>
  );
}

/** Session pips: filled for done, hollow for still open, up to the target. Bonus shown as +n. */
export function Pips({ done, target, className, label }: { done: number; target: number; className?: string; label: string }) {
  const n = Math.max(target, 0);
  return (
    <span className={cx("inline-flex items-center gap-[3px]", className)} role="img" aria-label={label}>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={cx("h-[7px] w-[7px] rounded-full border", i < done ? "border-paper bg-paper" : "border-paper-faint/70")} />
      ))}
      {done > n && <span className="ml-0.5 text-[10px] leading-none text-paper-dim">+{done - n}</span>}
    </span>
  );
}

/** Caption label in the drawing-sheet style. */
export function Caption({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("text-[11px] uppercase tracking-[0.14em] text-paper-faint", className)}>{children}</div>;
}

/** Link styled like a kit Button (secondary / primary / ghost), for plain hrefs such as calendar links. */
export function LinkButton({
  href,
  children,
  variant = "secondary",
  className,
  onClick,
  icon,
  external,
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
  onClick?: () => void;
  icon?: ReactNode;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      onClick={onClick}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className={cx(
        "gym-press inline-flex min-h-11 select-none items-center justify-center gap-1.5 rounded-[3px] px-3 font-mono text-[12px] uppercase tracking-[0.08em] no-underline",
        "transition-[background-color,color,filter,transform] duration-100 motion-reduce:transition-none",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper",
        variant === "primary" && "bg-orange font-semibold text-ink active:brightness-90",
        variant === "secondary" && "border border-paper/35 text-paper active:bg-ink-3",
        variant === "ghost" && "text-paper-dim active:bg-ink-3/60 active:text-paper",
        className,
      )}
    >
      {icon}
      {children}
    </a>
  );
}

/** "9 Nov". */
export function shortDate(date: string): string {
  const [, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]}`;
}
