/**
 * Body and fuel: weight trend, calorie / protein / steps targets, pace and the weekly adaptive calorie
 * adjustment. Pure and deterministic like the rest of the engine: `now` comes in, nothing is read from the clock.
 * Semantics: docs/ENGINE_RULES.md section 10. Every threshold comes from config.body.
 */
import type { BodyGoal, BodyLog, Decision, EngineConfig, Settings } from "@gym/schema";
import type { BodyInput, BodyMissing, BodyPace, BodyState, BodyTargets, BodyTrendPoint } from "./types";
import { clamp, round2, roundToIncrement } from "./calc";
import { withSettingsDefaults } from "./context";
import { addDays, dayNumber, fromDayNumber, isValidTimeZone, localDate, localMidnightMs, toIso, weekStart } from "./dates";
import { bodyId, makeDecision } from "./decisions";
import { fmtNum } from "./text";

type BodyConfig = EngineConfig["body"];

const DAYS_PER_WEEK = 7;
const VALUE_FIELDS = ["weight_kg", "waist_cm", "steps", "protein_g", "kcal", "sleep_h", "note"] as const;

/** Math.round without a negative zero. */
const whole = (x: number): number => Math.round(x) + 0;

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

// ---------------- copy (plain, no guilt, no dashes as punctuation) ----------------

const MISSING_WORDS: Record<BodyMissing, string> = {
  sex: "sex",
  birth_year: "birth year",
  height_cm: "height",
  weight: "a weigh-in",
};

/** "sex, birth year and height". */
function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const missingWords = (missing: BodyMissing[]) => listWords(missing.map((m) => MISSING_WORDS[m]));

/** Unsigned kg with one decimal ("0.4"); two when one would hide a real change ("0.04"). */
function kgWords(kg: number): string {
  const abs = Math.abs(kg);
  const one = Math.round(abs * 10 + 1e-9) / 10;
  return one === 0 && round2(abs) > 0 ? fmtNum(round2(abs)) : one.toFixed(1);
}

/** "Down 0.4%", "Up 0.2%", "Flat". pct is signed percent of body weight, negative = losing. */
function changeWords(pct: number): string {
  if (pct === 0) return "Flat";
  return `${pct < 0 ? "Down" : "Up"} ${fmtNum(Math.abs(pct))}%`;
}

// ---------------- inputs ----------------

/**
 * Settings with the body defaults filled in. Rows stored before the body fields existed take the rate and the
 * steps target from config; the cut rate is held inside the configured range.
 */
function bodySettings(raw: Settings, cfg: BodyConfig): Settings {
  const s = withSettingsDefaults({
    ...raw,
    cut_rate_pct: raw.cut_rate_pct ?? cfg.cut_rate.default_pct,
    steps_target: raw.steps_target ?? cfg.steps_target_default,
  });
  // A stored 0 is "not set", not a target of nothing.
  const positive = (n: number | null) => (n != null && n > 0 ? n : null);
  return {
    ...s,
    cut_rate_pct: clamp(s.cut_rate_pct, cfg.cut_rate.min_pct, cfg.cut_rate.max_pct),
    kcal_override: positive(s.kcal_override),
    protein_override_g: positive(s.protein_override_g),
  };
}

const hasData = (l: BodyLog) => VALUE_FIELDS.some((f) => l[f] != null);

/** Live rows up to today, one per date (the newest write wins), oldest first. Rows without any value are dropped. */
function usableLogs(logs: BodyLog[], today: string): BodyLog[] {
  const byDate = new Map<string, BodyLog>();
  for (const l of logs) {
    if (l.deleted_at != null || l.date > today || !hasData(l)) continue;
    const prev = byDate.get(l.date);
    if (!prev || l.updated_at > prev.updated_at || (l.updated_at === prev.updated_at && l.id > prev.id)) byDate.set(l.date, l);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------- trend ----------------

interface DayPoint {
  day: number;
  weight: number | null;
  avg: number | null;
  /** Mean day number of the weigh-ins behind avg: where in time the average really sits. */
  center: number | null;
}

/** One point per calendar day from the first log through today, with the trailing mean of the trend window. */
function buildTrend(logs: BodyLog[], today: string, cfg: BodyConfig): DayPoint[] {
  const first = logs[0];
  if (!first) return [];
  const weights = new Map<number, number>();
  for (const l of logs) if (l.weight_kg != null) weights.set(dayNumber(l.date), l.weight_kg);
  const out: DayPoint[] = [];
  const last = dayNumber(today);
  for (let day = dayNumber(first.date); day <= last; day++) {
    const inWindow: number[] = [];
    const days: number[] = [];
    for (let d = day - cfg.trend.window_days + 1; d <= day; d++) {
      const w = weights.get(d);
      if (w == null) continue;
      inWindow.push(w);
      days.push(d);
    }
    const enough = inWindow.length >= cfg.trend.min_weigh_ins;
    out.push({
      day,
      weight: weights.get(day) ?? null,
      avg: enough ? round2(mean(inWindow)) : null,
      center: enough ? mean(days) : null,
    });
  }
  return out;
}

/**
 * Weekly rate from the trend: today's trend value against the trend value closest to span_days ago,
 * at least min_span_days back, scaled to a week. The days between the two are counted from where the
 * averages really sit (the mean day of their weigh-ins), so a half filled window does not read as a slower
 * rate. null without a current trend or without a value whose weigh-ins lie min_span_days back.
 */
function trendRate(trend: DayPoint[], cfg: BodyConfig): { kg: number; pct: number } | null {
  const now = trend[trend.length - 1];
  if (!now || now.avg == null || now.center == null) return null;
  for (let back = cfg.rate.span_days; back >= cfg.rate.min_span_days; back--) {
    const ref = trend[trend.length - 1 - back];
    if (!ref || ref.avg == null || ref.center == null) continue;
    const gap = now.center - ref.center;
    if (gap < cfg.rate.min_span_days) continue;
    const kg = round2(((now.avg - ref.avg) / gap) * DAYS_PER_WEEK);
    return { kg, pct: round2((kg / ref.avg) * 100) };
  }
  return null;
}

// ---------------- weekly adaptive adjustment ----------------

interface WeekData {
  weights: number[];
  proteinDays: number;
  /** Mean day number of the weigh-ins (0 without any): three weigh-ins late in the week sit late in the week. */
  meanDay: number;
}

function weekData(byDate: Map<string, BodyLog>, monday: string): WeekData {
  const weights: number[] = [];
  const days: number[] = [];
  let proteinDays = 0;
  const first = dayNumber(monday);
  for (let i = 0; i < DAYS_PER_WEEK; i++) {
    const l = byDate.get(addDays(monday, i));
    if (!l) continue;
    if (l.weight_kg != null) {
      weights.push(l.weight_kg);
      days.push(first + i);
    }
    if (l.protein_g != null && l.protein_g > 0) proteinDays++;
  }
  return { weights, proteinDays, meanDay: days.length ? mean(days) : 0 };
}

/** What one week asks for: the raw step (before the total bound) and the sentence up to the colon. */
function weekVerdict(goal: BodyGoal, changePct: number, cutRatePct: number, cfg: BodyConfig): { raw: number; lead: string } | null {
  const step = cfg.adjustment.step_kcal;
  const tol = cfg.adjustment.tolerance_pct;
  const change = changeWords(changePct);
  if (goal === "cut") {
    const loss = -changePct;
    if (loss > cfg.cut_rate.max_pct) return { raw: step, lead: `${change} a week, faster than the ${fmtNum(cfg.cut_rate.max_pct)}% limit` };
    if (loss < round2(cutRatePct - tol)) {
      return { raw: -step, lead: `${change} ${changePct === 0 ? "this week" : "a week"} against a ${fmtNum(cutRatePct)}% goal${changePct > 0 ? " down" : ""}` };
    }
    return null;
  }
  if (goal === "gain") {
    if (changePct > cfg.gain_rate.max_pct) return { raw: -step, lead: `${change} a week, faster than the ${fmtNum(cfg.gain_rate.max_pct)}% limit` };
    if (changePct < round2(cfg.gain_rate.target_pct - tol)) {
      return {
        raw: step,
        lead: `${change} ${changePct === 0 ? "this week" : "a week"} against a ${fmtNum(cfg.gain_rate.target_pct)}% goal${changePct < 0 ? " up" : ""}`,
      };
    }
    return null;
  }
  // recomp: the goal is to hold weight.
  if (changePct > tol) return { raw: -step, lead: `${change} a week while holding weight` };
  if (changePct < -tol) return { raw: step, lead: `${change} a week while holding weight` };
  return null;
}

/**
 * Replays the completed calendar weeks since the first log. A week counts when it and the week before both
 * have enough weigh-ins, far enough apart, and the week has protein logged on enough days. Each applied step
 * is a Decision.
 *
 * The change between two weeks is scaled to seven days from where the weigh-ins really sit, so a week weighed
 * only at its end is not read as a slow week.
 *
 * A changed goal or pace (settings.body_adjust_since) never re-judges the past: weeks that started before that
 * date are skipped and the correction earned until then (settings.body_adjust_base_kcal) is carried over.
 */
function replayAdjustments(
  config: EngineConfig,
  settings: Settings,
  logs: BodyLog[],
  today: string,
  tz: string,
): { total: number; decisions: Decision[] } {
  const cfg = config.body;
  const first = logs[0];
  const decisions: Decision[] = [];
  const max = cfg.adjustment.max_total_kcal;
  const since = settings.body_adjust_since;
  let total = since != null ? clamp(settings.body_adjust_base_kcal, -max, max) : 0;
  if (!first) return { total, decisions };
  const byDate = new Map(logs.map((l) => [l.date, l]));

  // The first week has no week before it, so the replay starts at the second.
  for (let monday = addDays(weekStart(first.date), DAYS_PER_WEEK); addDays(monday, DAYS_PER_WEEK - 1) < today; monday = addDays(monday, DAYS_PER_WEEK)) {
    // Judged against the goal of its time and already counted in the carried over correction.
    if (since != null && monday < since) continue;
    const week = weekData(byDate, monday);
    const prev = weekData(byDate, addDays(monday, -DAYS_PER_WEEK));
    if (week.weights.length < cfg.adjustment.min_weigh_ins || prev.weights.length < cfg.adjustment.min_weigh_ins) continue;
    if (week.proteinDays < cfg.adjustment.min_protein_days) continue;
    const gapDays = week.meanDay - prev.meanDay;
    if (gapDays < cfg.adjustment.min_gap_days) continue;

    const weekMean = mean(week.weights);
    const prevMean = mean(prev.weights);
    const changePct = round2((((weekMean - prevMean) / prevMean) * 100 * DAYS_PER_WEEK) / gapDays);
    const verdict = weekVerdict(settings.goal, changePct, settings.cut_rate_pct, cfg);
    if (!verdict) continue;
    const applied = clamp(total + verdict.raw, -max, max) - total;
    if (applied === 0) continue;
    total += applied;

    decisions.push(
      makeDecision(
        { config },
        {
          id: bodyId("kcal", monday),
          // The Monday after the week: the moment the change starts to apply.
          date: toIso(localMidnightMs(addDays(monday, DAYS_PER_WEEK), tz)),
          rule_id: applied < 0 ? "body.adjust_less" : "body.adjust_more",
          inputs: {
            week_start: monday,
            goal: settings.goal,
            cut_rate_pct: settings.cut_rate_pct,
            weigh_ins: week.weights.length,
            weigh_ins_before: prev.weights.length,
            protein_days: week.proteinDays,
            mean_kg: round2(weekMean),
            mean_before_kg: round2(prevMean),
            gap_days: round2(gapDays),
            change_pct: changePct,
          },
          output: { delta_kcal: applied, total_kcal: total },
          explanation: `${verdict.lead}: ${fmtNum(Math.abs(applied))} kcal ${applied < 0 ? "less" : "more"}.`,
        },
      ),
    );
  }
  return { total, decisions };
}

// ---------------- targets ----------------

interface TargetsResult {
  targets: BodyTargets;
  /** The engine's own calorie target (after the floor), also when an override wins. */
  estimate_kcal: number | null;
  floor_applied: boolean;
}

function buildTargets(
  cfg: BodyConfig,
  settings: Settings,
  weight: number | null,
  today: string,
  missing: BodyMissing[],
  adjustments: number,
): TargetsResult {
  const { sex, birth_year, height_cm, goal } = settings;
  const age = birth_year != null ? Number(today.slice(0, 4)) - birth_year : null;

  let maintenance: number | null = null;
  if (sex != null && age != null && height_cm != null && weight != null) {
    const m = cfg.mifflin;
    const bmr = m.per_kg * weight + m.per_cm * height_cm - m.per_year * age + (sex === "male" ? m.male_offset : m.female_offset);
    maintenance = whole(bmr * cfg.activity_factor[settings.job_activity]);
  }

  let offset: number;
  if (goal === "cut") offset = weight != null ? whole((-(settings.cut_rate_pct / 100) * weight * cfg.kcal_per_kg_fat) / DAYS_PER_WEEK) : 0;
  else offset = goal === "recomp" ? cfg.recomp_offset_kcal : cfg.gain_offset_kcal;

  let estimate: number | null = null;
  let floorApplied = false;
  if (maintenance != null && sex != null) {
    estimate = roundToIncrement(maintenance + offset + adjustments, cfg.kcal_round_to);
    const floor = cfg.kcal_floor[sex];
    if (estimate < floor) {
      estimate = floor;
      floorApplied = true;
    }
  }

  const proteinEstimate = weight != null ? roundToIncrement(cfg.protein.g_per_kg * weight, cfg.protein.round_to_g) : null;
  const kcal = settings.kcal_override ?? estimate;
  const protein = settings.protein_override_g ?? proteinEstimate;
  const fatMin = weight != null ? roundToIncrement(cfg.fat.min_g_per_kg * weight, cfg.fat.round_to_g) : null;

  // The sentence for the engine's own calorie target.
  let own: string | null = null;
  if (estimate != null && maintenance != null) {
    if (floorApplied) own = `Held at the ${fmtNum(estimate)} kcal floor, the estimate came out lower`;
    else {
      const amount = fmtNum(Math.abs(offset));
      const goalPart =
        goal === "cut"
          ? `minus ${amount} to lose ${fmtNum(settings.cut_rate_pct)}% a week`
          : goal === "gain"
            ? `${offset < 0 ? "minus" : "plus"} ${amount} to gain slowly`
            : offset === 0
              ? "held there for a recomp"
              : `${offset < 0 ? "minus" : "plus"} ${amount} for a slow recomp`;
      const trendPart = adjustments === 0 ? "" : `, ${adjustments < 0 ? "minus" : "plus"} ${fmtNum(Math.abs(adjustments))} from your trend`;
      own = `About ${fmtNum(maintenance)} kcal to hold weight, ${goalPart}${trendPart}`;
    }
  }
  const setup = `Add ${missingWords(missing)} to get a calorie target`;

  let rule_id: string;
  let reason: string;
  if (settings.kcal_override != null && settings.protein_override_g != null) {
    rule_id = "body.overrides";
    reason = `Your own targets: ${fmtNum(settings.kcal_override)} kcal and ${fmtNum(settings.protein_override_g)} g protein.`;
  } else if (settings.kcal_override != null) {
    rule_id = "body.kcal_override";
    reason = estimate != null ? `Your own calorie target, the estimate is ${fmtNum(estimate)} kcal.` : "Your own calorie target.";
  } else if (settings.protein_override_g != null) {
    rule_id = "body.protein_override";
    reason = own != null ? `${own}, with your own protein target.` : `${setup}, protein is your own target.`;
  } else if (own == null) {
    rule_id = "body.setup";
    reason = `${setup}.`;
  } else {
    rule_id = floorApplied ? "body.kcal_floor" : `body.${goal}`;
    reason = `${own}.`;
  }

  return {
    targets: {
      kcal,
      protein_g: protein,
      fat_min_g: fatMin,
      steps: settings.steps_target,
      maintenance_kcal: maintenance,
      goal_offset_kcal: offset,
      adjustments_kcal: adjustments,
      rule_id,
      reason,
    },
    estimate_kcal: estimate,
    floor_applied: floorApplied,
  };
}

// ---------------- pace ----------------

function paceOf(
  cfg: BodyConfig,
  settings: Settings,
  missing: BodyMissing[],
  rate: { kg: number; pct: number } | null,
  trendIsCurrent: boolean,
  weight: number | null,
): { pace: BodyPace; text: string } {
  if (missing.length > 0) return { pace: "setup", text: `Add ${missingWords(missing)} to set your targets.` };
  if (!rate) {
    return {
      pace: "collecting",
      text: trendIsCurrent ? "Trend started. Keep weighing in to see your pace." : "Weigh in a few mornings to see your trend.",
    };
  }
  const tol = cfg.pace.tolerance_pct;
  const kg = kgWords(rate.kg);
  const steady = Number(kg) === 0;
  const moving = `${rate.kg < 0 ? "Down" : "Up"} ${kg} kg a week`;
  const goalKg = (pct: number) => kgWords((pct / 100) * (weight ?? 0));

  if (settings.goal === "recomp") {
    if (Math.abs(rate.pct) <= tol) return { pace: "on_pace", text: "On pace: weight is holding steady." };
    return { pace: "off_goal", text: `${moving}. Recomp aims to hold weight.` };
  }

  const cut = settings.goal === "cut";
  // Progress toward the goal, in percent of body weight a week.
  const toward = cut ? -rate.pct : rate.pct;
  const target = cut ? settings.cut_rate_pct : cfg.gain_rate.target_pct;
  const max = cut ? cfg.cut_rate.max_pct : cfg.gain_rate.max_pct;
  if (toward > max) return { pace: "fast", text: `${moving}. That is fast, eat a little ${cut ? "more" : "less"}.` };
  if (toward >= round2(target - tol)) {
    return { pace: "on_pace", text: steady ? "On pace: holding steady." : `On pace: ${moving.charAt(0).toLowerCase()}${moving.slice(1)}.` };
  }
  const goalText = `The goal is ${goalKg(target)} kg a week ${cut ? "down" : "up"}.`;
  if (toward >= -tol) return { pace: "slow", text: steady ? `Holding steady. ${goalText}` : `${moving}. ${goalText}` };
  return { pace: "off_goal", text: `${moving}. ${goalText}` };
}

function weeksToGoal(cfg: BodyConfig, settings: Settings, trendWeight: number | null, rateKg: number | null): number | null {
  if (settings.goal_weight_kg == null || trendWeight == null) return null;
  const remaining = round2(settings.goal_weight_kg - trendWeight);
  if (remaining === 0) return 0;
  if (settings.goal === "cut" && remaining > 0) return 0;
  if (settings.goal === "gain" && remaining < 0) return 0;
  if (rateKg == null || rateKg === 0 || Math.sign(rateKg) !== Math.sign(remaining)) return null;
  const weeks = Math.ceil(remaining / rateKg - 1e-9);
  return weeks > cfg.goal.max_weeks ? null : weeks;
}

// ---------------- public ----------------

/** Everything the body and fuel screens need in one call. Pure and deterministic. */
export function computeBody(input: BodyInput): BodyState {
  const { config } = input;
  const cfg = config.body;
  const settings = bodySettings(input.settings, cfg);
  const tz = settings.timezone && isValidTimeZone(settings.timezone) ? settings.timezone : config.timezone_default;
  // Canonical ISO (with ms) so the decision date validates against the schema.
  const nowIso = toIso(Date.parse(input.now));
  const today = localDate(nowIso, tz);

  const logs = usableLogs(input.bodyLogs, today);
  const byDate = new Map(logs.map((l) => [l.date, l]));
  const weighIns = logs.filter((l) => l.weight_kg != null);
  const latestWeighIn = weighIns[weighIns.length - 1] ?? null;
  const latestWeight = latestWeighIn?.weight_kg ?? null;

  const trend = buildTrend(logs, today, cfg);
  const withAvg = trend.filter((p) => p.avg != null);
  const firstTrend = withAvg[0] ?? null;
  const lastTrend = withAvg[withAvg.length - 1] ?? null;
  const trendWeight = lastTrend?.avg ?? null;
  const startWeight = firstTrend?.avg ?? weighIns[0]?.weight_kg ?? null;
  const trendIsCurrent = trend[trend.length - 1]?.avg != null;
  // The trend when it is at least as recent as the last weigh-in, else that weigh-in.
  const currentIsTrend = lastTrend != null && latestWeighIn != null && lastTrend.day >= dayNumber(latestWeighIn.date);
  const currentWeight = currentIsTrend ? trendWeight : latestWeight;
  const rate = trendRate(trend, cfg);

  const missing: BodyMissing[] = [];
  if (settings.sex == null) missing.push("sex");
  if (settings.birth_year == null) missing.push("birth_year");
  if (settings.height_cm == null) missing.push("height_cm");
  if (latestWeight == null) missing.push("weight");

  const adjustments = replayAdjustments(config, settings, logs, today, tz);
  const { targets, estimate_kcal, floor_applied } = buildTargets(cfg, settings, currentWeight, today, missing, adjustments.total);
  const targetsDecision = makeDecision(
    { config },
    {
      id: bodyId("targets"),
      date: nowIso,
      rule_id: targets.rule_id,
      inputs: {
        date: today,
        weight_kg: currentWeight,
        sex: settings.sex,
        birth_year: settings.birth_year,
        height_cm: settings.height_cm,
        job_activity: settings.job_activity,
        goal: settings.goal,
        cut_rate_pct: settings.cut_rate_pct,
        kcal_override: settings.kcal_override,
        protein_override_g: settings.protein_override_g,
      },
      output: {
        kcal: targets.kcal,
        protein_g: targets.protein_g,
        fat_min_g: targets.fat_min_g,
        steps: targets.steps,
        maintenance_kcal: targets.maintenance_kcal,
        goal_offset_kcal: targets.goal_offset_kcal,
        adjustments_kcal: targets.adjustments_kcal,
        estimate_kcal,
        floor_applied,
      },
      explanation: targets.reason,
    },
  );

  const { pace, text: paceText } = paceOf(cfg, settings, missing, rate, trendIsCurrent, currentWeight);

  // Today.
  const logToday = byDate.get(today) ?? null;
  const proteinToday = logToday?.protein_g ?? 0;
  const stepsToday = logToday?.steps ?? 0;
  const proteinNeeded = targets.protein_g != null ? round2((1 - cfg.protein.hit_tolerance) * targets.protein_g) : null;
  const proteinReached = (grams: number | null | undefined) =>
    grams != null && (proteinNeeded != null ? grams >= proteinNeeded : grams > 0);

  // Waist.
  const waists = logs.filter((l) => l.waist_cm != null);
  const firstWaist = waists[0];
  const lastWaist = waists[waists.length - 1];
  const waist =
    firstWaist && lastWaist
      ? {
          latest: lastWaist.waist_cm!,
          first: firstWaist.waist_cm!,
          change_cm: round2(lastWaist.waist_cm! - firstWaist.waist_cm!),
          latest_date: lastWaist.date,
        }
      : null;

  // This week so far.
  const monday = weekStart(today);
  let weekWeighIns = 0;
  let weekProteinDays = 0;
  let weekDaysLogged = 0;
  const weekSteps: number[] = [];
  for (let date = monday; date <= today; date = addDays(date, 1)) {
    const l = byDate.get(date);
    if (!l) continue;
    weekDaysLogged++;
    if (l.weight_kg != null) weekWeighIns++;
    if (proteinReached(l.protein_g)) weekProteinDays++;
    if (l.steps != null) weekSteps.push(l.steps);
  }

  const series: BodyTrendPoint[] = trend
    .slice(-cfg.series_max_days)
    .map((p) => ({ date: fromDayNumber(p.day), weight: p.weight, avg: p.avg }));

  return {
    today,
    profile_complete: missing.length === 0,
    missing,
    log_today: logToday,
    weighed_today: logToday?.weight_kg != null,
    protein_today: proteinToday,
    protein_hit: proteinNeeded != null && proteinToday >= proteinNeeded,
    steps_today: stepsToday,
    steps_hit: stepsToday >= targets.steps,
    kcal_today: logToday?.kcal ?? null,
    latest_weight: latestWeight,
    trend_weight: trendWeight,
    current_weight: currentWeight,
    current_is_trend: currentIsTrend,
    start_weight: startWeight,
    change_kg: trendWeight != null && startWeight != null ? round2(trendWeight - startWeight) : null,
    rate_kg_per_week: rate?.kg ?? null,
    rate_pct_per_week: rate?.pct ?? null,
    pace,
    pace_text: paceText,
    weeks_to_goal: weeksToGoal(cfg, settings, currentWeight, rate?.kg ?? null),
    targets,
    series,
    waist,
    week: {
      start_date: monday,
      weigh_ins: weekWeighIns,
      protein_days: weekProteinDays,
      steps_avg: weekSteps.length ? whole(mean(weekSteps)) : null,
      days_logged: weekDaysLogged,
    },
    decisions: [targetsDecision, ...adjustments.decisions],
  };
}
