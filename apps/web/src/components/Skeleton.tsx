import { cx } from "../lib/cx";

/** Loading placeholder. Shimmer is disabled under reduced motion (see styles.css). */
export function Skeleton({ className, height = 16, width = "100%", lines }: { className?: string; height?: number | string; width?: number | string; lines?: number }) {
  if (lines && lines > 1) {
    return (
      <div className={cx("flex flex-col gap-2", className)} aria-hidden>
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className="gym-skeleton rounded-lg" style={{ height, width: i === lines - 1 ? "60%" : width }} />
        ))}
      </div>
    );
  }
  return <div aria-hidden className={cx("gym-skeleton rounded-lg", className)} style={{ height, width }} />;
}
