/** Weekly fractional sets per tracked muscle, WHO minutes, check-in averages and cumulative totals. */
import type { CardioLog, Muscle } from "@gym/schema";
import type { CumulativeTotals, WeekVolume } from "./types";
import type { Analysis } from "./analysis";
import type { NSession, NSet, Norm } from "./context";
import { checkinAverage } from "./context";
import { daysBetween, weekStart } from "./dates";
import { fractionalSets, round2 } from "./calc";
import { phaseForWeek } from "./phases";

/** WHO moderate equivalent minutes of one log: easy minutes, or hard × multiplier + the rest. */
export function whoMinutes(n: Norm, c: CardioLog): number {
  if (c.intensity === "easy") return c.minutes;
  const hard = Math.min(c.minutes, c.hard_minutes ?? c.minutes);
  return hard * n.config.who.hard_multiplier + (c.minutes - hard);
}

/** kg lifted by one working set (measure reps only; per hand counts both hands). */
export function kgOf(x: NSet): number {
  if (x.measure !== "reps") return 0;
  return x.log.weight * x.log.reps * (x.exercise?.per_hand ? 2 : 1);
}

export function sessionKg(s: NSession): number {
  return round2(s.workSets.reduce((a, x) => a + kgOf(x), 0));
}

export function weekVolumes(an: Analysis): WeekVolume[] {
  const { n, wc, rp } = an;
  const v = n.config.volume;
  const tracked = new Set<Muscle>(v.tracked_muscles);
  const out: WeekVolume[] = wc.weeks.map((w) => {
    const phase = phaseForWeek(n.program, n.config, w.tw, rp.deloadWeeks);
    const by_muscle: Partial<Record<Muscle, number>> = {};
    for (const m of v.tracked_muscles) by_muscle[m] = 0;
    return {
      week_id: w.id,
      by_muscle,
      band: v.band_phases.includes(phase.name) ? { min: v.band_min, max: v.band_max } : null,
      who_minutes: 0,
      who_target: n.config.who.weekly_minutes,
      checkin_avg: null,
    };
  });
  const indexOf = (date: string) => daysBetween(n.blockMonday, weekStart(date)) / 7;

  // Finished and in progress sessions alike.
  for (const s of n.sessions) {
    const vol = out[s.weekIndex];
    if (!vol) continue;
    for (const x of s.workSets) {
      if (!x.exercise) continue;
      for (const [m, f] of Object.entries(fractionalSets(x.exercise, n.config))) {
        if (tracked.has(m as Muscle)) vol.by_muscle[m as Muscle] = (vol.by_muscle[m as Muscle] ?? 0) + f;
      }
    }
  }
  for (const c of n.cardioLogs) {
    const vol = out[indexOf(c.date)];
    if (vol) vol.who_minutes += whoMinutes(n, c);
  }
  const ck = new Map<number, number[]>();
  for (const c of n.checkins) {
    const i = indexOf(c.date);
    if (!out[i]) continue;
    const arr = ck.get(i) ?? [];
    arr.push(checkinAverage(c));
    ck.set(i, arr);
  }
  out.forEach((vol, i) => {
    for (const m of Object.keys(vol.by_muscle) as Muscle[]) vol.by_muscle[m] = round2(vol.by_muscle[m] ?? 0);
    vol.who_minutes = round2(vol.who_minutes);
    const arr = ck.get(i);
    vol.checkin_avg = arr ? round2(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
  });
  return out;
}

/** Cumulative totals that never reset (whole history up to now). */
export function totals(an: Analysis): CumulativeTotals {
  const { n } = an;
  let sets = 0;
  let kg = 0;
  for (const s of n.sessions) {
    sets += s.workSets.length;
    for (const x of s.workSets) kg += kgOf(x);
  }
  let cardio = 0;
  let walking = 0;
  for (const c of n.cardioLogs) {
    if (c.session_id == null) walking += c.minutes;
    else cardio += c.minutes;
  }
  return {
    sessions: n.qualifying.length,
    strength_sessions: n.qualifying.filter((s) => s.strengthLike).length,
    cardio_sessions: n.qualifying.filter((s) => s.kind === "cardio").length,
    sets,
    cardio_minutes: round2(cardio),
    walking_minutes: round2(walking),
    kg_lifted: round2(kg),
  };
}
