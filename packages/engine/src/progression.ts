/**
 * Chronological replay of history. Finished, progression eligible exposures update each track
 * (exercise + rep range) by double progression / reps_only / none, e1RM stats per exercise,
 * and reactive deload is evaluated after every finished session.
 */
import type { DayCode, Decision, Exercise, Phase, SessionMode } from "@gym/schema";
import type { E1rmPoint, Flag, LastTime, TrackState } from "./types";
import type { NSession, NSet, Norm, Slot } from "./context";
import type { WeeksCalc } from "./weeks";
import { checkinAverage, incrementFor, isBodyweight, isMainLift } from "./context";
import { addDays, daysBetween } from "./dates";
import { clamp, e1rm, lerpClamped, round2, roundLoad, weightFromE1rm } from "./calc";
import { eventId, makeDecision, progressionId } from "./decisions";
import { phaseForWeek, plannedDeloadWeeks } from "./phases";
import { lastZeroWeekBefore } from "./weeks";
import { amount, fmtNum, fmtPct, signedKg, timesWord } from "./text";

export interface TrackInternal extends TrackState {
  belowHistory: boolean[];
  allBelowHistory: boolean[];
  pain_last: boolean;
}

export interface StatsInternal {
  exercise_id: string;
  history: E1rmPoint[];
  e1rm: number | null;
  best: number | null;
  bestIdx: number;
  first: number | null;
}

export interface SessionInfo {
  tw: number | null;
  phase: Phase | null;
  gapDays: number | null;
  deload: boolean;
  comeback: boolean;
  breakResume: boolean;
  longBreakFirst: boolean;
  /** Exercise ids whose load the readiness rule cut in this session. */
  readinessCut: Set<string>;
  holdRule: string | null;
}

export interface ExposureResult {
  session_id: string;
  track: string;
  exercise_id: string;
  prescription_id: string | null;
  rule_id: string;
  decision_id: string;
  from: { weight: number | null; reps: number } | null;
  to: { weight: number | null; reps: number } | null;
  summary: string;
  eligible: boolean;
}

export interface PrInfo {
  exercise_id: string;
  e1rm: number;
  previous_best: number | null;
}

export interface Replay {
  tracks: Map<string, TrackInternal>;
  stats: Map<string, StatsInternal>;
  decisions: Decision[];
  decisionById: Map<string, Decision>;
  results: Map<string, ExposureResult[]>;
  prs: Map<string, PrInfo[]>;
  infos: Map<string, SessionInfo>;
  deloadWeeks: Set<number>;
  reactiveWeeks: number[];
  flags: Flag[];
  lastPainByExercise: Map<string, boolean>;
  /** Last day (inclusive) of the latest short break window. */
  breakWindowEnd: string | null;
  lastQualifying: NSession | null;
  lastStrengthLike: NSession | null;
}

export interface Target {
  weight: number | null;
  reps: number;
  rir: number;
  calibration: boolean;
  rule_id: string;
  explanation: string;
  inputs: Record<string, unknown>;
}

/** Target for the first exposure of a track (calib.remembered / calib.bodyweight / calib.e1rm_map / calib.pick). */
export function initialTarget(n: Norm, slot: Slot, exercise: Exercise, tw: number, phase: Phase, stats: StatsInternal | undefined): Target {
  const cal = n.config.calibration;
  const inc = incrementFor(n, exercise);
  const firstReps = cal.first_exposure_target === "rep_min" ? slot.rep_min : slot.rep_max;
  const rir = phase.rir_min;
  const inputs: Record<string, unknown> = { track: slot.key, rep_min: slot.rep_min, rep_max: slot.rep_max, training_week: tw, phase: phase.name };
  const rem = n.settings.remembered_weights[exercise.id];
  if (rem) {
    const pct = clamp(n.settings.start_pct, cal.start_pct_min, cal.start_pct_max);
    const weight = roundLoad(rem.weight * pct, inc, "nearest");
    return {
      weight,
      reps: firstReps,
      rir,
      calibration: false,
      rule_id: "calib.remembered",
      explanation: `Week ${tw}: ${fmtPct(pct)}% of your remembered ${fmtNum(rem.weight)} kg × ${rem.reps}. It should feel light.`,
      inputs: { ...inputs, remembered: rem, start_pct: pct, increment_kg: inc },
    };
  }
  if (isBodyweight(exercise)) {
    return {
      weight: 0,
      reps: firstReps,
      rir,
      calibration: false,
      rule_id: "calib.bodyweight",
      explanation: `Bodyweight to start: aim for ${amount(firstReps, slot.measure)}.`,
      inputs,
    };
  }
  const known = stats?.e1rm ?? null;
  if (known != null && slot.measure === "reps") {
    const weight = roundLoad(weightFromE1rm(known, firstReps, rir, n.config.e1rm.divisor), inc, "down");
    return {
      weight,
      reps: firstReps,
      rir,
      calibration: false,
      rule_id: "calib.e1rm_map",
      explanation: `From your ${fmtNum(known)} kg e1RM: ${fmtNum(weight)} kg × ${firstReps} at RIR ${rir}.`,
      inputs: { ...inputs, e1rm: known, increment_kg: inc },
    };
  }
  const reps = clamp(cal.calibration_reps, slot.rep_min, slot.rep_max);
  const pickRir = Math.max(rir, cal.calibration_min_rir);
  let explanation = `No history yet: pick a weight you could lift about ${reps} times with ${pickRir} or more reps left.`;
  if (slot.measure === "seconds") explanation = `No history yet: pick a weight you can hold for ${reps} s with room to spare.`;
  if (slot.measure === "meters") explanation = `No history yet: pick a weight you can carry ${reps} m with room to spare.`;
  return { weight: null, reps, rir: pickRir, calibration: true, rule_id: "calib.pick", explanation, inputs };
}

interface EvalOut {
  rule_id: string;
  weight: number;
  reps: number;
  below: boolean;
  allBelow: boolean;
  explanation: string;
  summary: string;
  inputs: Record<string, unknown>;
}

interface EvalIn {
  slot: Slot;
  exercise: Exercise;
  sets: NSet[];
  pain: boolean;
  targetRir: number;
  largeJumps: boolean;
  phaseName: string;
  track: TrackInternal;
  baseReps: number;
}

/** One exposure of a track → next base (first matching rule wins, ENGINE_RULES section 3). */
function evaluate(n: Norm, ev: EvalIn): EvalOut {
  const cfg = n.config.progression;
  const { slot, exercise, sets, targetRir, track } = ev;
  const inc = incrementFor(n, exercise);
  const step = exercise.step_kg;
  const name = exercise.name;
  const count = sets.length;
  const load = Math.max(...sets.map((x) => x.log.weight));
  const { rep_min: repMin, rep_max: repMax, measure } = slot;
  const belowCount = sets.filter((x) => x.log.reps < repMin).length;
  const below = belowCount >= Math.min(cfg.below_range_min_sets, count);
  const allBelow = belowCount === count;
  const atLoad = (x: NSet) => x.log.weight >= load - 1e-9;
  const rirOk = (x: NSet) => x.log.rir == null || x.log.rir >= targetRir;
  const allTop = sets.every((x) => atLoad(x) && x.log.reps >= repMax);
  const allRir = sets.every(rirOk);
  const holdReps = cfg.hold_target === "rep_min" ? repMin : repMax;
  const afterInc = cfg.after_increase_target === "rep_min" ? repMin : repMax;

  const minStep = roundLoad(load + step, inc, "up");
  const capIncrease = (w: number) => Math.min(w, Math.max(roundLoad(load * (1 + cfg.max_jump_pct), inc, "down"), minStep));

  const inputs: Record<string, unknown> = {
    track: slot.key,
    rep_min: repMin,
    rep_max: repMax,
    measure,
    progression_rule: slot.progression_rule,
    load,
    sets: sets.map((x) => ({ weight: x.log.weight, reps: x.log.reps, rir: x.log.rir })),
    target_rir: targetRir,
    phase: ev.phaseName,
    large_jumps: ev.largeJumps,
    step_kg: step,
    increment_kg: inc,
    below_streak_before: track.below_range_streak,
  };
  const out = (rule_id: string, weight: number, reps: number, explanation: string, summary: string): EvalOut => ({
    rule_id,
    weight: round2(weight),
    reps,
    below,
    allBelow,
    explanation,
    summary,
    inputs,
  });

  if (slot.progression_rule === "none") {
    const topReps = Math.max(...sets.filter(atLoad).map((x) => x.log.reps));
    return out("none.log", load, topReps, "Log only.", `${name}: logged.`);
  }
  if (ev.pain) {
    return out("dp.pain", load, ev.baseReps, "Pain logged: no load increase, swap suggested.", `${name}: pain logged, no increase. Try an alternative next time.`);
  }

  if (slot.progression_rule === "reps_only") {
    if (below) return out("ro.below_range", load, holdReps, "Below range: hold here, check fatigue, rest and technique.", `${name}: below range, same target. Check sleep, rest and technique.`);
    if (allTop) return out("ro.top", load, repMax, "Top of range: add load or pick a harder variation.", `${name}: top of range. Add load or pick a harder variation.`);
    return out("ro.add_reps", load, holdReps, "Within range: add reps.", `${name}: aim for ${amount(holdReps, measure)} on every set.`);
  }

  // Double progression.
  const reset = n.config.progression.reset;
  const needBefore = reset.consecutive_below - 1;
  if (below && track.below_range_streak >= needBefore) {
    const prevAll = needBefore > 0 ? track.allBelowHistory.slice(-needBefore) : [];
    const everyBelow = allBelow && prevAll.length >= needBefore && prevAll.every(Boolean);
    const pct = everyBelow ? reset.pct_max : reset.pct_min;
    const w = roundLoad(load * (1 - pct), inc, "down");
    inputs.reset_pct = pct;
    return out(
      "dp.reset",
      w,
      repMin,
      `Missed range ${timesWord(reset.consecutive_below)}: reset load −${fmtPct(pct)}% to ${fmtNum(w)} kg.`,
      `${name} −${fmtPct(pct)}%: reset to ${fmtNum(w)} kg after ${reset.consecutive_below} sessions below range.`,
    );
  }
  if (below) {
    return out("dp.below_range", load, holdReps, "Below range: hold load, check fatigue, rest and technique.", `${name}: below range, same weight. Check sleep, rest and technique.`);
  }

  const lj = cfg.large_jump;
  const allOver = sets.every((x) => atLoad(x) && x.log.reps >= repMax + lj.all_sets_min_over);
  const shareOver = sets.filter((x) => atLoad(x) && x.log.reps >= repMax + lj.reps_over).length / count;
  if (ev.largeJumps && allRir && allOver && shareOver >= lj.share_sets_over - 1e-9) {
    const avgExtra = sets.reduce((a, x) => a + (x.log.reps - repMax), 0) / count;
    const pct = lerpClamped(avgExtra, lj.reps_over, lj.pct_min, lj.reps_over_for_max, lj.pct_max);
    const raw = Math.max(roundLoad(load * (1 + pct), inc, "up"), minStep);
    const w = capIncrease(raw);
    inputs.avg_extra = round2(avgExtra);
    inputs.jump_pct = round2(pct * 10000) / 10000;
    return out(
      "dp.large_jump",
      w,
      afterInc,
      `Beat range by ${lj.reps_over}+ reps in ${ev.phaseName} phase: larger jump to ${fmtNum(w)} kg.`,
      `${name} ${signedKg(w - load)}: beat the range by ${lj.reps_over}+ reps, larger jump to ${fmtNum(w)} kg.`,
    );
  }
  if (allTop && allRir) {
    const w = capIncrease(minStep);
    return out(
      "dp.increase",
      w,
      afterInc,
      `All sets hit top of range at RIR ${targetRir}: ${signedKg(w - load)}.`,
      `${name} ${signedKg(w - load)}: all sets hit ${amount(repMax, measure)} at RIR ${targetRir}.`,
    );
  }
  if (allTop) {
    return out("dp.hold_rir", load, repMax, "Top of range but harder than planned: same load.", `${name}: top of range but harder than planned, same weight.`);
  }
  return out("dp.hold_add_reps", load, holdReps, "Within range: same load, add reps.", `${name}: same weight, aim for ${amount(holdReps, measure)} on every set.`);
}

const HOLD_TEXT: Record<string, string> = {
  "phase.deload_hold": "Deload session: no load change, same targets next time.",
  "event.comeback_hold": "First session back: same targets next time.",
  "event.break_hold": "Easing back in after a break: same targets next time.",
  "event.readiness_hold": "Lighter day after a low check-in: same targets next time.",
};

const REACTIVE_TEXT: Record<string, string> = {
  e1rm_drop: "e1RM dipped on your main lifts",
  missed_reps: "Below range two sessions running on several exercises",
  checkins: "Several low check-ins in a row",
};

/** Program prescriptions a readiness load cut applies to for a day and mode. */
export function readinessScope(n: Norm, code: DayCode, mode: SessionMode): string[] {
  const day = n.dayByCode.get(mode === "travel" ? "TRAVEL" : code);
  if (!day) return [];
  const ordered = [...day.prescriptions].sort((a, b) => a.order - b.order).filter((p) => mode !== "short" || p.starred);
  const scope = n.config.readiness.load_cut.scope;
  if (scope === "first_exercise") return ordered.slice(0, 1).map((p) => p.id);
  if (scope === "main_lifts") return ordered.filter((p) => isMainLift(n, p)).map((p) => p.id);
  return ordered.map((p) => p.id);
}

export function newTrack(n: Norm, slot: Slot): TrackInternal {
  const cal = n.config.calibration;
  return {
    key: slot.key,
    exercise_id: slot.exercise_id,
    rep_min: slot.rep_min,
    rep_max: slot.rep_max,
    base_weight: null,
    base_reps: cal.first_exposure_target === "rep_min" ? slot.rep_min : slot.rep_max,
    exposures: 0,
    below_range_streak: 0,
    last_rule_id: null,
    last_decision_id: null,
    last: null,
    belowHistory: [],
    allBelowHistory: [],
    pain_last: false,
  };
}

export function replay(n: Norm, wc: WeeksCalc): Replay {
  const { config, program } = n;
  const cfgB = config.break;
  const rd = config.reactive_deload;
  const div = config.e1rm.divisor;
  const firstPhase = phaseForWeek(program, config, 1, new Set());

  const tracks = new Map<string, TrackInternal>();
  const stats = new Map<string, StatsInternal>();
  const decisions: Decision[] = [];
  const decisionById = new Map<string, Decision>();
  const results = new Map<string, ExposureResult[]>();
  const prs = new Map<string, PrInfo[]>();
  const infos = new Map<string, SessionInfo>();
  const deloadWeeks = plannedDeloadWeeks(program, config);
  const reactiveWeeks: number[] = [];
  const flags: Flag[] = [];
  const lastPainByExercise = new Map<string, boolean>();
  const criteriaWeeks = new Set<string>();
  const mainExercises = new Set<string>();
  for (const pid of program.main_lifts) {
    const p = n.presById.get(pid)?.p;
    if (p) mainExercises.add(p.exercise_id);
  }

  const push = (d: Decision) => {
    if (decisionById.has(d.id)) return;
    decisionById.set(d.id, d);
    decisions.push(d);
  };

  let lastQ: NSession | null = null;
  let lastStrength: NSession | null = null;
  let windowEnd: string | null = null;
  let deloadDone = false; // the planned deload week was already trained (e.g. before a long break restart)

  for (const s of n.sessions) {
    if (!s.qualifying) continue;
    const w = wc.weeks[s.weekIndex];
    const tw = w ? w.tw : null;
    const phase = tw != null ? phaseForWeek(program, config, tw, deloadWeeks) : null;
    const strengthish = s.kind !== "cardio";

    // Breaks: gap since the previous qualifying session of any kind.
    const gap = lastQ ? daysBetween(lastQ.date, s.date) : null;
    const computedLong = gap != null && gap > cfgB.short_days_max;
    const computedShortStart = !computedLong && gap != null && gap >= cfgB.short_days_min;
    if (computedLong) windowEnd = null;
    else if (computedShortStart) windowEnd = addDays(s.date, cfgB.short_duration_days - 1);
    const longBreakFirst = computedLong || (strengthish && s.s.flags.includes("long_break_restart"));
    const breakResume = !longBreakFirst && ((windowEnd != null && s.date <= windowEnd) || (strengthish && s.s.flags.includes("break_resume")));

    // Comeback: first strength session after a completed zero week, with no qualifying session of any kind since.
    const zero = lastZeroWeekBefore(wc, s.date);
    const comeback =
      (s.strengthLike && zero != null && (!lastQ || lastQ.date < zero.start)) ||
      (strengthish && (s.s.mode === "comeback" || s.s.flags.includes("comeback")));
    const deload = phase?.name === "deload";

    lastQ = s;
    if (s.strengthLike) lastStrength = s;

    const info: SessionInfo = {
      tw,
      phase,
      gapDays: gap,
      deload,
      comeback: strengthish && comeback,
      breakResume: strengthish && breakResume,
      longBreakFirst: strengthish && longBreakFirst,
      readinessCut: new Set(),
      holdRule: null,
    };
    infos.set(s.id, info);

    if (!s.finished) continue;
    const ended = s.endedIso ?? s.lastActivityIso;
    if (deload && w && tw === config.deload.planned_week && !reactiveWeeks.includes(tw)) deloadDone = true;

    if (computedLong) {
      const restart = w?.restartSessionId === s.id;
      push(
        makeDecision(n, {
          id: eventId("event.break_long", s.id),
          date: ended,
          rule_id: "event.break_long",
          session_id: s.id,
          inputs: { gap_days: gap, short_days_max: cfgB.short_days_max },
          output: { restart_week: restart ? cfgB.long_restart_week : null, load_pct: cfgB.long_load_pct },
          explanation: restart
            ? `Back after ${gap} days: training restarts at week ${cfgB.long_restart_week}.`
            : `Back after ${gap} days: easing in at ${fmtPct(cfgB.long_load_pct)}% loads.`,
        }),
      );
    } else if (computedShortStart) {
      push(
        makeDecision(n, {
          id: eventId("event.break_short", s.id),
          date: ended,
          rule_id: "event.break_short",
          session_id: s.id,
          inputs: { gap_days: gap },
          output: { load_pct: cfgB.short_load_pct, until: windowEnd },
          explanation: `Back after ${gap} days: ${fmtPct(cfgB.short_load_pct)}% loads for ${cfgB.short_duration_days} days.`,
        }),
      );
    }

    if (strengthish) {
      info.holdRule = deload ? "phase.deload_hold" : info.comeback ? "event.comeback_hold" : info.longBreakFirst || info.breakResume ? "event.break_hold" : null;

      // Group working sets by track, in logged order.
      const groups = new Map<string, NSet[]>();
      const painEx = new Set<string>();
      for (const x of s.sets) if (x.log.pain_flag) painEx.add(x.log.exercise_id);
      for (const x of s.workSets) {
        if (!x.track || !x.exercise || !x.slot) continue;
        let g = groups.get(x.track);
        if (!g) groups.set(x.track, (g = []));
        g.push(x);
        if (isMainLift(n, x.slot.prescription)) mainExercises.add(x.log.exercise_id);
      }

      // Base before this session (uses stats before this session).
      const evalTw = tw ?? 1;
      const evalPhase = phase ?? firstPhase;
      const before = new Map<string, { weight: number | null; reps: number }>();
      for (const [key, g] of groups) {
        const x = g[0]!;
        const t = tracks.get(key);
        if (t && t.last_decision_id) before.set(key, { weight: t.base_weight, reps: t.base_reps });
        else {
          const init = initialTarget(n, x.slot!, x.exercise!, evalTw, evalPhase, stats.get(x.log.exercise_id));
          before.set(key, { weight: init.weight, reps: init.reps });
        }
      }

      // Readiness: the planned load cut applied to the scope exercises with a load.
      const ck = n.checkinByDate.get(s.date);
      if (ck && checkinAverage(ck) <= config.readiness.threshold) {
        const scope = new Set(readinessScope(n, s.code, s.s.mode));
        for (const [key, g] of groups) {
          const x = g[0]!;
          const b = before.get(key);
          if (scope.has(x.slot!.prescription.id) && b?.weight != null && b.weight > 0) info.readinessCut.add(x.log.exercise_id);
        }
      }

      // e1RM per exercise (working sets incl. top sets, measure reps, load > 0).
      const sessionE1rm = new Map<string, number>();
      const topSets = new Map<string, { e1rm: number; weight: number; reps: number }>();
      for (const x of s.workSets) {
        if (x.measure !== "reps" || x.log.weight <= 0 || x.log.reps <= 0) continue;
        const v = e1rm(x.log.weight, x.log.reps, x.log.rir, div);
        if (v > (sessionE1rm.get(x.log.exercise_id) ?? 0)) sessionE1rm.set(x.log.exercise_id, v);
        if (x.log.is_top_set && v > (topSets.get(x.log.exercise_id)?.e1rm ?? 0)) topSets.set(x.log.exercise_id, { e1rm: v, weight: x.log.weight, reps: x.log.reps });
      }
      const firstOfBlock = new Map([...topSets.keys()].map((id) => [id, stats.get(id)?.first ?? null]));
      const e1rmInfo = new Map<string, { raw: number; stored: number | null }>();
      const sessionPrs: PrInfo[] = [];
      for (const [exId, raw] of sessionE1rm) {
        let st = stats.get(exId);
        if (!st) stats.set(exId, (st = { exercise_id: exId, history: [], e1rm: null, best: null, bestIdx: -1, first: null }));
        const prevBest = st.best;
        const eligible = !info.holdRule && !info.readinessCut.has(exId);
        let stored: number | null = null;
        if (eligible) {
          stored = raw;
          if (phase?.name === "return" && st.e1rm != null) stored = Math.min(raw, round2(st.e1rm * (1 + config.progression.return_e1rm_cap_pct)));
          st.history.push({ date: s.date, session_id: s.id, e1rm: stored });
          st.e1rm = stored;
          if (st.best == null || stored > st.best) {
            st.best = stored;
            st.bestIdx = st.history.length - 1;
          }
          if (st.first == null && s.date >= n.blockStart) st.first = stored;
        }
        e1rmInfo.set(exId, { raw, stored });
        const value = stored ?? raw;
        if (prevBest != null && value > prevBest) sessionPrs.push({ exercise_id: exId, e1rm: value, previous_best: prevBest });
      }
      if (sessionPrs.length) prs.set(s.id, sessionPrs);

      const sessionResults: ExposureResult[] = [];

      // Consolidate top sets: compare with the first e1RM of the block (phase.top_set). Listed after the track changes.
      const topResults: ExposureResult[] = [];
      if (phase?.top_set && topSets.size) {
        const id = eventId("phase.top_set", s.id);
        const lines: string[] = [];
        for (const [exId, t] of topSets) {
          const name = n.exercises[exId]?.name ?? exId;
          const first = firstOfBlock.get(exId) ?? null;
          const line =
            first != null
              ? `${name} top set: e1RM ${fmtNum(t.e1rm)} kg, start of the block ${fmtNum(first)} kg.`
              : `${name} top set: e1RM ${fmtNum(t.e1rm)} kg.`;
          lines.push(line);
          topResults.push({
            session_id: s.id,
            track: `${exId}@top`,
            exercise_id: exId,
            prescription_id: null,
            rule_id: "phase.top_set",
            decision_id: id,
            from: null,
            to: { weight: t.weight, reps: t.reps },
            summary: line,
            eligible: !info.holdRule,
          });
        }
        push(
          makeDecision(n, {
            id,
            date: ended,
            rule_id: "phase.top_set",
            session_id: s.id,
            inputs: { first_e1rm: Object.fromEntries(firstOfBlock) },
            output: { top_e1rm: Object.fromEntries([...topSets].map(([k, v]) => [k, v.e1rm])) },
            explanation: lines.join(" "),
          }),
        );
      }
      for (const [key, g] of groups) {
        const x = g[0]!;
        const slot = x.slot!;
        const exercise = x.exercise!;
        const exId = exercise.id;
        let t = tracks.get(key);
        if (!t) tracks.set(key, (t = newTrack(n, slot)));
        const work = g.filter((y) => !y.log.is_top_set);
        const shown = work.length ? work : g;
        const last: LastTime = { session_id: s.id, date: s.date, sets: shown.map((y) => ({ weight: y.log.weight, reps: y.log.reps, rir: y.log.rir })) };
        t.last = last;
        t.pain_last = painEx.has(exId);
        lastPainByExercise.set(exId, painEx.has(exId));
        if (!work.length) continue; // top sets only: nothing to evaluate
        const b = before.get(key)!;

        const hold = info.holdRule ?? (info.readinessCut.has(exId) ? "event.readiness_hold" : null);
        if (hold) {
          const id = eventId(hold, s.id);
          let text = HOLD_TEXT[hold] ?? "Same targets next time.";
          if (hold === "event.break_hold" && info.longBreakFirst) text = "First session after a long break: same targets next time.";
          push(makeDecision(n, { id, date: ended, rule_id: hold, session_id: s.id, inputs: { session_id: s.id }, output: { hold: true }, explanation: text }));
          // A track with no base yet (first exposure) keeps what was lifted at the same reps target: no increase,
          // but the calibration is done, so the next session does not ask for a weight again.
          let to = b;
          if (!t.last_decision_id && slot.progression_rule !== "none") {
            to = { weight: round2(Math.max(...work.map((y) => y.log.weight))), reps: b.reps };
            t.base_weight = to.weight;
            t.base_reps = to.reps;
            t.last_decision_id = id;
          }
          sessionResults.push({
            session_id: s.id,
            track: key,
            exercise_id: exId,
            prescription_id: slot.prescription.id,
            rule_id: hold,
            decision_id: id,
            from: b,
            to,
            summary: `${exercise.name}: ${text.charAt(0).toLowerCase()}${text.slice(1)}`,
            eligible: false,
          });
          continue;
        }

        const targetRir = phase ? phase.rir_min : (work.find((y) => y.log.target_rir != null)?.log.target_rir ?? firstPhase.rir_min);
        const ev = evaluate(n, {
          slot,
          exercise,
          sets: work,
          pain: painEx.has(exId),
          targetRir,
          largeJumps: phase?.large_jumps ?? false,
          phaseName: phase?.name ?? "previous",
          track: t,
          baseReps: b.reps,
        });
        const ei = e1rmInfo.get(exId);
        const id = progressionId(s.id, key);
        push(
          makeDecision(n, {
            id,
            date: ended,
            rule_id: ev.rule_id,
            session_id: s.id,
            exercise_id: exId,
            inputs: { ...ev.inputs, base_before: b, e1rm_raw: ei?.raw ?? null, e1rm: ei?.stored ?? null },
            output: { weight: ev.weight, reps: ev.reps, summary: ev.summary },
            explanation: ev.explanation,
          }),
        );
        t.base_weight = ev.weight;
        t.base_reps = ev.reps;
        t.exposures += 1;
        t.belowHistory.push(ev.below);
        t.allBelowHistory.push(ev.allBelow);
        t.below_range_streak = ev.rule_id === "dp.reset" ? 0 : ev.below ? t.below_range_streak + 1 : 0;
        t.last_rule_id = ev.rule_id;
        t.last_decision_id = id;
        sessionResults.push({
          session_id: s.id,
          track: key,
          exercise_id: exId,
          prescription_id: slot.prescription.id,
          rule_id: ev.rule_id,
          decision_id: id,
          from: b,
          to: { weight: ev.weight, reps: ev.reps },
          summary: ev.summary,
          eligible: true,
        });
      }
      results.set(s.id, [...sessionResults, ...topResults]);
    }

    // Reactive deload, evaluated after every finished session inside the block.
    if (w && tw != null) {
      const crit = reactiveCriterion(n, tracks, stats, mainExercises, s.date);
      if (crit) {
        const k = tw;
        const can =
          reactiveWeeks.length < rd.max_per_block &&
          k + 1 < config.deload.planned_week &&
          !deloadDone &&
          !deloadWeeks.has(k) &&
          !deloadWeeks.has(k + 1);
        if (can) {
          deloadWeeks.delete(config.deload.planned_week);
          deloadWeeks.add(k + 1);
          reactiveWeeks.push(k + 1);
          const text = `${REACTIVE_TEXT[crit]}: week ${k + 1} becomes a deload week. Week ${config.deload.planned_week} is a normal week now.`;
          push(
            makeDecision(n, {
              id: eventId("event.reactive_deload", s.id),
              date: ended,
              rule_id: "event.reactive_deload",
              session_id: s.id,
              inputs: { criterion: crit, training_week: k },
              output: { deload_week: k + 1, cancelled_week: config.deload.planned_week },
              explanation: text,
            }),
          );
          flags.push({ kind: "reactive_deload", rule_id: "event.reactive_deload", text, date: s.date, exercise_id: null });
        } else if (!deloadWeeks.has(k) && !reactiveWeeks.includes(k + 1) && !criteriaWeeks.has(w.id)) {
          criteriaWeeks.add(w.id);
          flags.push({
            kind: "deload_criteria_met",
            rule_id: "event.reactive_deload",
            text: `${REACTIVE_TEXT[crit]}. Take it easier this week if you need to.`,
            date: s.date,
            exercise_id: null,
          });
        }
      }
    }
  }

  return {
    tracks,
    stats,
    decisions,
    decisionById,
    results,
    prs,
    infos,
    deloadWeeks,
    reactiveWeeks,
    flags,
    lastPainByExercise,
    breakWindowEnd: windowEnd,
    lastQualifying: lastQ,
    lastStrengthLike: lastStrength,
  };
}

/** Which reactive deload criterion is met as of a local date, if any (ENGINE_RULES section 2). */
function reactiveCriterion(
  n: Norm,
  tracks: Map<string, TrackInternal>,
  stats: Map<string, StatsInternal>,
  mainExercises: Set<string>,
  date: string,
): string | null {
  const rd = n.config.reactive_deload;
  let drops = 0;
  for (const exId of mainExercises) {
    const h = stats.get(exId)?.history;
    if (!h || h.length <= rd.e1rm_drop_span_sessions) continue;
    const latest = h[h.length - 1]!.e1rm;
    const earlier = h[h.length - 1 - rd.e1rm_drop_span_sessions]!.e1rm;
    if (latest <= (1 - rd.e1rm_drop_pct) * earlier + 1e-9) drops += 1;
  }
  if (drops >= rd.e1rm_drop_lifts) return "e1rm_drop";

  const k = rd.missed_reps_sessions;
  const missed = new Set<string>();
  for (const t of tracks.values()) {
    const b = t.belowHistory;
    if (k > 0 && b.length >= k && b.slice(-k).every(Boolean)) missed.add(t.exercise_id);
  }
  if (missed.size >= rd.missed_reps_exercises) return "missed_reps";

  if (rd.checkin_days > 0) {
    const upTo = n.checkins.filter((c) => c.date <= date);
    const lastN = upTo.slice(-rd.checkin_days);
    if (lastN.length === rd.checkin_days) {
      const consecutive = lastN.every((c, i) => i === 0 || daysBetween(lastN[i - 1]!.date, c.date) === 1);
      if (consecutive && lastN.every((c) => checkinAverage(c) <= rd.checkin_avg_max + 1e-9)) return "checkins";
    }
  }
  return null;
}

export function statsOut(st: StatsInternal, stallExposures: number) {
  const since = st.bestIdx >= 0 ? st.history.length - 1 - st.bestIdx : 0;
  return {
    exercise_id: st.exercise_id,
    e1rm: st.e1rm,
    best_e1rm: st.best,
    first_e1rm: st.first,
    history: st.history,
    exposures: st.history.length,
    exposures_since_best: since,
    stalled: st.history.length > stallExposures && since >= stallExposures,
  };
}

export function trackOut(t: TrackInternal): TrackState {
  return {
    key: t.key,
    exercise_id: t.exercise_id,
    rep_min: t.rep_min,
    rep_max: t.rep_max,
    base_weight: t.base_weight,
    base_reps: t.base_reps,
    exposures: t.exposures,
    below_range_streak: t.below_range_streak,
    last_rule_id: t.last_rule_id,
    last_decision_id: t.last_decision_id,
    last: t.last,
  };
}
