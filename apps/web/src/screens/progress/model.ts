/**
 * Progress tab view model. Pure: engine state + context in, chart rows and review lines out.
 * Nothing here decides a target; it only arranges what the engine computed.
 */
import { planSession, type EngineContext, type EngineState, type Flag, type WeekState, type WeekVolume } from "@gym/engine";
import type { DayCode, Muscle } from "@gym/schema";
import { shortDate } from "../plan/ui";

export interface MainLift {
  prescription_id: string;
  exercise_id: string;
  name: string;
}

/** program.main_lifts mapped to the exercise in effect (limitation swap included), via the engine's plan. */
export function mainLifts(ctx: EngineContext): MainLift[] {
  const plans = new Map<DayCode, ReturnType<typeof planSession> | null>();
  return ctx.program.main_lifts.map((pid) => {
    const day = ctx.program.days.find((d) => d.prescriptions.some((p) => p.id === pid));
    const pres = day?.prescriptions.find((p) => p.id === pid);
    let plan = day ? plans.get(day.code) : null;
    if (day && plan === undefined) {
      try {
        plan = planSession(ctx, { code: day.code, mode: "full" });
      } catch {
        plan = null;
      }
      plans.set(day.code, plan);
    }
    const pe = plan?.exercises.find((e) => e.prescription_id === pid);
    const exercise_id = pe?.exercise_id ?? pres?.exercise_id ?? pid;
    return { prescription_id: pid, exercise_id, name: pe?.name ?? ctx.exercises[exercise_id]?.name ?? exercise_id };
  });
}

export interface ChartWeek {
  week_id: string;
  label: string; // "9 Nov"
  training_week: number;
  is_zero: boolean;
  is_current: boolean;
}

export interface E1rmSeries {
  exercise_id: string;
  name: string;
  points: { date: string; label: string; e1rm: number }[];
  first: number | null;
  latest: number | null;
}

export interface CardioRow extends ChartWeek {
  cardio: number; // moderate equivalent minutes from cardio sessions (hard counts double)
  walking: number;
  total: number;
  target: number;
}

export interface CheckinRow extends ChartWeek {
  avg: number | null;
}

export interface VolumeRow extends ChartWeek {
  by_muscle: Partial<Record<Muscle, number>>;
  band: { min: number; max: number } | null;
}

export interface ChartData {
  e1rm: E1rmSeries[];
  volume: { muscles: Muscle[]; band: { min: number; max: number }; rows: VolumeRow[] };
  cardio: CardioRow[];
  checkin: CheckinRow[];
  /** Any finished history at all (first days: none). */
  has_history: boolean;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function chartWeek(w: WeekState): ChartWeek {
  return { week_id: w.id, label: shortDate(w.start_date), training_week: w.training_week, is_zero: w.status === "zero", is_current: w.is_current };
}

/** Rows for the four charts. Weeks follow state.weeks (calendar weeks from block start). */
export function buildChartData(state: EngineState, ctx: EngineContext, lifts: MainLift[]): ChartData {
  const volByWeek = new Map<string, WeekVolume>(state.volume.map((v) => [v.week_id, v]));
  const weeks = state.weeks.filter((w) => w.start_date <= state.today || w.is_current);
  const e1rm: E1rmSeries[] = lifts.map((l) => {
    const st = state.stats[l.exercise_id];
    const points = (st?.history ?? []).filter((p) => p.e1rm > 0).map((p) => ({ date: p.date, label: shortDate(p.date), e1rm: round1(p.e1rm) }));
    return {
      exercise_id: l.exercise_id,
      name: l.name,
      points,
      first: points[0]?.e1rm ?? null,
      latest: points[points.length - 1]?.e1rm ?? null,
    };
  });
  const cardio: CardioRow[] = weeks.map((w) => {
    const v = volByWeek.get(w.id);
    const total = round1(v?.who_minutes ?? 0);
    const walking = Math.min(total, w.walking_minutes);
    return { ...chartWeek(w), cardio: round1(Math.max(0, total - walking)), walking, total, target: v?.who_target ?? ctx.config.who.weekly_minutes };
  });
  const checkin: CheckinRow[] = weeks.map((w) => ({ ...chartWeek(w), avg: volByWeek.get(w.id)?.checkin_avg ?? null }));
  const volume = {
    muscles: ctx.config.volume.tracked_muscles,
    band: { min: ctx.config.volume.band_min, max: ctx.config.volume.band_max },
    rows: weeks.map((w) => ({ ...chartWeek(w), by_muscle: volByWeek.get(w.id)?.by_muscle ?? {}, band: volByWeek.get(w.id)?.band ?? null })),
  };
  return { e1rm, volume, cardio, checkin, has_history: state.totals.sessions > 0 || state.totals.walking_minutes > 0 };
}

// ---------- headline numbers ----------

export interface VolumeSummary {
  band: { min: number; max: number } | null;
  in_band: number;
  below: number;
  above: number;
  muscles: number;
  average: number;
}

export function volumeSummary(state: EngineState, ctx: EngineContext): VolumeSummary {
  const v = state.volume.find((x) => x.week_id === state.current_week.id);
  const muscles = ctx.config.volume.tracked_muscles;
  const vals = muscles.map((m) => v?.by_muscle[m] ?? 0);
  const band = v?.band ?? null;
  return {
    band,
    in_band: band ? vals.filter((x) => x >= band.min && x <= band.max).length : 0,
    below: band ? vals.filter((x) => x < band.min).length : 0,
    above: band ? vals.filter((x) => x > band.max).length : 0,
    muscles: muscles.length,
    average: vals.length ? round1(vals.reduce((a, b) => a + b, 0) / vals.length) : 0,
  };
}

/** Average e1RM change since the first session across main lifts with 2+ points, as a fraction (0.08 = +8%). */
export function e1rmTrend(series: E1rmSeries[]): { pct: number | null; lifts: number } {
  const moved = series.filter((s) => s.points.length >= 2 && s.first && s.latest != null);
  if (!moved.length) return { pct: null, lifts: 0 };
  const pct = moved.reduce((t, s) => t + (s.latest! - s.first!) / s.first!, 0) / moved.length;
  return { pct, lifts: moved.length };
}

// ---------- flags ----------

export interface FlagGroups {
  /** Everything but volume, newest first. */
  items: Flag[];
  /** volume_low / volume_high folded into one quiet line. */
  volume: Flag[];
}

export function groupFlags(flags: Flag[]): FlagGroups {
  const sorted = [...flags].sort((a, b) => b.date.localeCompare(a.date));
  return {
    items: sorted.filter((f) => f.kind !== "volume_low" && f.kind !== "volume_high"),
    volume: sorted.filter((f) => f.kind === "volume_low" || f.kind === "volume_high"),
  };
}

/** "Volume outside the band: 2 low, 1 high." */
export function volumeLine(volume: Flag[]): string | null {
  if (!volume.length) return null;
  const low = volume.filter((f) => f.kind === "volume_low").length;
  const high = volume.length - low;
  const parts = [low ? `${low} low` : null, high ? `${high} high` : null].filter(Boolean);
  return `Volume outside the band: ${parts.join(", ")}. Worth a look, nothing urgent.`;
}

export const FLAG_CAPTION: Record<Flag["kind"], string> = {
  stall: "Stall",
  reactive_deload: "Easy week",
  deload_criteria_met: "Recovery",
  below_range: "Below range",
  readiness_trend: "Readiness",
  pain: "Pain",
  volume_low: "Volume",
  volume_high: "Volume",
};

// ---------- Sunday review ----------

export interface MovedUp {
  decision_id: string;
  exercise_id: string;
  name: string;
  /** kg added (new base − load logged), null when the decision does not say. */
  delta: number | null;
  /** The engine's one line, e.g. "Bench press +2.5 kg: all sets hit 8 reps at RIR 2." */
  text: string;
  main_lift: boolean;
}

const UP_RULES = new Set(["dp.increase", "dp.large_jump"]);

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Exercises whose load went up from sessions in this week (decisions dp.increase / dp.large_jump).
 * One line per exercise (the newest), main lifts first, then in decision order.
 */
export function movedUp(state: EngineState, ctx: EngineContext, week: WeekState, mainLiftIds: readonly string[] = []): MovedUp[] {
  const ids = new Set(week.session_ids);
  const mains = new Set(mainLiftIds);
  const seen = new Map<string, MovedUp>();
  for (const d of state.decisions) {
    if (!UP_RULES.has(d.rule_id) || !d.session_id || !ids.has(d.session_id) || d.deleted_at) continue;
    const exId = d.exercise_id ?? "";
    const name = ctx.exercises[exId]?.name ?? exId;
    const summary = typeof d.output?.summary === "string" ? (d.output.summary as string) : null;
    const to = num(d.output?.weight);
    const from = num(d.inputs_snapshot?.load);
    seen.delete(exId);
    seen.set(exId, {
      decision_id: d.id,
      exercise_id: exId,
      name,
      delta: to != null && from != null && to > from ? Math.round((to - from) * 100) / 100 : null,
      text: summary ?? `${name}: ${d.explanation}`,
      main_lift: mains.has(exId),
    });
  }
  const list = [...seen.values()];
  return [...list.filter((m) => m.main_lift), ...list.filter((m) => !m.main_lift)];
}

/** Week the review opens on: Sunday → this week; Monday with nothing logged yet → last week; else this week. */
export function defaultReviewWeek(state: EngineState, weekday: number): "this" | "last" {
  const hasLast = state.weeks.length > 1;
  if (weekday === 1 && hasLast && state.current_week.session_ids.length === 0) return "last";
  return "this";
}
