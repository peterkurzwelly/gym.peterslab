/** summarizeSession: what changed for next time and why, PRs, and the week state. */
import type { Decision } from "@gym/schema";
import type { SessionChange, SessionSummary } from "./types";
import type { Analysis } from "./analysis";
import { sessionKg } from "./volume";

export function summarize(an: Analysis, sessionId: string): SessionSummary {
  const { n, rp, wf } = an;
  const s = n.sessionById.get(sessionId);
  if (!s) throw new Error(`Session ${sessionId} not found in history`);

  const nameOf = (id: string) => n.exercises[id]?.name ?? id;
  const changes: SessionChange[] = (rp.results.get(sessionId) ?? []).map((r) => ({
    exercise_id: r.exercise_id,
    name: nameOf(r.exercise_id),
    rule_id: r.rule_id,
    decision_id: r.decision_id,
    from: r.from,
    to: r.to,
    explanation: r.summary,
  }));
  const prs = (rp.prs.get(sessionId) ?? []).map((p) => ({ exercise_id: p.exercise_id, name: nameOf(p.exercise_id), e1rm: p.e1rm, previous_best: p.previous_best }));

  const endMs = s.endedIso ? Date.parse(s.endedIso) : s.lastActivityMs;
  const week = wf.weeks[s.weekIndex] ?? wf.current;
  const decisions: Decision[] = rp.decisions.filter((d) => d.session_id === sessionId);

  return {
    session_id: sessionId,
    code: s.code,
    mode: s.s.mode,
    duration_min: Math.max(0, Math.round((endMs - s.startMs) / 60_000)),
    sets_logged: s.workSets.length,
    kg_lifted: sessionKg(s),
    changes,
    prs,
    week,
    decisions,
  };
}
