import { describe, expect, test } from "vitest";
import { BODY_LIMITS, Decision, Settings as SettingsSchema } from "@gym/schema";
import type { BodyLog, EngineConfig, Settings } from "@gym/schema";
import { computeBody } from "../../src/index";
import type { BodyState } from "../../src/types";
import { addDays } from "../../src/dates";
import { BLOCK_START, at, config, settings } from "./fixtures";

/** Monday 2026-11-09. */
const START = BLOCK_START;
const day = (n: number) => addDays(START, n);
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Male, born 1986 (40 in 2026), 180 cm, desk job, cutting at 0.5% a week. */
const PROFILE: Partial<Settings> = { sex: "male", birth_year: 1986, height_cm: 180, job_activity: "desk", goal: "cut", cut_rate_pct: 0.5 };
const profile = (over: Partial<Settings> = {}) => settings({ ...PROFILE, ...over });

function log(date: string, o: Partial<BodyLog> = {}): BodyLog {
  return {
    id: `bd_${date}`,
    date,
    weight_kg: null,
    waist_cm: null,
    steps: null,
    protein_g: null,
    kcal: null,
    sleep_h: null,
    note: null,
    updated_at: at(date, "07:00"),
    deleted_at: null,
    ...o,
  };
}

/** One weigh-in a day for `days` days from START, moving perDay kg a day. */
function linear(days: number, start: number, perDay: number, extra: Partial<BodyLog> = {}): BodyLog[] {
  return Array.from({ length: days }, (_, d) => log(day(d), { weight_kg: r2(start + perDay * d), ...extra }));
}

/** Whole weeks from START: every day of week k weighs weights[k], with protein logged. */
function weeks(weights: number[], extra: Partial<BodyLog> = { protein_g: 170 }): BodyLog[] {
  return weights.flatMap((w, k) => Array.from({ length: 7 }, (_, d) => log(day(k * 7 + d), { weight_kg: w, ...extra })));
}

function body(bodyLogs: BodyLog[], today: string, s: Settings = profile(), cfg: EngineConfig = config): BodyState {
  return computeBody({ config: cfg, settings: s, bodyLogs, now: at(today, "12:00") });
}

const withBody = (patch: (b: EngineConfig["body"]) => void): EngineConfig => {
  const next = structuredClone(config);
  patch(next.body);
  return next;
};

describe("empty input", () => {
  test("no logs and no profile: setup, nothing to show, one explained decision", () => {
    const b = body([], day(2), settings());
    expect(b.today).toBe(day(2));
    expect(b.profile_complete).toBe(false);
    expect(b.missing).toEqual(["sex", "birth_year", "height_cm", "weight"]);
    expect(b.log_today).toBeNull();
    expect(b.weighed_today).toBe(false);
    expect([b.protein_today, b.protein_hit, b.steps_today, b.steps_hit, b.kcal_today]).toEqual([0, false, 0, false, null]);
    expect([b.latest_weight, b.trend_weight, b.start_weight, b.change_kg, b.rate_kg_per_week, b.rate_pct_per_week]).toEqual([null, null, null, null, null, null]);
    expect(b.pace).toBe("setup");
    expect(b.pace_text).toBe("Add sex, birth year, height and a weigh-in to set your targets.");
    expect(b.weeks_to_goal).toBeNull();
    expect(b.targets).toEqual({
      kcal: null,
      protein_g: null,
      fat_min_g: null,
      steps: config.body.steps_target_default,
      maintenance_kcal: null,
      goal_offset_kcal: 0,
      adjustments_kcal: 0,
      rule_id: "body.setup",
      reason: "Add sex, birth year, height and a weigh-in to get a calorie target.",
    });
    expect(b.series).toEqual([]);
    expect(b.waist).toBeNull();
    expect(b.week).toEqual({ start_date: START, weigh_ins: 0, protein_days: 0, steps_avg: null, days_logged: 0 });
    expect(b.decisions.map((d) => d.id)).toEqual(["d:body:targets"]);
    expect(Decision.parse(b.decisions[0])).toEqual(b.decisions[0]);
    expect(b.decisions[0]!.explanation).toBe(b.targets.reason);
  });

  test("a profile without a weigh-in still waits for the weight", () => {
    const b = body([], day(0));
    expect(b.missing).toEqual(["weight"]);
    expect(b.pace).toBe("setup");
    expect(b.targets.reason).toBe("Add a weigh-in to get a calorie target.");
    expect(b.targets.kcal).toBeNull();
    // Steps and other logs do not complete the profile.
    expect(body([log(day(0), { steps: 9000 })], day(0)).missing).toEqual(["weight"]);
  });

  test("settings stored before the body fields existed take the defaults", () => {
    const { sex: _s, birth_year: _b, height_cm: _h, job_activity: _j, goal: _g, cut_rate_pct: _c, goal_weight_kg: _gw, kcal_override: _k, protein_override_g: _p, steps_target: _st, ...legacy } = settings();
    const b = body([log(day(0), { weight_kg: 85 })], day(0), legacy as Settings);
    expect(b.missing).toEqual(["sex", "birth_year", "height_cm"]);
    expect(b.targets.steps).toBe(config.body.steps_target_default);
    expect(b.targets.protein_g).toBe(170);
    // Cut at the config default rate: 0.5% of 85 kg through 7700 kcal a kg.
    expect(b.targets.goal_offset_kcal).toBe(-467);
  });
});

describe("targets from a profile", () => {
  test("Mifflin St Jeor × activity factor, minus the cut, rounded to 50", () => {
    const b = body([log(day(0), { weight_kg: 85 })], day(0));
    expect(b.profile_complete).toBe(true);
    expect(b.missing).toEqual([]);
    // BMR = 10 × 85 + 6.25 × 180 − 5 × 40 + 5 = 1780; × 1.4 = 2492. Cut: 0.5% × 85 kg × 7700 / 7 = 467.5.
    expect(b.targets.maintenance_kcal).toBe(2492);
    expect(b.targets.goal_offset_kcal).toBe(-467);
    expect(b.targets.adjustments_kcal).toBe(0);
    expect(b.targets.kcal).toBe(2050);
    expect(b.targets.protein_g).toBe(170);
    expect(b.targets.fat_min_g).toBe(50);
    expect(b.targets.steps).toBe(8000);
    expect(b.targets.rule_id).toBe("body.cut");
    expect(b.targets.reason).toBe("About 2492 kcal to hold weight, minus 467 to lose 0.5% a week.");
    const d = b.decisions[0]!;
    expect(d).toMatchObject({ id: "d:body:targets", rule_id: "body.cut", explanation: b.targets.reason, session_id: null, exercise_id: null });
    expect(d.output).toMatchObject({ kcal: 2050, protein_g: 170, estimate_kcal: 2050, floor_applied: false });
    expect(d.inputs_snapshot).toMatchObject({ weight_kg: 85, sex: "male", goal: "cut", cut_rate_pct: 0.5 });
    expect(d.date).toBe(at(day(0), "12:00"));
    expect(Decision.parse(d)).toEqual(d);
  });

  test("female, on her feet", () => {
    const s = profile({ sex: "female", birth_year: 1990, height_cm: 165, job_activity: "feet" });
    const b = body([log(day(0), { weight_kg: 62 })], day(0), s);
    // BMR = 620 + 1031.25 − 180 − 161 = 1310.25; × 1.6 = 2096.4. Cut: 0.5% × 62 × 7700 / 7 = 341.
    expect(b.targets.maintenance_kcal).toBe(2096);
    expect(b.targets.goal_offset_kcal).toBe(-341);
    expect(b.targets.kcal).toBe(1750);
    expect(b.targets.protein_g).toBe(125);
    expect(b.targets.fat_min_g).toBe(35);
  });

  test("activity factor per job, steps target from settings", () => {
    const one = [log(day(0), { weight_kg: 85 })];
    expect(body(one, day(0), profile({ job_activity: "feet" })).targets.maintenance_kcal).toBe(Math.round(1780 * config.body.activity_factor.feet));
    expect(body(one, day(0), profile({ job_activity: "physical" })).targets.maintenance_kcal).toBe(Math.round(1780 * config.body.activity_factor.physical));
    expect(body(one, day(0), profile({ steps_target: 10000 })).targets.steps).toBe(10000);
  });

  test("age is the year of now minus the birth year", () => {
    const one = [log(day(0), { weight_kg: 85 })];
    const later = computeBody({ config, settings: profile(), bodyLogs: one, now: "2028-03-01T12:00:00.000Z" });
    // Two years older: 10 kcal less BMR.
    expect(later.targets.maintenance_kcal).toBe(Math.round(1770 * 1.4));
  });

  test("cut rate scales the offset; recomp and gain use the fixed offsets", () => {
    const one = [log(day(0), { weight_kg: 85 })];
    const fast = body(one, day(0), profile({ cut_rate_pct: 1.0 }));
    expect(fast.targets.goal_offset_kcal).toBe(-935);
    expect(fast.targets.kcal).toBe(1550);
    expect(fast.targets.reason).toBe("About 2492 kcal to hold weight, minus 935 to lose 1% a week.");

    const recomp = body(one, day(0), profile({ goal: "recomp" }));
    expect(recomp.targets.goal_offset_kcal).toBe(config.body.recomp_offset_kcal);
    expect(recomp.targets.kcal).toBe(2400);
    expect(recomp.targets.rule_id).toBe("body.recomp");
    expect(recomp.targets.reason).toBe("About 2492 kcal to hold weight, minus 100 for a slow recomp.");

    const gain = body(one, day(0), profile({ goal: "gain" }));
    expect(gain.targets.goal_offset_kcal).toBe(config.body.gain_offset_kcal);
    expect(gain.targets.kcal).toBe(2750);
    expect(gain.targets.rule_id).toBe("body.gain");
    expect(gain.targets.reason).toBe("About 2492 kcal to hold weight, plus 250 to gain slowly.");
  });

  test("a cut rate outside the configured range is held inside it", () => {
    const one = [log(day(0), { weight_kg: 85 })];
    expect(body(one, day(0), profile({ cut_rate_pct: 3 })).targets.goal_offset_kcal).toBe(-935);
    expect(body(one, day(0), profile({ cut_rate_pct: 0.01 })).targets.goal_offset_kcal).toBe(-234);
  });

  test("the trend weight feeds the targets once there is one, else the latest weigh-in", () => {
    const logs = [log(day(0), { weight_kg: 90 }), log(day(1), { weight_kg: 88 }), log(day(2), { weight_kg: 86 })];
    const two = body(logs.slice(0, 2), day(1));
    expect(two.trend_weight).toBeNull();
    expect(two.targets.protein_g).toBe(175); // 2 × 88, latest weigh-in
    const three = body(logs, day(2));
    expect(three.trend_weight).toBe(88);
    expect(three.targets.protein_g).toBe(175); // 2 × 88, trend
    expect(three.decisions[0]!.inputs_snapshot.weight_kg).toBe(88);
  });

  test("every number comes from config", () => {
    const one = [log(day(0), { weight_kg: 85 })];
    const cfg = withBody((b) => {
      b.protein.g_per_kg = 1.6;
      b.fat.min_g_per_kg = 1;
      b.activity_factor.desk = 1.5;
      b.kcal_per_kg_fat = 7000;
      b.kcal_round_to = 10;
    });
    const b = body(one, day(0), profile(), cfg);
    expect(b.targets.protein_g).toBe(135); // 136 → nearest 5
    expect(b.targets.fat_min_g).toBe(85);
    expect(b.targets.maintenance_kcal).toBe(2670);
    expect(b.targets.goal_offset_kcal).toBe(-425);
    expect(b.targets.kcal).toBe(2250); // 2245 → nearest 10
  });
});

describe("floors", () => {
  test("never below the floor for the sex", () => {
    const small = profile({ sex: "female", birth_year: 1960, height_cm: 150, cut_rate_pct: 1.0 });
    const f = body([log(day(0), { weight_kg: 45 })], day(0), small);
    // 1255 maintenance − 495 = 760: far below the floor.
    expect(f.targets.maintenance_kcal).toBe(1255);
    expect(f.targets.kcal).toBe(config.body.kcal_floor.female);
    expect(f.targets.rule_id).toBe("body.kcal_floor");
    expect(f.targets.reason).toBe("Held at the 1200 kcal floor, the estimate came out lower.");
    expect(f.decisions[0]!.output).toMatchObject({ floor_applied: true, estimate_kcal: 1200 });

    const m = body([log(day(0), { weight_kg: 50 })], day(0), profile({ birth_year: 1950, height_cm: 160, cut_rate_pct: 1.0 }));
    expect(m.targets.kcal).toBe(config.body.kcal_floor.male);
    expect(m.targets.rule_id).toBe("body.kcal_floor");
  });

  test("a target above the floor is left alone, and the floor moves with config", () => {
    const one = [log(day(0), { weight_kg: 85 })];
    expect(body(one, day(0)).targets.rule_id).toBe("body.cut");
    const high = withBody((b) => {
      b.kcal_floor.male = 2200;
    });
    const b = body(one, day(0), profile(), high);
    expect(b.targets.kcal).toBe(2200);
    expect(b.targets.rule_id).toBe("body.kcal_floor");
  });
});

describe("overrides", () => {
  const one = [log(day(0), { weight_kg: 85 })];

  test("kcal_override wins and the rule id says so", () => {
    const b = body(one, day(0), profile({ kcal_override: 1900 }));
    expect(b.targets.kcal).toBe(1900);
    expect(b.targets.rule_id).toBe("body.kcal_override");
    expect(b.targets.reason).toBe("Your own calorie target, the estimate is 2050 kcal.");
    // The estimate stays visible.
    expect(b.targets.maintenance_kcal).toBe(2492);
    expect(b.targets.goal_offset_kcal).toBe(-467);
    expect(b.targets.protein_g).toBe(170);
    expect(b.decisions[0]!.output).toMatchObject({ kcal: 1900, estimate_kcal: 2050 });
  });

  test("an override below the floor still wins: it is the user's own number", () => {
    expect(body(one, day(0), profile({ kcal_override: 1300 })).targets.kcal).toBe(1300);
  });

  test("protein_override_g wins and the rule id says so", () => {
    const b = body(one, day(0), profile({ protein_override_g: 150 }));
    expect(b.targets.protein_g).toBe(150);
    expect(b.targets.kcal).toBe(2050);
    expect(b.targets.rule_id).toBe("body.protein_override");
    expect(b.targets.reason).toBe("About 2492 kcal to hold weight, minus 467 to lose 0.5% a week, with your own protein target.");
    // The hit uses the override.
    expect(body([log(day(0), { weight_kg: 85, protein_g: 135 })], day(0), profile({ protein_override_g: 150 })).protein_hit).toBe(true);
  });

  test("both overrides", () => {
    const b = body(one, day(0), profile({ kcal_override: 1900, protein_override_g: 150 }));
    expect([b.targets.kcal, b.targets.protein_g]).toEqual([1900, 150]);
    expect(b.targets.rule_id).toBe("body.overrides");
    expect(b.targets.reason).toBe("Your own targets: 1900 kcal and 150 g protein.");
  });

  test("overrides work before the profile is complete; pace still asks for the profile", () => {
    const k = body([], day(0), settings({ kcal_override: 2000 }));
    expect(k.targets.kcal).toBe(2000);
    expect(k.targets.protein_g).toBeNull();
    expect(k.targets.reason).toBe("Your own calorie target.");
    expect(k.pace).toBe("setup");
    const p = body([], day(0), settings({ protein_override_g: 160 }));
    expect(p.targets.kcal).toBeNull();
    expect(p.targets.protein_g).toBe(160);
    expect(p.targets.rule_id).toBe("body.protein_override");
    expect(p.targets.reason).toBe("Add sex, birth year, height and a weigh-in to get a calorie target, protein is your own target.");
  });
});

describe("trend and rate", () => {
  test("trailing mean over the window, one point per calendar day", () => {
    const b = body(linear(21, 86, -0.06), day(20));
    expect(b.series).toHaveLength(21);
    expect(b.series[0]).toEqual({ date: day(0), weight: 86, avg: null });
    expect(b.series[1]).toEqual({ date: day(1), weight: 85.94, avg: null });
    // Three weigh-ins in the window: the first trend value.
    expect(b.series[2]).toEqual({ date: day(2), weight: 85.88, avg: 85.94 });
    // A full window of 7: mean of days 14..20.
    expect(b.series[20]).toEqual({ date: day(20), weight: 84.8, avg: 84.98 });
    expect(b.latest_weight).toBe(84.8);
    expect(b.trend_weight).toBe(84.98);
    expect(b.start_weight).toBe(85.94);
    expect(b.change_kg).toBe(-0.96);
  });

  test("rate: trend change over the last 14 days scaled to a week, in kg and percent", () => {
    const b = body(linear(21, 86, -0.06), day(20));
    // Trend 14 days ago (day 6) is 85.82: (84.98 − 85.82) / 14 × 7.
    expect(b.rate_kg_per_week).toBe(-0.42);
    expect(b.rate_pct_per_week).toBe(-0.49);
  });

  test("days without a weigh-in keep a point; the trend needs the minimum in its window", () => {
    const logs = [log(day(0), { weight_kg: 86 }), log(day(1), { weight_kg: 85 }), log(day(5), { weight_kg: 84 }), log(day(9), { steps: 4000 })];
    const b = body(logs, day(9));
    expect(b.series.map((p) => p.weight)).toEqual([86, 85, null, null, null, 84, null, null, null, null]);
    // Days 5 and 6 see 86, 85 and 84; from day 7 the window holds fewer than three.
    expect(b.series.map((p) => p.avg)).toEqual([null, null, null, null, null, 85, 85, null, null, null]);
    expect(b.trend_weight).toBe(85);
    expect(b.start_weight).toBe(85);
    expect(b.latest_weight).toBe(84);
    // The last weigh-in is as old as the trend, so the trend still sets the targets.
    expect(b.targets.protein_g).toBe(170);
  });

  test("the first weigh-in is the start weight until a trend exists", () => {
    const b = body([log(day(0), { weight_kg: 86 }), log(day(1), { weight_kg: 85.5 })], day(1));
    expect(b.start_weight).toBe(86);
    expect(b.trend_weight).toBeNull();
    expect(b.change_kg).toBeNull();
    expect(b.series.every((p) => p.avg === null)).toBe(true);
  });

  test("the rate needs trend values far enough apart", () => {
    // 9 days: the trend starts on day 2, today is day 8, six days of trend.
    const short = body(linear(9, 86, -0.06), day(8));
    expect(short.trend_weight).not.toBeNull();
    expect(short.rate_kg_per_week).toBeNull();
    expect(short.pace).toBe("collecting");
    expect(short.pace_text).toBe("Trend started. Keep weighing in to see your pace.");
    // 11 days: the first trend value (days 0 to 2, centered on day 1) sits only six days before today's
    // window (days 4 to 10, centered on day 7). Dividing by the calendar gap read a true 0.42 as 0.3 (D30).
    const close = body(linear(11, 86, -0.06), day(10));
    expect(close.rate_kg_per_week).toBeNull();
    expect(close.pace).toBe("collecting");
    // 12 days: the centers are seven days apart and the rate is the true one, 0.06 kg a day.
    const enough = body(linear(12, 86, -0.06), day(11));
    expect(enough.rate_kg_per_week).toBe(-0.42); // (85.52 − 85.94) / 7 × 7
    expect(enough.pace).not.toBe("collecting");
  });

  test("a stale trend gives no rate; a newer single weigh-in sets the targets", () => {
    const logs = linear(11, 86, 0);
    const stale = body(logs, day(20));
    expect(stale.trend_weight).toBe(86);
    expect(stale.series[20]!.avg).toBeNull();
    expect(stale.rate_kg_per_week).toBeNull();
    expect(stale.pace).toBe("collecting");
    expect(stale.pace_text).toBe("Weigh in a few mornings to see your trend.");
    expect(stale.targets.protein_g).toBe(170); // trend 86 → 172 → 170

    const back = body([...logs, log(day(40), { weight_kg: 90 })], day(40));
    expect(back.latest_weight).toBe(90);
    expect(back.trend_weight).toBe(86);
    expect(back.targets.protein_g).toBe(180);
  });

  test("the series holds at most the configured number of days, the start weight looks further back", () => {
    const logs = linear(200, 95, -0.05);
    const b = body(logs, day(199));
    expect(b.series).toHaveLength(config.body.series_max_days);
    expect(b.series[0]!.date).toBe(day(199 - config.body.series_max_days + 1));
    expect(b.series.at(-1)!.date).toBe(day(199));
    expect(b.start_weight).toBe(94.95);
    expect(b.change_kg).toBe(r2(b.trend_weight! - 94.95));
  });

  test("deleted rows, rows after today and empty rows are ignored; the newest row per date wins", () => {
    const logs = [
      log(day(0), { weight_kg: 86 }),
      log(day(0), { id: "dup", weight_kg: 80, updated_at: at(day(0), "06:00") }),
      log(day(1), { weight_kg: 70, deleted_at: at(day(1), "08:00") }),
      log(day(2)),
      log(day(5), { weight_kg: 60 }),
    ];
    const b = body(logs, day(3));
    expect(b.latest_weight).toBe(86);
    expect(b.series.map((p) => p.weight)).toEqual([86, null, null, null]);
    expect(b.week.days_logged).toBe(1);
  });

  test("today is the local date in the settings timezone, with the config fallback", () => {
    const logs = [log("2026-11-10", { weight_kg: 85, steps: 100 })];
    // 23:30 UTC on Nov 9 is already Nov 10 in Stockholm.
    const late = computeBody({ config, settings: profile(), bodyLogs: logs, now: "2026-11-09T23:30:00.000Z" });
    expect(late.today).toBe("2026-11-10");
    expect(late.weighed_today).toBe(true);
    const ny = computeBody({ config, settings: profile({ timezone: "America/New_York" }), bodyLogs: logs, now: "2026-11-09T23:30:00.000Z" });
    expect(ny.today).toBe("2026-11-09");
    expect(ny.weighed_today).toBe(false);
    expect(ny.latest_weight).toBeNull();
    const bad = computeBody({ config, settings: profile({ timezone: "Not/AZone" }), bodyLogs: logs, now: "2026-11-09T23:30:00Z" });
    expect(bad.today).toBe("2026-11-10");
    expect(bad.decisions[0]!.date).toBe("2026-11-09T23:30:00.000Z");
  });
});

describe("pace", () => {
  const pace = (perDay: number, s: Settings = profile(), cfg: EngineConfig = config) => {
    const b = body(linear(21, 86, perDay), day(20), s, cfg);
    return [b.pace, b.pace_text];
  };

  test("cut", () => {
    expect(pace(-0.06)).toEqual(["on_pace", "On pace: down 0.4 kg a week."]);
    expect(pace(-0.02)).toEqual(["slow", "Down 0.1 kg a week. The goal is 0.4 kg a week down."]);
    expect(pace(0)).toEqual(["slow", "Holding steady. The goal is 0.4 kg a week down."]);
    expect(pace(-0.2)).toEqual(["fast", "Down 1.4 kg a week. That is fast, eat a little more."]);
    expect(pace(0.04)).toEqual(["off_goal", "Up 0.3 kg a week. The goal is 0.4 kg a week down."]);
    // Between the target and the max rate is still on pace.
    expect(pace(-0.11)[0]).toBe("on_pace");
  });

  test("cut: the chosen rate moves the bar", () => {
    // 0.16% a week: slow against 0.5%, on pace against 0.25% (0.25 − 0.15 tolerance).
    expect(pace(-0.02)[0]).toBe("slow");
    expect(pace(-0.02, profile({ cut_rate_pct: 0.25 }))[0]).toBe("on_pace");
    // 0.49% a week is slow against 1%.
    expect(pace(-0.06, profile({ cut_rate_pct: 1.0 }))).toEqual(["slow", "Down 0.4 kg a week. The goal is 0.8 kg a week down."]);
  });

  test("tolerance and max rate come from config", () => {
    const wide = withBody((b) => {
      b.pace.tolerance_pct = 0.4;
    });
    expect(pace(-0.02, profile(), wide)[0]).toBe("on_pace");
    expect(pace(0.04, profile(), wide)[0]).toBe("slow");
    const strict = withBody((b) => {
      b.cut_rate.max_pct = 0.4;
    });
    expect(pace(-0.06, profile({ cut_rate_pct: 0.3 }), strict)[0]).toBe("fast");
  });

  test("recomp: holding weight is the goal", () => {
    const s = profile({ goal: "recomp" });
    expect(pace(0, s)).toEqual(["on_pace", "On pace: weight is holding steady."]);
    expect(pace(-0.01, s)[0]).toBe("on_pace");
    expect(pace(0.04, s)).toEqual(["off_goal", "Up 0.3 kg a week. Recomp aims to hold weight."]);
    expect(pace(-0.04, s)).toEqual(["off_goal", "Down 0.3 kg a week. Recomp aims to hold weight."]);
  });

  test("gain", () => {
    const s = profile({ goal: "gain" });
    expect(pace(0.03, s)).toEqual(["on_pace", "On pace: up 0.2 kg a week."]);
    expect(pace(0.01, s)).toEqual(["slow", "Up 0.1 kg a week. The goal is 0.2 kg a week up."]);
    expect(pace(0, s)).toEqual(["slow", "Holding steady. The goal is 0.2 kg a week up."]);
    expect(pace(0.1, s)).toEqual(["fast", "Up 0.7 kg a week. That is fast, eat a little less."]);
    expect(pace(-0.04, s)).toEqual(["off_goal", "Down 0.3 kg a week. The goal is 0.2 kg a week up."]);
  });

  test("setup wins over data, collecting covers too little data", () => {
    const b = body(linear(21, 86, -0.06), day(20), settings({ sex: "male" }));
    expect(b.pace).toBe("setup");
    expect(b.pace_text).toBe("Add birth year and height to set your targets.");
    // The numbers are still there for the chart.
    expect(b.rate_kg_per_week).toBe(-0.42);
    expect(body(linear(2, 86, 0), day(1)).pace).toBe("collecting");
  });
});

describe("weeks to goal", () => {
  const logs = linear(21, 86, -0.06);

  test("whole weeks at the current rate, when the rate points at the goal", () => {
    // Trend 84.98, losing 0.42 kg a week: 4.98 kg to go.
    expect(body(logs, day(20), profile({ goal_weight_kg: 80 })).weeks_to_goal).toBe(12);
    expect(body(logs, day(20), profile({ goal_weight_kg: 84.56 })).weeks_to_goal).toBe(1);
    expect(body(logs, day(20)).weeks_to_goal).toBeNull();
  });

  test("0 once reached, null when the rate points away, is flat or is too slow to mean anything", () => {
    expect(body(logs, day(20), profile({ goal_weight_kg: 86 })).weeks_to_goal).toBe(0);
    expect(body(logs, day(20), profile({ goal_weight_kg: 84.98 })).weeks_to_goal).toBe(0);
    expect(body(linear(21, 86, 0.04), day(20), profile({ goal_weight_kg: 80 })).weeks_to_goal).toBeNull();
    expect(body(linear(21, 86, 0), day(20), profile({ goal_weight_kg: 80 })).weeks_to_goal).toBeNull();
    // 0.07 kg a week toward 70 kg is far beyond the configured horizon.
    expect(body(linear(21, 86, -0.01), day(20), profile({ goal_weight_kg: 70 })).weeks_to_goal).toBeNull();
    // No rate yet.
    expect(body(linear(3, 86, 0), day(2), profile({ goal_weight_kg: 80 })).weeks_to_goal).toBeNull();
  });

  test("gain counts up", () => {
    const s = profile({ goal: "gain", goal_weight_kg: 88 });
    const b = body(linear(21, 86, 0.03), day(20), s);
    // Trend 86.51, gaining 0.21 kg a week: 1.49 kg to go.
    expect(b.weeks_to_goal).toBe(8);
    expect(body(linear(21, 86, 0.03), day(20), profile({ goal: "gain", goal_weight_kg: 86 })).weeks_to_goal).toBe(0);
  });
});

describe("weekly adaptive adjustment", () => {
  test("cut, slower than the target minus the tolerance: one step less", () => {
    // Week of Nov 9 at 86.0, week of Nov 16 at 85.9: down 0.12% against 0.5%.
    const b = body(weeks([86, 85.9]), day(14));
    expect(b.targets.adjustments_kcal).toBe(-100);
    expect(b.decisions.map((d) => d.id)).toEqual(["d:body:targets", `d:body:kcal:${day(7)}`]);
    const d = b.decisions[1]!;
    expect(d.rule_id).toBe("body.adjust_less");
    expect(d.explanation).toBe("Down 0.12% a week against a 0.5% goal: 100 kcal less.");
    expect(d.output).toEqual({ delta_kcal: -100, total_kcal: -100 });
    expect(d.inputs_snapshot).toMatchObject({ week_start: day(7), weigh_ins: 7, weigh_ins_before: 7, protein_days: 7, mean_kg: 85.9, mean_before_kg: 86, change_pct: -0.12 });
    // Dated the Monday after the week, local midnight in Stockholm.
    expect(d.date).toBe("2026-11-22T23:00:00.000Z");
    expect(Decision.parse(d)).toEqual(d);
    // The target carries it: trend 85.9 → 2505 maintenance − 472 − 100 = 1933, to the nearest 50.
    expect(b.targets.maintenance_kcal).toBe(2505);
    expect(b.targets.kcal).toBe(1950);
    expect(b.targets.reason).toBe("About 2505 kcal to hold weight, minus 472 to lose 0.5% a week, minus 100 from your trend.");
  });

  test("the spec example: down 0.1% against 0.5%", () => {
    const b = body(weeks([100, 99.9]), day(14));
    expect(b.decisions[1]!.explanation).toBe("Down 0.1% a week against a 0.5% goal: 100 kcal less.");
  });

  test("cut, faster than the max rate: one step more", () => {
    const b = body(weeks([86, 84.9]), day(14));
    expect(b.targets.adjustments_kcal).toBe(100);
    expect(b.decisions[1]).toMatchObject({
      rule_id: "body.adjust_more",
      explanation: "Down 1.28% a week, faster than the 1% limit: 100 kcal more.",
      output: { delta_kcal: 100, total_kcal: 100 },
    });
    expect(b.targets.reason).toMatch(/, plus 100 from your trend\.$/);
  });

  test("cut, on pace or between target and max: nothing changes", () => {
    for (const second of [85.6, 85.3, 85.7]) {
      const b = body(weeks([86, second]), day(14));
      expect(b.targets.adjustments_kcal).toBe(0);
      expect(b.decisions).toHaveLength(1);
    }
  });

  test("cut while the weight goes up or stays flat", () => {
    expect(body(weeks([86, 86.3]), day(14)).decisions[1]!.explanation).toBe("Up 0.35% a week against a 0.5% goal down: 100 kcal less.");
    expect(body(weeks([86, 86]), day(14)).decisions[1]!.explanation).toBe("Flat this week against a 0.5% goal: 100 kcal less.");
  });

  test("only completed weeks count", () => {
    const logs = weeks([86, 85.9]);
    expect(body(logs, day(13)).targets.adjustments_kcal).toBe(0); // Sunday of the second week
    expect(body(logs, day(14)).targets.adjustments_kcal).toBe(-100); // Monday after
    expect(body(logs, day(30)).targets.adjustments_kcal).toBe(-100); // later weeks without data add nothing
  });

  test("replays week by week and keeps a running total", () => {
    // slow, slow, on pace, fast.
    const b = body(weeks([86, 85.9, 85.8, 85.4, 84.4]), day(35));
    expect(b.decisions.slice(1).map((d) => [d.id, d.rule_id, d.output.delta_kcal, d.output.total_kcal])).toEqual([
      [`d:body:kcal:${day(7)}`, "body.adjust_less", -100, -100],
      [`d:body:kcal:${day(14)}`, "body.adjust_less", -100, -200],
      [`d:body:kcal:${day(28)}`, "body.adjust_more", 100, -100],
    ]);
    expect(b.targets.adjustments_kcal).toBe(-100);
    // Asked earlier, the replay stops earlier.
    expect(body(weeks([86, 85.9, 85.8, 85.4, 84.4]), day(21)).targets.adjustments_kcal).toBe(-200);
  });

  test("bounded by the max total in both directions", () => {
    const max = config.body.adjustment.max_total_kcal;
    const step = config.body.adjustment.step_kcal;
    const flat = body(weeks(Array.from({ length: 9 }, () => 86)), day(63));
    expect(flat.targets.adjustments_kcal).toBe(-max);
    expect(flat.decisions).toHaveLength(1 + max / step);
    expect(flat.decisions.at(-1)!.output).toEqual({ delta_kcal: -step, total_kcal: -max });

    const dropping = body(weeks(Array.from({ length: 9 }, (_, k) => r2(100 - 1.5 * k))), day(63));
    expect(dropping.targets.adjustments_kcal).toBe(max);
    expect(dropping.decisions).toHaveLength(1 + max / step);

    // A step that would cross the bound is cut to what is left.
    const odd = withBody((b) => {
      b.adjustment.max_total_kcal = 150;
    });
    const clipped = body(weeks([86, 86, 86, 86]), day(28), profile(), odd);
    expect(clipped.decisions.slice(1).map((d) => d.output)).toEqual([
      { delta_kcal: -100, total_kcal: -100 },
      { delta_kcal: -50, total_kcal: -150 },
    ]);
    expect(clipped.decisions[2]!.explanation).toBe("Flat this week against a 0.5% goal: 50 kcal less.");
  });

  test("a week with too few weigh-ins is skipped, and so is the week after it", () => {
    const logs = weeks([86, 86, 86, 86]);
    // Leave two weigh-ins in the week of Nov 16.
    const thin = logs.map((l) => (l.date >= day(9) && l.date <= day(13) ? { ...l, weight_kg: null } : l));
    const b = body(thin, day(28));
    // Week 2 is thin, week 3 has a thin week before it, week 4 counts.
    expect(b.decisions.slice(1).map((d) => d.id)).toEqual([`d:body:kcal:${day(21)}`]);
    expect(b.targets.adjustments_kcal).toBe(-100);
    // Exactly the minimum is enough.
    const min = logs.map((l) => (l.date >= day(10) && l.date <= day(13) ? { ...l, weight_kg: null } : l));
    expect(body(min, day(28)).targets.adjustments_kcal).toBe(-300);
  });

  test("a week with too little protein logged is skipped", () => {
    const need = config.body.adjustment.min_protein_days;
    const logs = weeks([86, 86, 86]);
    const proteinOn = (n: number) => logs.map((l) => (l.date >= day(7 + n) && l.date <= day(13) ? { ...l, protein_g: null } : l));
    const thin = body(proteinOn(need - 1), day(21));
    expect(thin.decisions.slice(1).map((d) => d.id)).toEqual([`d:body:kcal:${day(14)}`]);
    const enough = body(proteinOn(need), day(21));
    expect(enough.decisions.slice(1).map((d) => d.id)).toEqual([`d:body:kcal:${day(7)}`, `d:body:kcal:${day(14)}`]);
    // Logged as zero is not logged.
    const zero = logs.map((l) => (l.date >= day(7) && l.date <= day(13) ? { ...l, protein_g: 0 } : l));
    expect(body(zero, day(21)).decisions.slice(1).map((d) => d.id)).toEqual([`d:body:kcal:${day(14)}`]);
    // No protein logged at all: no adjustments, ever.
    expect(body(weeks([86, 86, 86], {}), day(21)).targets.adjustments_kcal).toBe(0);
  });

  test("recomp: drifting either way is corrected", () => {
    const s = profile({ goal: "recomp" });
    expect(body(weeks([86, 86.3]), day(14), s).decisions[1]).toMatchObject({
      rule_id: "body.adjust_less",
      explanation: "Up 0.35% a week while holding weight: 100 kcal less.",
    });
    expect(body(weeks([86, 85.7]), day(14), s).decisions[1]).toMatchObject({
      rule_id: "body.adjust_more",
      explanation: "Down 0.35% a week while holding weight: 100 kcal more.",
    });
    expect(body(weeks([86, 85.9]), day(14), s).decisions).toHaveLength(1);
  });

  test("gain: slower than the goal adds, faster than the limit takes away", () => {
    const s = profile({ goal: "gain" });
    expect(body(weeks([86, 86]), day(14), s).decisions[1]).toMatchObject({
      rule_id: "body.adjust_more",
      explanation: "Flat this week against a 0.25% goal: 100 kcal more.",
    });
    expect(body(weeks([86, 85.8]), day(14), s).decisions[1]!.explanation).toBe("Down 0.23% a week against a 0.25% goal up: 100 kcal more.");
    expect(body(weeks([86, 86.6]), day(14), s).decisions[1]).toMatchObject({
      rule_id: "body.adjust_less",
      explanation: "Up 0.7% a week, faster than the 0.5% limit: 100 kcal less.",
    });
    expect(body(weeks([86, 86.2]), day(14), s).decisions).toHaveLength(1);
    expect(body(weeks([86, 86.2]), day(14), s).targets.reason).toBe("About 2509 kcal to hold weight, plus 250 to gain slowly.");
  });

  test("step, tolerance and minimums come from config", () => {
    const cfg = withBody((b) => {
      b.adjustment.step_kcal = 50;
      b.adjustment.tolerance_pct = 0.4;
      b.adjustment.min_weigh_ins = 7;
      b.adjustment.min_protein_days = 0;
    });
    // 0.12% a week is inside a 0.4 tolerance (bar at 0.1%).
    expect(body(weeks([86, 85.9]), day(14), profile(), cfg).targets.adjustments_kcal).toBe(0);
    expect(body(weeks([86, 86], {}), day(14), profile(), cfg).targets.adjustments_kcal).toBe(-50);
    const sixDays = weeks([86, 86], {}).filter((l) => l.date !== day(8));
    expect(body(sixDays, day(14), profile(), cfg).targets.adjustments_kcal).toBe(0);
  });

  test("adjustments do not need the profile, and the floor still holds", () => {
    const noProfile = body(weeks([86, 86]), day(14), settings());
    expect(noProfile.targets.adjustments_kcal).toBe(-100);
    expect(noProfile.targets.kcal).toBeNull();

    const small = profile({ sex: "female", birth_year: 1960, height_cm: 150 });
    const floored = body(weeks([48, 48, 48, 48, 48]), day(35), small);
    expect(floored.targets.adjustments_kcal).toBe(-400);
    expect(floored.targets.kcal).toBe(config.body.kcal_floor.female);
    expect(floored.targets.rule_id).toBe("body.kcal_floor");
  });
});

describe("weekly adjustment, honest about time (D30)", () => {
  const fast = { cut_rate_pct: 0.75 };
  /** Whole weeks losing 0.5% a week from 90 kg: on plan for the default pace, slow for the fast one. */
  const onPlan = (n: number) => weeks(Array.from({ length: n }, (_, k) => r2(90 * 0.995 ** k)));

  test("a week weighed only at its end is scaled to seven days, not read as a slow week", () => {
    // Weigh-ins start on the Friday of week 0 and lose a true 0.45% a week (the bar for a 0.5% goal is 0.35%).
    const logs = Array.from({ length: 10 }, (_, i) => log(day(4 + i), { weight_kg: r2(90 - 0.0579 * i), protein_g: 180 }));
    const b = body(logs, day(14));
    // Friday to Sunday against a full week: the two means are five days apart, not seven.
    expect(b.targets.adjustments_kcal).toBe(0);
    expect(b.decisions).toHaveLength(1);
  });

  test("two weeks whose weigh-ins sit too close together are not judged", () => {
    const end = [4, 5, 6].map((d) => log(day(d), { weight_kg: 90, protein_g: 180 }));
    const start = [7, 8, 9, 10].map((d, i) => log(day(d), { weight_kg: i < 3 ? 89 : null, protein_g: 180 }));
    // Three days between the means (under adjustment.min_gap_days): a kilo in three days is noise, not a rate.
    expect(config.body.adjustment.min_gap_days).toBeGreaterThan(3);
    const b = body([...end, ...start], day(14));
    expect(b.targets.adjustments_kcal).toBe(0);
    expect(b.decisions).toHaveLength(1);
  });

  test("a changed pace does not re-judge the weeks before it", () => {
    const logs = onPlan(8);
    expect(body(logs, day(56)).targets.adjustments_kcal).toBe(0);
    // The app marks the day of the change and carries the correction of that moment over.
    const changed = body(logs, day(56), profile({ ...fast, body_adjust_since: day(56), body_adjust_base_kcal: 0 }));
    expect(changed.targets.adjustments_kcal).toBe(0);
    expect(changed.decisions).toHaveLength(1);
    // Same for a changed goal: eight on plan cut weeks are not eight weeks of failed gaining.
    const build = body(logs, day(56), profile({ goal: "gain", body_adjust_since: day(56), body_adjust_base_kcal: 0 }));
    expect(build.targets.adjustments_kcal).toBe(0);
  });

  test("the carried over correction stays and the weeks after the change are judged against the new pace", () => {
    const logs = onPlan(10);
    // Changed on the Monday of week 8: weeks 8 and 9 are fully under the fast pace, 0.5% is slow for it.
    const b = body(logs, day(70), profile({ ...fast, body_adjust_since: day(56), body_adjust_base_kcal: -200 }));
    expect(b.decisions.slice(1).map((d) => [d.id, d.output.delta_kcal, d.output.total_kcal])).toEqual([
      [`d:body:kcal:${day(56)}`, -100, -300],
      [`d:body:kcal:${day(63)}`, -100, -400],
    ]);
    expect(b.targets.adjustments_kcal).toBe(-400);
    // Changed on the Wednesday: week 8 is half old pace, half new, and is left out.
    const mid = body(logs, day(70), profile({ ...fast, body_adjust_since: day(58), body_adjust_base_kcal: -200 }));
    expect(mid.decisions.slice(1).map((d) => d.id)).toEqual([`d:body:kcal:${day(63)}`]);
    expect(mid.targets.adjustments_kcal).toBe(-300);
  });

  test("the carried over correction is held within the bound, and ignored without a change date", () => {
    const max = config.body.adjustment.max_total_kcal;
    const one = [log(day(0), { weight_kg: 85 })];
    expect(body(one, day(0), profile({ body_adjust_since: day(0), body_adjust_base_kcal: -5000 })).targets.adjustments_kcal).toBe(-max);
    expect(body(one, day(0), profile({ body_adjust_since: null, body_adjust_base_kcal: -200 })).targets.adjustments_kcal).toBe(0);
  });

  test("an override of 0 is not a target", () => {
    const one = [log(day(0), { weight_kg: 85 })];
    const plain = body(one, day(0));
    const zero = body(one, day(0), profile({ kcal_override: 0, protein_override_g: 0 }));
    expect(zero.targets.kcal).toBe(plain.targets.kcal);
    expect(zero.targets.protein_g).toBe(plain.targets.protein_g);
    expect(zero.targets.rule_id).toBe("body.cut");
    expect(zero.protein_hit).toBe(false);
  });

  test("the current weight is the single weigh-in after a break, also for the goal", () => {
    const logs = [...linear(11, 86, 0), log(day(40), { weight_kg: 90 })];
    const b = body(logs, day(40), profile({ goal_weight_kg: 87 }));
    expect(b.trend_weight).toBe(86);
    expect(b.current_weight).toBe(90);
    expect(b.current_is_trend).toBe(false);
    // Measured from the old trend the goal would read as reached.
    expect(b.weeks_to_goal).toBeNull();
    const steady = body(linear(11, 86, 0), day(10), profile({ goal_weight_kg: 87 }));
    expect(steady.current_weight).toBe(86);
    expect(steady.current_is_trend).toBe(true);
    expect(steady.weeks_to_goal).toBe(0);
  });
});

describe("today, week and waist", () => {
  test("protein hit uses the tolerance, steps hit the target", () => {
    const hit = (o: Partial<BodyLog>) => body([log(day(0), { weight_kg: 85, ...o })], day(0));
    // Target 170 g, 10% tolerance: 153 g counts.
    expect(hit({ protein_g: 152 }).protein_hit).toBe(false);
    expect(hit({ protein_g: 153 }).protein_hit).toBe(true);
    expect(hit({ protein_g: 153 }).protein_today).toBe(153);
    expect(hit({ steps: 7999 }).steps_hit).toBe(false);
    expect(hit({ steps: 8000 }).steps_hit).toBe(true);
    expect(hit({ steps: 8000 }).steps_today).toBe(8000);
    expect(hit({ kcal: 1980.5 }).kcal_today).toBe(1980.5);
    expect(hit({}).kcal_today).toBeNull();
    const strict = withBody((b) => {
      b.protein.hit_tolerance = 0;
    });
    expect(body([log(day(0), { weight_kg: 85, protein_g: 169 })], day(0), profile(), strict).protein_hit).toBe(false);
    expect(body([log(day(0), { weight_kg: 85, protein_g: 170 })], day(0), profile(), strict).protein_hit).toBe(true);
  });

  test("today's log, and yesterday's numbers do not carry over", () => {
    const logs = [log(day(0), { weight_kg: 85, protein_g: 180, steps: 12000, kcal: 2000 }), log(day(1), { protein_g: 40 })];
    const b = body(logs, day(1));
    expect(b.log_today).toEqual(logs[1]);
    expect(b.weighed_today).toBe(false);
    expect([b.protein_today, b.protein_hit, b.steps_today, b.steps_hit, b.kcal_today]).toEqual([40, false, 0, false, null]);
    expect(body(logs, day(2)).log_today).toBeNull();
    // No protein target without a weight: nothing to hit.
    expect(body([log(day(0), { protein_g: 200 })], day(0), settings()).protein_hit).toBe(false);
  });

  test("the current week so far", () => {
    const logs = [
      log(day(-1), { weight_kg: 86, protein_g: 200, steps: 20000 }), // Sunday before: not this week
      log(day(0), { weight_kg: 85, protein_g: 160, steps: 9000 }),
      log(day(1), { weight_kg: 85, protein_g: 100, steps: 6001 }),
      log(day(2), { note: "long day" }),
      log(day(3), { weight_kg: 85, protein_g: 153 }),
      log(day(4), { weight_kg: 85, protein_g: 170, steps: 5000 }), // tomorrow
    ];
    const b = body(logs, day(3));
    expect(b.week).toEqual({ start_date: day(0), weigh_ins: 3, protein_days: 2, steps_avg: 7501, days_logged: 4 });
    // A new week starts empty.
    expect(body(logs, day(7)).week).toEqual({ start_date: day(7), weigh_ins: 0, protein_days: 0, steps_avg: null, days_logged: 0 });
    // Without a protein target, days with protein logged count.
    expect(body(logs.map((l) => ({ ...l, weight_kg: null })), day(3), settings()).week.protein_days).toBe(3);
  });

  test("waist: first, latest and the change", () => {
    const logs = [log(day(0), { waist_cm: 94 }), log(day(3), { weight_kg: 85 }), log(day(10), { waist_cm: 92.5 }), log(day(30), { waist_cm: 80 })];
    expect(body(logs, day(12)).waist).toEqual({ first: 94, latest: 92.5, change_cm: -1.5, latest_date: day(10) });
    expect(body(logs.slice(0, 1), day(12)).waist).toEqual({ first: 94, latest: 94, change_cm: 0, latest_date: day(0) });
    expect(body(logs.slice(1, 2), day(12)).waist).toBeNull();
  });
});

describe("determinism and copy", () => {
  const scenarios: [string, () => BodyState][] = [
    ["empty", () => body([], day(0), settings())],
    ["collecting", () => body(linear(3, 86, 0), day(2))],
    ["on pace", () => body(linear(21, 86, -0.06), day(20), profile({ goal_weight_kg: 80 }))],
    ["slow", () => body(linear(21, 86, -0.02), day(20))],
    ["fast", () => body(linear(21, 86, -0.2), day(20))],
    ["off goal", () => body(linear(21, 86, 0.04), day(20))],
    ["recomp", () => body(linear(21, 86, 0.04), day(20), profile({ goal: "recomp" }))],
    ["gain", () => body(linear(21, 86, -0.04), day(20), profile({ goal: "gain" }))],
    ["adjusted", () => body(weeks([86, 85.9, 85.8, 85.4, 84.4, 84.5]), day(42))],
    ["recomp adjusted", () => body(weeks([86, 86.4, 86]), day(21), profile({ goal: "recomp" }))],
    ["gain adjusted", () => body(weeks([86, 86, 86.8, 86.5]), day(28), profile({ goal: "gain" }))],
    ["floor", () => body([log(day(0), { weight_kg: 45 })], day(0), profile({ sex: "female", birth_year: 1960, height_cm: 150, cut_rate_pct: 1 }))],
    ["overrides", () => body([log(day(0), { weight_kg: 85 })], day(0), profile({ kcal_override: 1900, protein_override_g: 150 }))],
    ["kcal override", () => body([log(day(0), { weight_kg: 85 })], day(0), profile({ kcal_override: 1900 }))],
    ["protein override", () => body([], day(0), settings({ protein_override_g: 150 }))],
  ];

  test.each(scenarios)("%s: same input, same output", (_name, run) => {
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  test("log order does not matter and the input is not changed", () => {
    const logs = weeks([86, 85.9, 85.8, 85.4]).map((l, i) => ({ ...l, steps: 5000 + i, waist_cm: 90 - i / 10 }));
    const frozen = logs.map((l) => Object.freeze({ ...l }));
    const s = Object.freeze(profile({ goal_weight_kg: 80 }));
    const a = computeBody({ config, settings: s, bodyLogs: frozen, now: at(day(28), "12:00") });
    const reversed = computeBody({ config, settings: s, bodyLogs: [...frozen].reverse(), now: at(day(28), "12:00") });
    const shuffled = computeBody({ config, settings: s, bodyLogs: [...frozen].sort((x, y) => x.updated_at.slice(-7).localeCompare(y.updated_at.slice(-7)) || y.date.localeCompare(x.date)), now: at(day(28), "12:00") });
    expect(reversed).toEqual(a);
    expect(shuffled).toEqual(a);
  });

  test("the time of day does not change the numbers, only the targets decision date", () => {
    const logs = weeks([86, 85.9, 85.8]);
    const morning = computeBody({ config, settings: profile(), bodyLogs: logs, now: at(day(21), "06:00") });
    const evening = computeBody({ config, settings: profile(), bodyLogs: logs, now: at(day(21), "22:00") });
    const strip = (b: BodyState) => ({ ...b, decisions: b.decisions.map((d) => (d.id === "d:body:targets" ? { ...d, date: "", updated_at: "" } : d)) });
    expect(strip(evening)).toEqual(strip(morning));
    expect(evening.decisions[0]!.date).not.toBe(morning.decisions[0]!.date);
  });

  test("decision ids are unique and every decision validates", () => {
    const b = body(weeks([86, 85.9, 85.8, 85.4, 84.4, 84.5]), day(42));
    const ids = b.decisions.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of b.decisions) {
      expect(Decision.parse(d)).toEqual(d);
      expect(d.engine_version).toBe(config.engine_version);
    }
  });

  test.each(scenarios)("%s: copy is plain, no guilt, no dashes as punctuation", (_name, run) => {
    const b = run();
    const strings = [b.pace_text, b.targets.reason, ...b.decisions.map((d) => d.explanation)];
    for (const s of strings) {
      expect(s.length).toBeGreaterThan(0);
      expect(s.length).toBeLessThanOrEqual(110);
      expect(s).toMatch(/\.$/);
      expect(s).not.toMatch(/fail|missed|bad|wrong|should have|behind/i);
      expect(s).not.toMatch(/[—–]| - |-$|\s-\s/);
      expect(s).not.toMatch(/NaN|undefined|null|Infinity/);
    }
  });
});

describe("schema and config agree", () => {
  test("the cut rate range and defaults are the same in schema and config", () => {
    expect(BODY_LIMITS.cut_rate_pct).toEqual({ min: config.body.cut_rate.min_pct, max: config.body.cut_rate.max_pct });
    expect(SettingsSchema.shape.cut_rate_pct.parse(undefined)).toBe(config.body.cut_rate.default_pct);
    expect(SettingsSchema.shape.steps_target.parse(undefined)).toBe(config.body.steps_target_default);
    expect(SettingsSchema.shape.cut_rate_pct.safeParse(config.body.cut_rate.min_pct).success).toBe(true);
    expect(SettingsSchema.shape.cut_rate_pct.safeParse(config.body.cut_rate.max_pct).success).toBe(true);
    expect(SettingsSchema.shape.cut_rate_pct.safeParse(1.01).success).toBe(false);
    expect(SettingsSchema.shape.cut_rate_pct.safeParse(0.2).success).toBe(false);
  });

  test("the max total is a whole number of steps and the rates are ordered", () => {
    const b = config.body;
    expect(b.adjustment.max_total_kcal % b.adjustment.step_kcal).toBe(0);
    expect(b.cut_rate.min_pct).toBeLessThanOrEqual(b.cut_rate.default_pct);
    expect(b.cut_rate.default_pct).toBeLessThanOrEqual(b.cut_rate.max_pct);
    expect(b.gain_rate.target_pct).toBeLessThan(b.gain_rate.max_pct);
    expect(b.rate.min_span_days).toBeLessThanOrEqual(b.rate.span_days);
    expect(b.trend.min_weigh_ins).toBeLessThanOrEqual(b.trend.window_days);
    expect(b.adjustment.min_weigh_ins).toBeLessThanOrEqual(7);
    expect(b.adjustment.min_protein_days).toBeLessThanOrEqual(7);
    expect(b.adjustment.min_gap_days).toBeLessThanOrEqual(7);
  });
});
