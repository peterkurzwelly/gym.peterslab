/** One pass over history: normalize → weeks → replay → finalized week states. Shared by every public function. */
import type { StrengthDayCode } from "@gym/schema";
import type { EngineContext } from "./types";
import type { AnalyzeOptions, NSession, Norm } from "./context";
import type { Replay } from "./progression";
import type { WeeksCalc, WeeksFinal } from "./weeks";
import { normalize } from "./context";
import { replay } from "./progression";
import { buildWeeks, finalizeWeeks } from "./weeks";

export interface Analysis {
  n: Norm;
  wc: WeeksCalc;
  rp: Replay;
  wf: WeeksFinal;
}

export function analyze(ctx: EngineContext, opts: AnalyzeOptions = {}): Analysis {
  const n = normalize(ctx, opts);
  const wc = buildWeeks(n);
  const rp = replay(n, wc);
  const wf = finalizeWeeks(n, wc, rp.deloadWeeks, rp.reactiveWeeks);
  return { n, wc, rp, wf };
}

export interface NextInLine {
  code: StrengthDayCode;
  /** Code of the session that set the rotation, null without history. */
  after: StrengthDayCode | "TRAVEL" | null;
}

/** Rotation from settings.session_order (falls back to program.rotation). */
export function rotationOf(n: Norm): StrengthDayCode[] {
  const valid = n.settings.session_order.filter((c) => n.dayByCode.has(c));
  return valid.length ? valid : n.program.rotation;
}

/** Next strength session in line: the code after the last qualifying A/B/C (travel only when it advances the rotation). */
export function nextInLine(n: Norm): NextInLine {
  const rotation = rotationOf(n);
  let idx = 0;
  let after: NextInLine["after"] = null;
  for (const s of n.qualifying) {
    if (s.kind === "strength") {
      const i = rotation.indexOf(s.code as StrengthDayCode);
      if (i >= 0) {
        idx = (i + 1) % rotation.length;
        after = s.code as StrengthDayCode;
      }
    } else if (s.kind === "travel" && n.program.travel.advances_rotation) {
      idx = (idx + 1) % rotation.length;
      after = "TRAVEL";
    }
  }
  return { code: rotation[idx] ?? rotation[0]!, after };
}

/** Qualifying strength sessions dated today. */
export function strengthToday(n: Norm): NSession[] {
  return n.qualifying.filter((s) => s.strengthLike && s.date === n.today);
}
