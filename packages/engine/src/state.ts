/** computeState: everything the UI needs in one call, wired from one analysis pass. */
import type { Decision, StrengthDayCode } from "@gym/schema";
import type { EngineContext, EngineState, NextSession, SessionPlan } from "./types";
import type { Analysis } from "./analysis";
import { analyze, nextInLine, strengthToday } from "./analysis";
import { dedupeDecisions, makeDecision, planId } from "./decisions";
import { buildCardio } from "./cardio";
import { buildFlags, buildNudges, planModifiers, readinessFor, readinessResult, recommendVersion, spacing } from "./events";
import { buildPlan } from "./planning";
import { statsOut, trackOut } from "./progression";
import { totals, weekVolumes } from "./volume";
import { zeroWeekDecisions } from "./weeks";

export function buildNext(an: Analysis): { next: NextSession; decision: Decision } {
  const { n } = an;
  const nl = nextInLine(n);
  const day = n.dayByCode.get(nl.code);
  const plan = buildPlan(an, { code: nl.code, mode: "full" });
  const doneToday = strengthToday(n).length > 0;
  const name = `Session ${nl.code}`;
  const lineReason = nl.after == null ? "First session of the block" : `Next in line after ${nl.after === "TRAVEL" ? "the travel session" : nl.after}`;
  const reason = doneToday ? `Done for today. Next: ${name}, whenever it fits.` : lineReason;
  const rule_id = doneToday ? "plan.never_stack" : "plan.next_in_line";
  const decision = makeDecision(n, {
    id: planId(n.today, nl.code, rule_id),
    date: n.atIso,
    rule_id,
    inputs: { after: nl.after, session_order: n.settings.session_order },
    output: { code: nl.code, done_today: doneToday },
    explanation: reason,
  });
  const rec = recommendVersion(an, nl.code, doneToday);
  const extra = [decision];
  if (rec.rule_id && rec.reason) {
    extra.push(
      makeDecision(n, {
        id: planId(n.today, nl.code, rec.rule_id),
        date: n.atIso,
        rule_id: rec.rule_id,
        inputs: {
          floor_reached: an.wf.current.floor_reached,
          strength_done: an.wf.current.strength_done,
          week_killers: n.settings.week_killers,
          evening_hour: n.settings.evening_hour,
        },
        output: { recommended_mode: rec.mode },
        explanation: rec.reason,
      }),
    );
  }
  const withDecision: SessionPlan = { ...plan, decisions: [...plan.decisions, ...extra] };
  return {
    next: {
      code: nl.code as StrengthDayCode,
      name,
      est_minutes: day?.est_minutes ?? plan.est_minutes,
      short_minutes: day?.has_short_version ? (day.short_minutes ?? null) : null,
      reason,
      done_today: doneToday,
      plan: withDecision,
      recommended_mode: rec.mode,
      recommended_rule_id: rec.rule_id,
      recommended_reason: rec.reason,
    },
    decision,
  };
}

/** Everything the UI needs in one call. Pure and deterministic. */
export function computeState(ctx: EngineContext): EngineState {
  const an = analyze(ctx);
  const { n, rp, wf } = an;

  // Active session: started, not finished, not auto finished. Planned with itself excluded so targets stay frozen.
  const open = n.sessions.filter((s) => !s.finished);
  const activeS = open[open.length - 1];
  let active: EngineState["active"] = null;
  if (activeS) {
    const frozen = analyze(ctx, { at: activeS.s.started_at, excludeSessionId: activeS.id });
    const plan = buildPlan(frozen, { code: activeS.code, mode: activeS.s.mode, swaps: activeS.s.swaps, sessionId: activeS.id });
    active = { session: activeS.s, plan };
  }

  const { next, decision: nextDecision } = buildNext(an);
  const { plan: cardio, decision: cardioDecision } = buildCardio(an);
  const rc = readinessFor(n, n.today);
  const readinessAdj = next.plan.adjustments.find((a) => a.rule_id === "event.readiness");
  const mods = planModifiers(an);
  const volume = weekVolumes(an);

  const tracks: EngineState["tracks"] = {};
  for (const [k, t] of [...rp.tracks].sort((a, b) => a[0].localeCompare(b[0]))) tracks[k] = trackOut(t);
  const stats: EngineState["stats"] = {};
  for (const [k, st] of [...rp.stats].sort((a, b) => a[0].localeCompare(b[0]))) stats[k] = statsOut(st, n.config.stall.exposures);

  const history = [...rp.decisions, ...zeroWeekDecisions(n, an.wc)].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const decisions = dedupeDecisions([history, active?.plan.decisions ?? [], next.plan.decisions, [nextDecision, cardioDecision]]);

  return {
    engine_version: n.config.engine_version,
    today: n.today,
    block: wf.block,
    streak: wf.streak,
    weeks: wf.weeks,
    current_week: wf.current,
    active,
    next,
    cardio,
    readiness: readinessResult(rc, readinessAdj?.text ?? null),
    nudges: buildNudges(an, next, mods),
    warnings: spacing(an, next.code, "hard"),
    flags: buildFlags(an, volume),
    tracks,
    stats,
    decisions,
    totals: totals(an),
    volume,
    auto_finished: n.sessions.filter((s) => s.autoFinished).map((s) => ({ session_id: s.id, ended_at: s.endedIso! })),
  };
}
