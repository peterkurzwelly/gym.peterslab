/** Cardio plan for the current training week: 4x4 protocol, deload easy, readiness swap, bonus easy. */
import type { CardioModality, CardioProtocol, Decision } from "@gym/schema";
import type { CardioPlan, CardioSegment } from "./types";
import type { Analysis } from "./analysis";
import { makeDecision, planId } from "./decisions";
import { phaseForWeek } from "./phases";
import { readinessCardioBanner, readinessFor, spacing } from "./events";
import { fmtNum } from "./text";

function protocolFor(protocols: CardioProtocol[], tw: number): CardioProtocol | undefined {
  const hit = protocols.find((p) => p.weeks[0] <= tw && tw <= p.weeks[1]);
  if (hit) return hit;
  const sorted = [...protocols].sort((a, b) => a.weeks[0] - b.weeks[0]);
  if (sorted[0] && tw < sorted[0].weeks[0]) return sorted[0];
  return sorted[sorted.length - 1];
}

export function modalityOptions(setting: "bike" | "rower" | "both"): CardioModality[] {
  return setting === "both" ? ["bike", "rower"] : [setting];
}

function easyPlan(minutes: number): Pick<CardioPlan, "kind" | "intervals" | "warmup_min" | "cooldown_min" | "total_min" | "hard_minutes" | "segments"> {
  return {
    kind: "easy",
    intervals: null,
    warmup_min: 0,
    cooldown_min: 0,
    total_min: minutes,
    hard_minutes: 0,
    segments: [{ label: "Easy", kind: "easy", seconds: Math.round(minutes * 60) }],
  };
}

export function buildCardio(an: Analysis): { plan: CardioPlan; decision: Decision } {
  const { n, wc, wf, rp } = an;
  const c = n.program.cardio;
  const tw = wc.current.tw;
  const phase = phaseForWeek(n.program, n.config, tw, rp.deloadWeeks);
  const rc = readinessFor(n, n.today);
  const counts_as: CardioPlan["counts_as"] = wf.current.cardio_done >= n.config.week.cardio_target ? "bonus" : "target";
  const modality_options = modalityOptions(n.settings.interval_modality);

  let body: Pick<CardioPlan, "kind" | "intervals" | "warmup_min" | "cooldown_min" | "total_min" | "hard_minutes" | "segments">;
  let rule_id: string;
  let reason: string;
  const proto = protocolFor(c.protocols, tw);

  if (phase.name === "deload") {
    body = easyPlan(c.deload_easy_min);
    rule_id = "cardio.deload";
    reason = `Deload week: ${fmtNum(c.deload_easy_min)} min easy, conversation pace.`;
  } else if (rc?.adjusted) {
    const min = n.config.readiness.cardio_swap_easy_min;
    body = easyPlan(min);
    rule_id = "cardio.readiness_swap";
    reason = readinessCardioBanner(rc, min);
  } else if (counts_as === "bonus" || !proto) {
    body = easyPlan(c.deload_easy_min);
    rule_id = "cardio.easy";
    reason = counts_as === "bonus" ? `Cardio target done. An easy ${fmtNum(c.deload_easy_min)} min is a bonus.` : `${fmtNum(c.deload_easy_min)} min easy.`;
  } else {
    const segments: CardioSegment[] = [{ label: "Warm-up", kind: "warmup", seconds: Math.round(proto.warmup_min * 60) }];
    for (let i = 1; i <= proto.intervals; i++) {
      segments.push({ label: `Hard ${i}/${proto.intervals}`, kind: "hard", seconds: Math.round(proto.hard_min * 60) });
      segments.push({ label: `Easy ${i}/${proto.intervals}`, kind: "easy", seconds: Math.round(proto.easy_min * 60) });
    }
    segments.push({ label: "Cool-down", kind: "cooldown", seconds: Math.round(proto.cooldown_min * 60) });
    const total = proto.warmup_min + proto.intervals * (proto.hard_min + proto.easy_min) + proto.cooldown_min;
    body = {
      kind: "intervals",
      intervals: { count: proto.intervals, hard_min: proto.hard_min, easy_min: proto.easy_min },
      warmup_min: proto.warmup_min,
      cooldown_min: proto.cooldown_min,
      total_min: total,
      hard_minutes: proto.intervals * proto.hard_min,
      segments,
    };
    rule_id = "cardio.intervals";
    reason = `Week ${tw}: ${proto.intervals} × ${fmtNum(proto.hard_min)} min hard, ${fmtNum(proto.easy_min)} min easy between.`;
  }

  const plan: CardioPlan = {
    ...body,
    rule_id,
    reason,
    modality_options,
    hard_description: c.hard_description,
    counts_as,
    warnings: spacing(an, "CARDIO", body.kind === "intervals" ? "hard" : "easy"),
  };
  const decision = makeDecision(n, {
    id: planId(n.today, "CARDIO", rule_id),
    date: n.atIso,
    rule_id,
    inputs: { training_week: tw, phase: phase.name, readiness_avg: rc?.average ?? null, cardio_done: wf.current.cardio_done },
    output: { kind: plan.kind, total_min: plan.total_min, hard_minutes: plan.hard_minutes, counts_as },
    explanation: reason,
  });
  return { plan, decision };
}
