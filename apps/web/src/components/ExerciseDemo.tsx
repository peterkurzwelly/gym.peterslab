import { useState } from "react";
import { cx } from "../lib/cx";
import { demoSrc } from "../lib/guides";
import { DumbbellIcon } from "./Icons";

export interface ExerciseDemoProps {
  exerciseId: string;
  name: string;
  /** Still thumbnail (start position only) instead of the two frame loop. */
  still?: boolean;
  className?: string;
}

/** Two photos of the movement, start and end position, cross fading. Falls back to a mark when there is no photo. */
export function ExerciseDemo({ exerciseId, name, still, className }: ExerciseDemoProps) {
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const failed = failedFor === exerciseId;

  if (failed) {
    return (
      <div className={cx("grid place-items-center bg-raise text-fg-faint", className)} role="img" aria-label={`${name}: no photo`}>
        <DumbbellIcon size={still ? 22 : 40} />
      </div>
    );
  }

  return (
    <div className={cx("gym-demo", still && "gym-demo-cover", className)} role="img" aria-label={`${name}: start and end position`}>
      <img src={demoSrc(exerciseId, 0)} alt="" decoding="async" draggable={false} onError={() => setFailedFor(exerciseId)} />
      {!still && <img src={demoSrc(exerciseId, 1)} alt="" loading="lazy" decoding="async" draggable={false} />}
    </div>
  );
}
