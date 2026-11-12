import type { Adjustment } from "@gym/engine";
import { cx } from "../lib/cx";
import { plain } from "../lib/plain";

/** What readiness (or another modifier) changed today. Plain facts, no diagnosis. */
export function AdjustmentBanner({ adjustments, className }: { adjustments: Adjustment[]; className?: string }) {
  if (!adjustments.length) return null;
  return (
    <div role="status" className={cx("rounded-2xl border border-line border-l-2 border-l-fg/70 bg-card px-4 py-3", className)}>
      <div className="text-[11px] uppercase tracking-[0.08em] text-fg-faint">Adjusted for today</div>
      <ul className="mt-1.5 flex list-none flex-col gap-1 p-0">
        {adjustments.map((a) => (
          <li key={`${a.rule_id}:${a.text}`} className="text-[14px] leading-snug text-fg">
            {plain(a.text)}
          </li>
        ))}
      </ul>
    </div>
  );
}
