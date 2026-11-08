/** Decision construction with deterministic ids (see ENGINE_RULES "Decision ids"). */
import type { DayCode, Decision } from "@gym/schema";
import type { Norm } from "./context";

export interface DecisionArgs {
  id: string;
  date: string;
  rule_id: string;
  session_id?: string | null;
  exercise_id?: string | null;
  inputs?: Record<string, unknown>;
  output?: Record<string, unknown>;
  explanation: string;
}

export function makeDecision(n: Norm, a: DecisionArgs): Decision {
  return {
    id: a.id,
    date: a.date,
    rule_id: a.rule_id,
    engine_version: n.config.engine_version,
    session_id: a.session_id ?? null,
    exercise_id: a.exercise_id ?? null,
    inputs_snapshot: a.inputs ?? {},
    output: a.output ?? {},
    explanation: a.explanation,
    updated_at: a.date,
    deleted_at: null,
  };
}

const MAX_ID = 64; // schema Id max length

/** FNV-1a 32 bit, base 36. Deterministic and short. */
function hash36(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** Ids longer than the schema allows (long custom exercise ids) keep a readable prefix plus a hash of the full id. */
export function fitId(id: string): string {
  if (id.length <= MAX_ID) return id;
  const tail = `~${hash36(id)}`;
  return id.slice(0, MAX_ID - tail.length) + tail;
}

export const progressionId = (sessionId: string, track: string) => fitId(`d:${sessionId}:${track}`);
export const initId = (track: string) => fitId(`d:init:${track}`);
export const planId = (date: string, code: DayCode, ruleId: string) => fitId(`d:plan:${date}:${code}:${ruleId}`);
export const eventId = (ruleId: string, ref: string) => fitId(`d:event:${ruleId}:${ref}`);

/** Keep the first decision per id, in order. */
export function dedupeDecisions(lists: Decision[][]): Decision[] {
  const seen = new Set<string>();
  const out: Decision[] = [];
  for (const list of lists) {
    for (const d of list) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      out.push(d);
    }
  }
  return out;
}
