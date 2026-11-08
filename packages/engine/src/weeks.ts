/**
 * Calendar weeks, training week index (zero weeks extend the block, long breaks restart it),
 * week statuses, repairs, streak and the 12 dots.
 */
import type { Decision, PhaseName } from "@gym/schema";
import type { NSession, Norm } from "./context";
import type { BlockState, DotState, StreakState, WeekState, WeekStatus } from "./types";
import { addDays, daysBetween, localMidnightMs, toIso, weekStart } from "./dates";
import { eventId, makeDecision } from "./decisions";
import { phaseForWeek } from "./phases";
import { plural } from "./text";

export interface WeekCalc {
  idx: number;
  id: string;
  start: string;
  end: string;
  calendar_index: number;
  is_current: boolean;
  is_complete: boolean;
  /** Qualifying sessions dated in this week. */
  sessions: NSession[];
  strength_done: number;
  cardio_done: number;
  walking_minutes: number;
  /** Has a qualifying session of a kind in week.zero_week_counts. */
  counted: boolean;
  is_zero: boolean;
  tw: number;
  /** First session after a long break that restarted the training week here. */
  restartSessionId: string | null;
  prospectiveRestart: boolean;
  repaired: boolean;
}

export interface WeeksCalc {
  weeks: WeekCalc[];
  current: WeekCalc;
  extension: number;
}

export function buildWeeks(n: Norm): WeeksCalc {
  const { config } = n;
  const curMonday = weekStart(n.today);
  const count = Math.max(1, daysBetween(n.blockMonday, curMonday) / 7 + 1);
  const weeks: WeekCalc[] = [];
  for (let i = 0; i < count; i++) {
    const start = addDays(n.blockMonday, 7 * i);
    const end = addDays(start, 6);
    weeks.push({
      idx: i,
      id: `wk_${start}`,
      start,
      end,
      calendar_index: i + 1,
      is_current: i === count - 1,
      is_complete: end < n.today,
      sessions: [],
      strength_done: 0,
      cardio_done: 0,
      walking_minutes: 0,
      counted: false,
      is_zero: false,
      tw: 1,
      restartSessionId: null,
      prospectiveRestart: false,
      repaired: false,
    });
  }

  for (const s of n.sessions) {
    const idx = weekIndexOf(n, s.date);
    s.weekIndex = idx >= 0 && idx < count ? idx : -1;
    const w = weeks[s.weekIndex];
    if (w && s.qualifying) w.sessions.push(s);
  }
  for (const walk of n.walks) {
    const w = weeks[weekIndexOf(n, walk.date)];
    if (w) w.walking_minutes += walk.minutes;
  }

  const counts = new Set<string>(config.week.zero_week_counts);
  for (const w of weeks) {
    w.strength_done = w.sessions.filter((s) => s.strengthLike).length;
    w.cardio_done = w.sessions.filter((s) => s.kind === "cardio").length;
    w.counted = w.sessions.some((s) => counts.has(s.kind));
    w.is_zero = w.is_complete && !w.counted;
    w.repaired = w.is_zero && n.repairedMondays.has(w.start);
  }

  // Training week index: advance after a completed non zero week, stay after a zero week.
  const qIndex = new Map(n.qualifying.map((s, i) => [s.id, i]));
  const { short_days_max, long_restart_week } = config.break;
  let tw = 1;
  for (const w of weeks) {
    const first = w.sessions[0];
    if (first) {
      const prev = n.qualifying[(qIndex.get(first.id) ?? 0) - 1];
      if (prev && daysBetween(prev.date, first.date) > short_days_max && tw > long_restart_week) {
        tw = long_restart_week;
        w.restartSessionId = first.id;
      }
    } else if (w.is_current) {
      const last = n.qualifying[n.qualifying.length - 1];
      if (last && daysBetween(last.date, n.today) > short_days_max && tw > long_restart_week) {
        tw = long_restart_week;
        w.prospectiveRestart = true;
      }
    }
    w.tw = tw;
    if (w.is_complete && !w.is_zero) tw += 1;
  }

  // How many calendar weeks the block runs longer than planned: zero weeks plus the weeks a long break restart
  // took back. Each completed non zero week advances tw by one, so this is the current calendar index − tw.
  const current = weeks[weeks.length - 1]!;
  const extension = Math.max(0, current.calendar_index - current.tw);

  return { weeks, current, extension };
}

/**
 * Calendar week index (0 = week 1) of a local date, before the range check. Activity dated in the 7 days before
 * the block's Monday counts toward week 1 (D18), so that week maps to 0 as well.
 */
export function weekIndexOf(n: Norm, date: string): number {
  const idx = daysBetween(n.blockMonday, weekStart(date)) / 7;
  return idx === -1 ? 0 : idx;
}

/** Week calc for a local date, or undefined before the block / after today. */
export function weekForDate(n: Norm, wc: WeeksCalc, date: string): WeekCalc | undefined {
  return wc.weeks[weekIndexOf(n, date)];
}

/** Latest completed zero week that ended before a local date. */
export function lastZeroWeekBefore(wc: WeeksCalc, date: string): WeekCalc | undefined {
  let found: WeekCalc | undefined;
  for (const w of wc.weeks) {
    if (w.is_zero && w.end < date) found = w;
  }
  return found;
}

/** Instant (ISO) when a week ended: local midnight after its Sunday. */
export function weekEndIso(n: Norm, w: { end: string }): string {
  return toIso(localMidnightMs(addDays(w.end, 1), n.tz));
}

export function zeroWeekDecisions(n: Norm, wc: WeeksCalc): Decision[] {
  return wc.weeks
    .filter((w) => w.is_zero)
    .map((w) =>
      makeDecision(n, {
        id: eventId("event.zero_week", w.id),
        date: weekEndIso(n, w),
        rule_id: "event.zero_week",
        inputs: { week_id: w.id, training_week: w.tw, repaired: w.repaired },
        output: { extension: true },
        explanation: w.repaired
          ? "Week repaired: the streak holds. The block still extends by one week."
          : "No session this week: the block extends by one week.",
      }),
    );
}

function joinNeeds(parts: { n: number; text: string }[], goal: string): string | null {
  const live = parts.filter((p) => p.n > 0);
  if (!live.length) return null;
  const single = live.length === 1 && live[0]!.n === 1;
  return `${live.map((p) => p.text).join(" and ")} ${single ? "reaches" : "reach"} the ${goal}`;
}

export interface WeeksFinal {
  weeks: WeekState[];
  current: WeekState;
  streak: StreakState;
  block: BlockState;
}

export function finalizeWeeks(n: Norm, wc: WeeksCalc, deloadWeeks: ReadonlySet<number>, reactiveWeeks: number[]): WeeksFinal {
  const { config, program } = n;
  const floor = config.week.strength_floor;
  const sTarget = config.week.strength_target;
  const cTarget = config.week.cardio_target;
  const { window_weeks, max_per_window } = config.week.repair;
  const repairedIdx = wc.weeks.filter((w) => w.repaired).map((w) => w.idx);

  const canRepair = (w: WeekCalc): boolean => {
    if (!w.is_zero || w.repaired) return false;
    for (let s = w.idx - (window_weeks - 1); s <= w.idx; s++) {
      const inWindow = repairedIdx.filter((i) => i >= s && i <= s + window_weeks - 1).length;
      if (inWindow >= max_per_window) return false;
    }
    return true;
  };

  const weeks: WeekState[] = wc.weeks.map((w) => {
    const phase = phaseForWeek(program, config, w.tw, deloadWeeks);
    const floor_reached = w.strength_done >= floor;
    const target_reached = w.strength_done >= sTarget && w.cardio_done >= cTarget;
    let status: WeekStatus;
    if (target_reached) status = "target";
    else if (floor_reached) status = "floor";
    else if (!w.is_complete) status = "in_progress";
    else status = w.is_zero ? "zero" : "below_floor";
    const open = !w.is_complete;
    const sNeed = Math.max(0, sTarget - w.strength_done);
    const cNeed = Math.max(0, cTarget - w.cardio_done);
    return {
      id: w.id,
      start_date: w.start,
      end_date: w.end,
      calendar_index: w.calendar_index,
      training_week: w.tw,
      phase: phase.name,
      phase_label: phase.label,
      is_current: w.is_current,
      is_complete: w.is_complete,
      strength_done: w.strength_done,
      cardio_done: w.cardio_done,
      bonus_done: Math.max(0, w.strength_done - sTarget) + Math.max(0, w.cardio_done - cTarget),
      walking_minutes: w.walking_minutes,
      floor_reached,
      target_reached,
      is_zero: w.is_zero,
      repaired: w.repaired,
      can_repair: canRepair(w),
      reactive_deload: reactiveWeeks.includes(w.tw),
      status,
      session_ids: w.sessions.map((s) => s.id),
      to_floor_text:
        open && !floor_reached ? joinNeeds([{ n: floor - w.strength_done, text: `${plural(floor - w.strength_done, "more strength session")}` }], "floor") : null,
      to_target_text:
        open && !target_reached
          ? joinNeeds(
              [
                { n: sNeed, text: plural(sNeed, "more strength session") },
                { n: cNeed, text: plural(cNeed, "cardio session") },
              ],
              "target",
            )
          : null,
    };
  });

  // Streak.
  let weeks_without_zero = 0;
  let floor_weeks = 0;
  let target_weeks = 0;
  let zero_weeks = 0;
  let repairs_used = 0;
  let run = 0;
  let best_run = 0;
  wc.weeks.forEach((w, i) => {
    const ws = weeks[i]!;
    if (w.is_complete) {
      if (!w.is_zero) weeks_without_zero += 1;
      else {
        zero_weeks += 1;
        if (w.repaired) {
          weeks_without_zero += 1;
          repairs_used += 1;
        }
      }
      run = !w.is_zero || w.repaired ? run + 1 : 0;
    } else if (w.counted) {
      weeks_without_zero += 1;
      run += 1;
    }
    if (ws.floor_reached) floor_weeks += 1;
    if (ws.target_reached) target_weeks += 1;
    best_run = Math.max(best_run, run);
  });

  const currentState = weeks[weeks.length - 1]!;
  const curTw = wc.current.tw;

  // Dots: one per training week.
  const dots: DotState[] = [];
  for (let t = 1; t <= program.block_weeks; t++) {
    let last: WeekState | undefined;
    for (const ws of weeks) if (ws.training_week === t && !ws.is_zero) last = ws;
    if (last) {
      if (last.status === "target" || last.status === "floor" || last.status === "below_floor") dots.push(last.status);
      else dots.push("current");
    } else dots.push(t === curTw ? "current" : "future");
  }

  const phase = phaseForWeek(program, config, curTw, deloadWeeks);
  const block: BlockState = {
    block_number: n.settings.block_number,
    block_start_date: n.settings.block_start_date,
    training_week: curTw,
    block_weeks: program.block_weeks,
    phase: phase.name as PhaseName,
    phase_label: phase.label,
    complete: curTw > program.block_weeks,
    extension_weeks: wc.extension,
    dots,
    reactive_deload_used: reactiveWeeks.length > 0,
    deload_week: reactiveWeeks[reactiveWeeks.length - 1] ?? config.deload.planned_week,
  };

  return {
    weeks,
    current: currentState,
    streak: { weeks_without_zero, floor_weeks, target_weeks, zero_weeks, repairs_used, current_run: run, best_run },
    block,
  };
}
