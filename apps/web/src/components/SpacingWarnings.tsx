import type { SpacingWarning } from "@gym/engine";
import { cx } from "../lib/cx";
import { Pill } from "./Pill";
import { plain } from "../lib/plain";

/** Spacing notes. They never block anything, so they read as information. */
export function SpacingWarnings({ warnings, className }: { warnings: SpacingWarning[]; className?: string }) {
  if (!warnings.length) return null;
  return (
    <div className={cx("flex flex-col gap-2", className)}>
      {warnings.map((w) => (
        <Pill key={`${w.rule_id}:${w.text}`}>{plain(w.text)}</Pill>
      ))}
    </div>
  );
}
