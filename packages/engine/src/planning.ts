/**
 * planSession: base target per track, then the ENGINE_RULES section 4 modifiers in order:
 * swaps, phase sets/RIR (or deload), short, travel, comeback, breaks, readiness, top set, session volume cap.
 */
import type { Decision, Exercise, Muscle, Phase, Prescription, SessionFlag } from "@gym/schema";
import type { Adjustment, AlternativeOption, PlanOptions, PlannedExercise, PlannedSet, SessionPlan } from "./types";
import type { Analysis } from "./analysis";
import type { Norm, Slot } from "./context";
import { incrementFor, isBodyweight, isMainLift, resolveSlot } from "./context";
import { fractionalSets, roundLoad, weightFromE1rm } from "./calc";
import { initId, makeDecision, planId } from "./decisions";
import { phaseForWeek, setsRuleFor } from "./phases";
import { initialTarget, readinessScope, statsOut } from "./progression";
import { planModifiers, readinessBanner, readinessFor, shortBreakApplies, spacing } from "./events";
import { buildCardio } from "./cardio";
import { comebackText, fmtNum, fmtPct, numberWord, plural } from "./text";

interface Limitation {
  id: string;
  label: string;
  avoid_tags: string[];
  prefer_tags: string[];
}

function activeLimitations(n: Norm): Limitation[] {
  return n.settings.limitations.flatMap((id) => {
    const l = n.program.limitations[id];
    return l ? [{ id, label: l.label, avoid_tags: l.avoid_tags, prefer_tags: l.prefer_tags }] : [];
  });
}

function avoidHit(ex: Exercise, lims: Limitation[]): { label: string; tag: string } | null {
  for (const l of lims) {
    const tag = ex.tags.find((t) => l.avoid_tags.includes(t));
    if (tag) return { label: l.label, tag };
  }
  return null;
}

/** Limitation swap (swap.limitation): first allowed alternative with a prefer tag, else the first allowed one. */
function limitationSwap(n: Norm, p: Prescription, lims: Limitation[]): string | null {
  if (!lims.length) return null;
  const def = n.exercises[p.exercise_id];
  if (!def) return null;
  const allowed = p.alternatives.flatMap((a) => {
    const ex = n.exercises[a.exercise_id];
    return ex && !avoidHit(ex, lims) ? [ex] : [];
  });
  const has = (ex: Exercise, tags: string[]) => ex.tags.some((t) => tags.includes(t));
  const triggered = lims.filter(
    (l) =>
      has(def, l.avoid_tags) ||
      (l.prefer_tags.length > 0 && !has(def, l.prefer_tags) && allowed.some((ex) => has(ex, l.prefer_tags))),
  );
  if (!triggered.length) return null;
  const prefer = triggered.flatMap((l) => l.prefer_tags);
  const pick = allowed.find((ex) => has(ex, prefer)) ?? allowed[0];
  return pick?.id ?? null;
}

/** Effective exercise: session swap > block swap (never main lifts) > limitation swap > program default. */
export function effectiveExercise(
  n: Norm,
  p: Prescription,
  swaps: Record<string, string> | undefined,
  lims: Limitation[],
): { id: string; swapped: PlannedExercise["swapped"] } {
  const s = swaps?.[p.id];
  if (s && n.exercises[s]) return { id: s, swapped: s === p.exercise_id ? null : "session" };
  const b = n.settings.block_swaps[p.id];
  if (b && !isMainLift(n, p) && n.exercises[b]) return { id: b, swapped: b === p.exercise_id ? null : "block" };
  const l = limitationSwap(n, p, lims);
  if (l) return { id: l, swapped: "limitation" };
  return { id: p.exercise_id, swapped: null };
}

function alternativesFor(n: Norm, slot: Slot, effId: string, lims: Limitation[]): AlternativeOption[] {
  const p = slot.prescription;
  const ids = [p.exercise_id, ...p.alternatives.map((a) => a.exercise_id)].filter((id, i, arr) => id !== effId && arr.indexOf(id) === i);
  return ids.flatMap((id) => {
    const ex = n.exercises[id];
    if (!ex) return [];
    const alt = resolveSlot(slot.day, p, id, ex);
    const hit = avoidHit(ex, lims);
    return [
      {
        exercise_id: id,
        name: ex.name,
        rep_min: alt.rep_min,
        rep_max: alt.rep_max,
        measure: alt.measure,
        allowed: !hit,
        reason: hit ? `${hit.label}: avoids ${hit.tag.replace(/_/g, " ")}.` : null,
      },
    ];
  });
}

export function phaseSets(n: Norm, p: Prescription, phase: Phase, tw: number): number {
  const rule = setsRuleFor(phase, tw);
  if (!rule) return p.sets;
  if (isMainLift(n, p)) return rule.main_lift;
  if (p.starred) return rule.starred;
  return rule.other_cap != null ? Math.min(p.sets, rule.other_cap) : p.sets;
}

export function deloadSets(n: Norm, p: Prescription, tw: number): number {
  const d = n.config.deload;
  const base = n.program.phases.find((ph) => ph.name === d.sets_base_phase);
  const raw = (base ? phaseSets(n, p, base, tw) : p.sets) * d.sets_factor;
  const r = d.sets_rounding === "ceil" ? Math.ceil(raw - 1e-9) : d.sets_rounding === "floor" ? Math.floor(raw + 1e-9) : Math.round(raw);
  return Math.max(d.min_sets, r);
}

/** Remove `drop` sets but never go below `min` (or below the current count when it is already lower). */
function reduceSets(sets: number, drop: number, min: number): number {
  return Math.max(Math.min(sets, min), sets - drop);
}

interface Draft {
  p: Prescription;
  ex: Exercise;
  slot: Slot;
  swapped: PlannedExercise["swapped"];
  main: boolean;
  inc: number;
  weight: number | null;
  reps: number;
  rir: number;
  calibration: boolean;
  work: number;
  top: { weight: number; reps: number; rir: number } | null;
  base: Decision;
  override: string | null;
  cut: boolean;
}

export function buildPlan(an: Analysis, opts: PlanOptions): SessionPlan {
  const { n, wc, rp } = an;
  let code = opts.code;
  let mode = opts.mode;
  if (code === "TRAVEL" || mode === "travel") {
    code = "TRAVEL";
    mode = "travel";
  }
  const date = n.today;
  const tw = wc.current.tw;
  const phase = phaseForWeek(n.program, n.config, tw, rp.deloadWeeks);
  const deload = phase.name === "deload";
  const rc = readinessFor(n, date);
  const readiness = rc?.adjusted ? rc : null;
  const planDecisions = new Map<string, Decision>();
  const addPlan = (rule_id: string, explanation: string, inputs: Record<string, unknown> = {}, output: Record<string, unknown> = {}) => {
    const id = planId(date, code, rule_id);
    if (!planDecisions.has(id)) {
      planDecisions.set(id, makeDecision(n, { id, date: n.atIso, rule_id, session_id: opts.sessionId ?? null, inputs, output, explanation }));
    }
    return id;
  };

  if (code === "CARDIO") {
    const { plan: cp, decision } = buildCardio(an);
    planDecisions.set(decision.id, decision);
    const flags: SessionFlag[] = [];
    if (deload) flags.push("deload");
    if (cp.rule_id === "cardio.readiness_swap") flags.push("readiness");
    return {
      code,
      name: n.program.cardio.name,
      mode,
      flags,
      training_week: tw,
      phase: phase.name,
      phase_label: phase.label,
      est_minutes: Math.round(cp.total_min),
      exercises: [],
      adjustments: cp.kind === "easy" && cp.rule_id !== "cardio.easy" ? [{ rule_id: cp.rule_id, text: cp.reason }] : [],
      warnings: cp.warnings,
      decisions: [...planDecisions.values()],
      rounds: null,
    };
  }

  const day = n.dayByCode.get(code);
  const mods = planModifiers(an);
  const comeback = mods.comeback || mode === "comeback";
  // A comeback started by hand (mode comeback) overrides the short break the same way a detected one does.
  const breakResume = shortBreakApplies(n, mods.rawShortBreak, comeback, mods.longBreak);
  const short = mode === "short";
  const lims = activeLimitations(n);
  const cfg = n.config;
  const prescriptions = [...(day?.prescriptions ?? [])].sort((a, b) => a.order - b.order).filter((p) => !short || p.starred);
  const scope = new Set(readinessScope(n, code, mode));

  const drafts: Draft[] = [];
  for (const p of prescriptions) {
    let eff = effectiveExercise(n, p, opts.swaps, lims);
    if (!n.exercises[eff.id]) eff = { id: p.exercise_id, swapped: null };
    const ex = n.exercises[eff.id];
    if (!ex || !day) continue;
    const slot = resolveSlot(day, p, ex.id, ex);
    const inc = incrementFor(n, ex);
    const track = rp.tracks.get(slot.key);
    const main = isMainLift(n, p);

    let weight: number | null;
    let reps: number;
    let rir = phase.rir_min;
    let calibration = false;
    let base: Decision | undefined;
    if (track?.last_decision_id) base = rp.decisionById.get(track.last_decision_id);
    if (track && base) {
      weight = track.base_weight;
      reps = track.base_reps;
    } else {
      const init = initialTarget(n, slot, ex, tw, phase, rp.stats.get(ex.id));
      weight = init.weight;
      reps = init.reps;
      rir = init.rir;
      calibration = init.calibration;
      base = makeDecision(n, {
        id: initId(slot.key),
        date: n.atIso,
        rule_id: init.rule_id,
        session_id: opts.sessionId ?? null,
        exercise_id: ex.id,
        inputs: init.inputs,
        output: { weight, reps, rir },
        explanation: init.explanation,
      });
    }

    // Sets: travel rounds, deload rule, or phase rule; then short and comeback reductions.
    let work = code === "TRAVEL" ? (day.rounds ?? p.sets) : deload ? deloadSets(n, p, tw) : phaseSets(n, p, phase, tw);
    if (short) work = reduceSets(work, cfg.short_version.set_reduction, cfg.short_version.min_sets);
    if (comeback) work = reduceSets(work, cfg.comeback.set_reduction, cfg.comeback.min_sets);

    let override: string | null = deload ? "phase.deload" : null;
    if (weight != null && weight > 0 && (mods.longBreak || breakResume)) {
      const pct = mods.longBreak ? cfg.break.long_load_pct : cfg.break.short_load_pct;
      weight = roundLoad(weight * pct, inc, "down");
      override ??= mods.longBreak ? "event.break_long" : "event.break_short";
    }

    let cut = false;
    if (readiness) {
      work = reduceSets(work, readiness.sets_drop, cfg.readiness.min_sets);
      if (scope.has(p.id) && weight != null && weight > 0 && readiness.load_cut_pct > 0) {
        weight = roundLoad(weight * (1 - readiness.load_cut_pct), inc, "down");
        cut = true;
        override ??= "event.readiness";
      }
    }

    let top: Draft["top"] = null;
    const known = rp.stats.get(ex.id)?.e1rm ?? null;
    if (phase.top_set?.main_lifts && main && slot.measure === "reps" && known != null) {
      const topRir = phase.top_set.rir;
      top = { weight: roundLoad(weightFromE1rm(known, slot.rep_min, topRir, cfg.e1rm.divisor), inc, "down"), reps: slot.rep_min, rir: topRir };
    }

    drafts.push({ p, ex, slot, swapped: eff.swapped, main, inc, weight, reps, rir, calibration, work, top, base, override, cut });
  }

  // Session volume cap: trim non starred (last first), then starred non main, never below 1 set.
  const cap = cfg.volume.session_cap;
  const tracked = cfg.volume.tracked_muscles;
  const fracs = new Map(drafts.map((d) => [d, fractionalSets(d.ex, cfg)]));
  const load = (): Partial<Record<Muscle, number>> => {
    const out: Partial<Record<Muscle, number>> = {};
    for (const d of drafts) {
      const total = d.work + (d.top ? 1 : 0);
      for (const [m, v] of Object.entries(fracs.get(d) ?? {})) out[m as Muscle] = (out[m as Muscle] ?? 0) + v * total;
    }
    return out;
  };
  const candidates = [...drafts.filter((d) => !d.p.starred).reverse(), ...drafts.filter((d) => d.p.starred && !d.main).reverse()];
  let trimmed = 0;
  const trimmedFrom = new Set<string>();
  for (let guard = 0; guard < 200; guard++) {
    const l = load();
    const over = tracked.filter((m) => (l[m] ?? 0) > cap + 1e-9);
    if (!over.length) break;
    const c = candidates.find((d) => d.work > 1 && over.some((m) => (fracs.get(d)?.[m] ?? 0) > 0));
    if (!c) break;
    c.work -= 1;
    trimmed += 1;
    trimmedFrom.add(c.ex.name);
  }

  // Plan level decisions and banner lines, in modifier order.
  const adjustments: Adjustment[] = [];
  const flags: SessionFlag[] = [];
  const adjust = (rule_id: string, text: string, inputs: Record<string, unknown> = {}, output: Record<string, unknown> = {}) => {
    addPlan(rule_id, text, inputs, output);
    adjustments.push({ rule_id, text });
  };
  if (deload) {
    const f = cfg.deload.sets_factor;
    const setsText = f === 0.5 ? "half the sets" : `${fmtPct(f)}% of the sets`;
    adjust("phase.deload", `Deload week: ${setsText}, same weights, RIR ${phase.rir_min} to ${phase.rir_max}.`, { training_week: tw }, { sets_factor: f });
    flags.push("deload");
  }
  if (short) {
    const red = cfg.short_version.set_reduction;
    const mins = day?.short_minutes;
    addPlan("mode.short", `${mins ? `★ ${mins} min version` : "Short version"}: starred exercises only, ${numberWord(red)} set${red === 1 ? "" : "s"} less.`);
  }
  if (code === "TRAVEL") {
    const rounds = day?.rounds ?? null;
    addPlan("mode.travel", `Travel version: ${rounds ? plural(rounds, "round") : "one circuit"}.${n.program.travel.counts_toward_floor ? " It counts toward the floor." : ""}`);
  }
  if (comeback) {
    const red = cfg.comeback.set_reduction;
    adjust("event.comeback", comebackText(red, mods.longBreak || breakResume), { detected: mods.comeback, mode });
    flags.push("comeback");
  }
  if (mods.longBreak) {
    const b = cfg.break;
    const text = mods.restart
      ? `Back after ${mods.gapDays} days: restarting at week ${b.long_restart_week} of the return phase, weights at ${fmtPct(b.long_load_pct)}% today.`
      : `Back after ${mods.gapDays} days: weights at ${fmtPct(b.long_load_pct)}% today.`;
    adjust("event.break_long", text, { gap_days: mods.gapDays }, { load_pct: b.long_load_pct });
    flags.push("long_break_restart");
  } else if (breakResume) {
    const b = cfg.break;
    const text =
      mods.gapDays != null && mods.gapDays >= b.short_days_min
        ? `Back after ${mods.gapDays} days: weights at ${fmtPct(b.short_load_pct)}% this week.`
        : `Easing back in after a break: weights at ${fmtPct(b.short_load_pct)}% this week.`;
    adjust("event.break_short", text, { gap_days: mods.gapDays, window_end: rp.breakWindowEnd }, { load_pct: b.short_load_pct });
    flags.push("break_resume");
  }
  if (readiness) {
    const scopeKind = cfg.readiness.load_cut.scope;
    const cutDraft = drafts.find((d) => d.cut);
    const label = !cutDraft ? null : scopeKind === "first_exercise" ? cutDraft.ex.name : scopeKind === "main_lifts" ? "Main lifts" : "All lifts";
    const banner = readinessBanner(readiness, label);
    adjust(
      "event.readiness",
      banner,
      { checkin_id: readiness.checkin.id, average: readiness.average, lowest: readiness.lowest },
      { sets_drop: readiness.sets_drop, load_cut_pct: readiness.load_cut_pct, scope: scopeKind },
    );
    flags.push("readiness");
  }
  if (drafts.some((d) => d.top)) {
    adjust("phase.top_set", `${phase.label}: one top set at RIR ${phase.top_set?.rir ?? 0} on each main lift to see your progress.`);
    flags.push("consolidate_top_set");
  }
  if (trimmed > 0) {
    adjust("volume.session_cap", `Session cap: ${plural(trimmed, "set")} trimmed from ${[...trimmedFrom].join(", ")} so no muscle passes ${fmtNum(cap)} sets.`, {}, { trimmed });
  }

  // Exercises, each with its reason decision.
  const exDecisions: Decision[] = [];
  const exercises: PlannedExercise[] = drafts.map((d) => {
    let decision = d.base;
    if (d.override) decision = planDecisions.get(planId(date, code, d.override)) ?? d.base;
    exDecisions.push(decision);
    const sets: PlannedSet[] = [];
    for (let i = 0; i < d.work; i++) sets.push({ index: i, weight: d.weight, reps: d.reps, rir: d.rir, kind: "work" });
    if (d.top) sets.push({ index: sets.length, weight: d.top.weight, reps: d.top.reps, rir: d.top.rir, kind: "top" });
    const track = rp.tracks.get(d.slot.key);
    const st = rp.stats.get(d.ex.id);
    const stalled = st ? statsOut(st, cfg.stall.exposures).stalled : false;
    return {
      prescription_id: d.p.id,
      exercise_id: d.ex.id,
      name: d.ex.name,
      primary_exercise_id: d.p.exercise_id,
      primary_name: n.exercises[d.p.exercise_id]?.name ?? d.p.exercise_id,
      swapped: d.swapped,
      starred: d.p.starred,
      main_lift: d.main,
      measure: d.slot.measure,
      per_side: d.slot.per_side,
      per_hand: d.ex.per_hand,
      bodyweight: isBodyweight(d.ex),
      progression_rule: d.slot.progression_rule,
      rep_min: d.slot.rep_min,
      rep_max: d.slot.rep_max,
      target_rir: d.rir,
      rir_range: [phase.rir_min, phase.rir_max],
      rest_s: n.settings.rest_overrides[d.ex.id] ?? n.settings.rest_overrides[d.p.id] ?? d.p.rest_s,
      superset_group: d.p.superset_group,
      increment_kg: d.inc,
      sets,
      calibration: d.calibration,
      reason: decision.explanation,
      rule_id: decision.rule_id,
      decision_id: decision.id,
      last_time: track?.last ?? null,
      pain_last_time: rp.lastPainByExercise.get(d.ex.id) ?? false,
      stalled,
      alternatives: alternativesFor(n, d.slot, d.ex.id, lims),
      note: d.p.note ?? null,
    };
  });

  const seen = new Set<string>();
  const decisions = [...exDecisions, ...planDecisions.values()].filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));

  return {
    code,
    name: day?.name ?? code,
    mode,
    flags,
    training_week: tw,
    phase: phase.name,
    phase_label: phase.label,
    est_minutes: short ? (day?.short_minutes ?? day?.est_minutes ?? 0) : (day?.est_minutes ?? 0),
    exercises,
    adjustments,
    warnings: spacing(an, code, "hard"),
    decisions,
    rounds: code === "TRAVEL" ? (day?.rounds ?? null) : null,
  };
}
