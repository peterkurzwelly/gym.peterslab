/** Readiness, spacing warnings, nudges and flags. */
import type { Checkin, DayCode, StrengthDayCode } from "@gym/schema";
import type { Flag, NextSession, Nudge, ReadinessResult, SpacingWarning, WeekVolume } from "./types";
import type { Analysis } from "./analysis";
import type { Norm } from "./context";
import { checkinAverage } from "./context";
import { addDays, daysBetween, isoWeekday, localHour, localMidnightMs } from "./dates";
import { lerpClamped, round2 } from "./calc";
import { nextInLine } from "./analysis";
import { lastZeroWeekBefore } from "./weeks";
import { statsOut } from "./progression";
import { capitalize, comebackText, fmtNum, fmtPct, numberWord, plural } from "./text";

// ---------------- readiness ----------------

export type Metric = "sleep" | "soreness" | "stress" | "energy";
const METRICS: Metric[] = ["sleep", "soreness", "stress", "energy"];
const METRIC_LABEL: Record<Metric, string> = { sleep: "Sleep", soreness: "Soreness", stress: "Stress", energy: "Energy" };

export interface ReadinessCalc {
  checkin: Checkin;
  average: number;
  lowest: { metric: Metric; value: number };
  adjusted: boolean;
  sets_drop: number;
  load_cut_pct: number;
}

/** Readiness from the check-in on a local date (average of four scores, higher is better). */
export function readinessFor(n: Norm, date: string): ReadinessCalc | null {
  const c = n.checkinByDate.get(date);
  if (!c) return null;
  const r = n.config.readiness;
  const average = checkinAverage(c);
  let lowest = { metric: METRICS[0]!, value: c[METRICS[0]!] };
  for (const m of METRICS) if (c[m] < lowest.value) lowest = { metric: m, value: c[m] };
  const adjusted = average <= r.threshold + 1e-9;
  let sets_drop = 0;
  let load_cut_pct = 0;
  if (adjusted) {
    for (const d of r.set_drops) if (d.max_avg >= average - 1e-9) sets_drop = Math.max(sets_drop, d.drop);
    const lc = r.load_cut;
    const raw = lerpClamped(average, r.threshold, lc.at_threshold_pct, lc.floor_avg, lc.at_floor_pct);
    load_cut_pct = lc.pct_step > 0 ? Math.round(Math.round((raw / lc.pct_step) * 1e6) / 1e6) * lc.pct_step : raw;
    load_cut_pct = Math.round(load_cut_pct * 10000) / 10000;
  }
  return { checkin: c, average: round2(average), lowest, adjusted, sets_drop, load_cut_pct };
}

/** "Sleep 2/5: Back squat −7.5%, 1 set dropped per exercise." */
export function readinessBanner(rc: ReadinessCalc, cutLabel: string | null): string {
  const parts: string[] = [];
  if (cutLabel && rc.load_cut_pct > 0) parts.push(`${cutLabel} −${fmtPct(rc.load_cut_pct)}%`);
  if (rc.sets_drop > 0) parts.push(`${plural(rc.sets_drop, "set")} dropped per exercise`);
  if (!parts.length) parts.push("a lighter session today");
  return `${METRIC_LABEL[rc.lowest.metric]} ${rc.lowest.value}/5: ${parts.join(", ")}.`;
}

export function readinessCardioBanner(rc: ReadinessCalc, minutes: number): string {
  return `${METRIC_LABEL[rc.lowest.metric]} ${rc.lowest.value}/5: easy ${fmtNum(minutes)} min instead of intervals.`;
}

export function readinessResult(rc: ReadinessCalc | null, banner: string | null): ReadinessResult | null {
  if (!rc) return null;
  return {
    checkin_id: rc.checkin.id,
    date: rc.checkin.date,
    average: rc.average,
    lowest: rc.lowest,
    adjusted: rc.adjusted,
    sets_drop: rc.sets_drop,
    load_cut_pct: rc.load_cut_pct,
    cardio_swap: rc.adjusted,
    banner: rc.adjusted ? banner : null,
  };
}

// ---------------- plan modifiers at a date ----------------

export interface PlanModifiers {
  comeback: boolean;
  gapDays: number | null;
  longBreak: boolean;
  breakResume: boolean;
  /** The short break rule matched before the comeback override (buildPlan re-checks it for a manual comeback mode). */
  rawShortBreak: boolean;
  /** The current week restarted because of a long break. */
  restart: boolean;
}

/**
 * Short break (`event.break_short`) applies, given whether the session is a comeback: with
 * comeback.overrides_short_break a comeback keeps the same weights instead (ENGINE_RULES 4.5, PROGRAM.md rule 4).
 */
export function shortBreakApplies(n: Norm, raw: boolean, comeback: boolean, longBreak: boolean): boolean {
  return raw && !longBreak && !(comeback && n.config.comeback.overrides_short_break);
}

/** Comeback and break state for a strength or travel session started at analysis time (`at`). */
export function planModifiers(an: Analysis): PlanModifiers {
  const { n, wc, rp } = an;
  const b = n.config.break;
  const zero = lastZeroWeekBefore(wc, n.today);
  // ENGINE_RULES 4.5: no qualifying strength or travel session since the zero week ended (cardio does not cancel it).
  const lastSt = rp.lastStrengthOrTravel;
  const comeback = zero != null && (!lastSt || lastSt.date <= zero.end);
  const last = rp.lastQualifying;
  const gapDays = last ? daysBetween(last.date, n.today) : null;
  const longBreak = gapDays != null && gapDays > b.short_days_max;
  const rawShort = gapDays != null && (gapDays >= b.short_days_min || (rp.breakWindowEnd != null && n.today <= rp.breakWindowEnd));
  const breakResume = shortBreakApplies(n, rawShort, comeback, longBreak);
  const restart = wc.current.prospectiveRestart || wc.current.restartSessionId != null;
  return { comeback, gapDays, longBreak, breakResume, rawShortBreak: rawShort && !longBreak, restart };
}

// ---------------- spacing ----------------

const STRENGTH_CODES = new Set<DayCode>(["A", "B", "C", "TRAVEL"]);

/** Warnings (never blocks) for starting a session of this kind at analysis time. */
export function spacing(an: Analysis, code: DayCode, intensity: "easy" | "hard"): SpacingWarning[] {
  const { n } = an;
  const sp = n.config.spacing;
  const out: SpacingWarning[] = [];

  if (STRENGTH_CODES.has(code)) {
    const days = new Set(n.qualifying.filter((s) => s.strengthLike).map((s) => s.date));
    days.add(n.today);
    let run = 0;
    for (let d = n.today; days.has(d); d = addDays(d, -1)) run += 1;
    if (run > sp.max_consecutive_strength_days) {
      out.push({
        rule_id: "spacing.consecutive_strength",
        text: `That would be strength ${run} days in a row. A rest day helps, but go if you feel good.`,
      });
    }
  }

  const heavy = new Set<DayCode>(sp.heavy_days);
  if (heavy.has(code)) {
    const windowMs = sp.hard_cardio_before_heavy_hours * 3_600_000;
    const recentHard = n.cardioLogs.some((c) => {
      if (c.intensity !== "hard") return false;
      let endMs: number;
      if (c.session_id) {
        const s = n.sessionById.get(c.session_id);
        if (!s) return false;
        endMs = s.s.ended_at ? Date.parse(s.s.ended_at) : s.startMs + c.minutes * 60_000;
      } else {
        // Session-less logs have no time: count them until the end of their day.
        endMs = localMidnightMs(addDays(c.date, 1), n.tz);
      }
      return n.atMs - endMs <= windowMs;
    });
    if (recentHard) {
      out.push({
        rule_id: "spacing.hard_cardio_before_heavy",
        text: `Hard cardio less than ${fmtNum(sp.hard_cardio_before_heavy_hours)} h ago and ${code} has heavy leg work. Fine to go, keep it steady.`,
      });
    }
  }

  if (code === "CARDIO" && intensity === "hard") {
    const next = nextInLine(n).code;
    if (heavy.has(next)) {
      out.push({ rule_id: "spacing.hard_cardio_before_heavy", text: `Next up is ${next}. Keep hard cardio a day away, or go easy today.` });
    }
  }
  return out;
}

// ---------------- nudges ----------------

/** Never miss twice (`event.never_miss_twice`): floor not reached and enough hours since the last strength session (or block start). */
export function neverMissTwice(an: Analysis, code: StrengthDayCode, doneToday: boolean): Nudge | null {
  const { n, wf } = an;
  if (wf.current.floor_reached || doneToday) return null;
  const blockStartMs = localMidnightMs(n.blockStart, n.tz);
  const last = an.rp.lastStrengthLike;
  const lastMs = last ? Date.parse(last.endedIso ?? last.lastActivityIso) : -Infinity;
  const refMs = Math.max(lastMs, blockStartMs);
  if (n.atMs - refMs < n.config.never_miss_twice.hours * 3_600_000) return null;
  const day = n.dayByCode.get(code);
  const short = day?.has_short_version && day.short_minutes;
  return {
    kind: "never_miss_twice",
    rule_id: "event.never_miss_twice",
    text: short ? `Never miss twice: ★ ${day.short_minutes} min version of ${code} is enough today.` : `Never miss twice: session ${code} fits today.`,
    action: { mode: short ? "short" : "full", code },
  };
}

export interface Recommendation {
  mode: "full" | "short";
  rule_id: string | null;
  reason: string | null;
}

/**
 * Which version the Today screen leads with (`plan.recommend_short`, ENGINE_RULES 5), first match wins:
 * never miss twice → floor at risk (week killer work_peaks) → after the evening hour (week killer evenings) → full.
 * Only days with a short version recommend it. Nothing before the block starts; the evening rule is about
 * today, so it does not fire when a strength session is already done today (never stack).
 */
export function recommendVersion(an: Analysis, code: StrengthDayCode, doneToday: boolean): Recommendation {
  const { n, wf } = an;
  const full: Recommendation = { mode: "full", rule_id: null, reason: null };
  const day = n.dayByCode.get(code);
  const mins = day?.has_short_version ? day.short_minutes : null;
  if (!mins || n.today < n.blockStart) return full;
  const version = `the ${mins} min version counts fully.`;

  const nmt = neverMissTwice(an, code, doneToday);
  if (nmt) return { mode: "short", rule_id: nmt.rule_id, reason: nmt.text };

  const killers = n.settings.week_killers ?? [];
  const cur = wf.current;
  if (killers.includes("work_peaks") && !cur.floor_reached && n.today >= cur.start_date && n.today <= cur.end_date) {
    const daysLeft = daysBetween(n.today, cur.end_date) + 1;
    const needed = Math.max(0, n.config.week.strength_floor - cur.strength_done);
    if (daysLeft <= needed + 1) return { mode: "short", rule_id: "plan.floor_at_risk", reason: `Floor at risk: ${version}` };
  }

  const hour = n.settings.evening_hour;
  if (killers.includes("evenings") && hour != null && !doneToday && localHour(n.atIso, n.tz) >= hour) {
    return { mode: "short", rule_id: "plan.evening", reason: `After ${String(hour).padStart(2, "0")}:00: ${version}` };
  }
  return full;
}

export function buildNudges(an: Analysis, next: NextSession, mods: PlanModifiers): Nudge[] {
  const { n, wf } = an;
  const out: Nudge[] = [];
  const cur = wf.current;
  const code = next.code;
  const b = n.config.break;

  if (wf.block.complete) {
    out.push({ kind: "block_complete", rule_id: "event.block_complete", text: `Block done. Plan the next ${n.program.block_weeks} weeks.`, action: null });
  }
  if (!next.done_today) {
    if (mods.comeback) {
      const red = n.config.comeback.set_reduction;
      out.push({
        kind: "comeback",
        rule_id: "event.comeback",
        text: comebackText(red, mods.longBreak || mods.breakResume),
        action: { mode: "comeback", code },
      });
    }
    if (mods.longBreak) {
      out.push({
        kind: "long_break",
        rule_id: "event.break_long",
        text: mods.restart
          ? `Welcome back. Training restarts at week ${b.long_restart_week}, first session at ${fmtPct(b.long_load_pct)}% weights.`
          : `Welcome back. First session at ${fmtPct(b.long_load_pct)}% weights to ease in.`,
        action: { mode: "full", code },
      });
    } else if (mods.breakResume) {
      out.push({
        kind: "break_resume",
        rule_id: "event.break_short",
        text: `Welcome back. Weights at ${fmtPct(b.short_load_pct)}% for ${b.short_duration_days} days to ease in.`,
        action: { mode: "full", code },
      });
    }
  }

  const nmt = neverMissTwice(an, code, next.done_today);
  if (nmt) out.push(nmt);

  const weekday = isoWeekday(n.today);
  const floorWord = numberWord(n.config.week.strength_floor);
  if (weekday === 6 || (weekday === 0 && cur.session_ids.length === 0)) {
    out.push({ kind: "book_floor", rule_id: "event.book_floor", text: `Book your ${floorWord} floor sessions for the week.`, action: null });
  }
  if (weekday === 6 && n.today >= n.blockStart) {
    out.push({ kind: "sunday_review", rule_id: "event.sunday_review", text: "Sunday review: floor, target and what moved up. Two minutes.", action: null });
  }
  return out;
}

// ---------------- flags ----------------

export function buildFlags(an: Analysis, volume: WeekVolume[]): Flag[] {
  const { n, rp, wf } = an;
  const out: Flag[] = [];
  const nameOf = (id: string) => n.exercises[id]?.name ?? id;

  for (const f of rp.flags) if (f.kind === "reactive_deload") out.push(f);
  const criteria = rp.flags.filter((f) => f.kind === "deload_criteria_met");
  const lastCriteria = criteria[criteria.length - 1];
  if (lastCriteria) out.push(lastCriteria);

  const stallN = n.config.stall.exposures;
  for (const st of [...rp.stats.values()].sort((a, b) => a.exercise_id.localeCompare(b.exercise_id))) {
    const so = statsOut(st, stallN);
    if (!so.stalled) continue;
    out.push({
      kind: "stall",
      rule_id: "event.stall",
      text: `${nameOf(st.exercise_id)}: no e1RM gain in ${stallN} sessions. Try a variation or a new rep range.`,
      date: st.history[st.history.length - 1]?.date ?? n.today,
      exercise_id: st.exercise_id,
    });
  }

  for (const t of [...rp.tracks.values()].sort((a, b) => a.key.localeCompare(b.key))) {
    if (t.last_rule_id === "dp.below_range" || t.last_rule_id === "ro.below_range") {
      out.push({
        kind: "below_range",
        rule_id: t.last_rule_id,
        text: `${nameOf(t.exercise_id)}: below range last time. Check sleep, rest times and technique.`,
        date: t.last?.date ?? n.today,
        exercise_id: t.exercise_id,
      });
    }
  }

  for (const [exId, pain] of [...rp.lastPainByExercise].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!pain) continue;
    out.push({ kind: "pain", rule_id: "dp.pain", text: `${nameOf(exId)}: pain logged last time. An alternative may feel better.`, date: n.today, exercise_id: exId });
  }

  // Volume flags for the last completed week in a band phase.
  const lastDone = [...wf.weeks].reverse().find((w) => w.is_complete);
  const vol = lastDone ? volume.find((v) => v.week_id === lastDone.id) : undefined;
  if (lastDone && vol?.band) {
    for (const m of n.config.volume.tracked_muscles) {
      const v = vol.by_muscle[m] ?? 0;
      const label = capitalize(m.replace(/_/g, " "));
      if (v < vol.band.min) {
        out.push({ kind: "volume_low", rule_id: "volume.band", text: `${label}: ${v === 1 ? "1 set" : `${fmtNum(v)} sets`} last week, band is ${vol.band.min} to ${vol.band.max}.`, date: lastDone.end_date, exercise_id: null });
      } else if (v > vol.band.max) {
        out.push({ kind: "volume_high", rule_id: "volume.band", text: `${label}: ${v === 1 ? "1 set" : `${fmtNum(v)} sets`} last week, band is ${vol.band.min} to ${vol.band.max}.`, date: lastDone.end_date, exercise_id: null });
      }
    }
  }

  // Readiness trend over the last 7 days.
  const from = addDays(n.today, -6);
  const recent = n.checkins.filter((c) => c.date >= from && c.date <= n.today);
  if (recent.length) {
    const avg = recent.reduce((a, c) => a + checkinAverage(c), 0) / recent.length;
    if (avg <= n.config.readiness.threshold + 1e-9) {
      out.push({
        kind: "readiness_trend",
        rule_id: "event.readiness_trend",
        text: `Check-ins averaged ${fmtNum(avg)} of 5 this week. Lighter sessions and more sleep help.`,
        date: n.today,
        exercise_id: null,
      });
    }
  }
  return out;
}

