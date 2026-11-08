/**
 * History normalization: drop deleted rows, sort, index by session, resolve the effective exercise,
 * rep range and track of every set log, and classify sessions (finished, qualifying, kind).
 */
import type {
  Alternative,
  CardioLog,
  Checkin,
  DayCode,
  EngineConfig,
  Exercise,
  Measure,
  Prescription,
  ProgramConfig,
  ProgramDay,
  ProgressionRule,
  Session,
  SetLog,
  Settings,
} from "@gym/schema";
import { Settings as SettingsSchema } from "@gym/schema";
import type { EngineContext } from "./types";
import { isValidTimeZone, localDate, toIso, weekStart } from "./dates";

export type SessionKind = "strength" | "travel" | "cardio";

/** Where an exercise sits in the program: prescription + effective range, measure and rule. */
export interface Slot {
  prescription: Prescription;
  day: ProgramDay;
  exercise_id: string;
  rep_min: number;
  rep_max: number;
  measure: Measure;
  progression_rule: ProgressionRule;
  /** alternative.per_side ?? prescription.per_side. */
  per_side: boolean;
  key: string;
  alternative: Alternative | null;
}

export interface NSet {
  log: SetLog;
  exercise: Exercise | undefined;
  slot: Slot | null;
  track: string | null;
  measure: Measure;
  working: boolean;
}

export interface NSession {
  s: Session;
  id: string;
  code: DayCode;
  date: string;
  startMs: number;
  lastActivityMs: number;
  lastActivityIso: string;
  finished: boolean;
  autoFinished: boolean;
  /** ended_at, the auto finish time, or now when forced. */
  endedIso: string | null;
  kind: SessionKind;
  qualifying: boolean;
  /** Counts toward strength_done (strength, or travel when program.travel.counts_toward_floor). */
  strengthLike: boolean;
  sets: NSet[];
  workSets: NSet[];
  cardio: CardioLog[];
  /** Index into the calendar weeks, −1 before the block. Set by buildWeeks. */
  weekIndex: number;
}

export interface Norm {
  ctx: EngineContext;
  config: EngineConfig;
  program: ProgramConfig;
  settings: Settings;
  exercises: Record<string, Exercise>;
  tz: string;
  nowMs: number;
  nowIso: string;
  atMs: number;
  atIso: string;
  /** Local date of `at`. */
  today: string;
  blockStart: string;
  blockMonday: string;
  sessions: NSession[];
  sessionById: Map<string, NSession>;
  qualifying: NSession[];
  checkins: Checkin[];
  checkinByDate: Map<string, Checkin>;
  /** Cardio logs of kept sessions plus session-less logs dated up to today. */
  cardioLogs: CardioLog[];
  /** Session-less activity logs (walks). */
  walks: CardioLog[];
  repairedMondays: Set<string>;
  presById: Map<string, { day: ProgramDay; p: Prescription }>;
  dayByCode: Map<DayCode, ProgramDay>;
}

export interface AnalyzeOptions {
  /** Plan as if at this instant (defaults to ctx.now). Sessions started later are ignored. */
  at?: string;
  /** Drop this session from history entirely (a resumed session plans with frozen targets). */
  excludeSessionId?: string;
  /** Treat this session as finished at ctx.now (summary right after Finish). */
  forceFinishedId?: string;
}

export function trackKey(exerciseId: string, repMin: number, repMax: number): string {
  return `${exerciseId}@${repMin}-${repMax}`;
}

/** Effective range, measure and rule of an exercise used for a prescription (default, alternative or free swap). */
export function resolveSlot(day: ProgramDay, p: Prescription, exerciseId: string, exercise: Exercise | undefined): Slot {
  let rep_min = p.rep_min;
  let rep_max = p.rep_max;
  let measure: Measure = p.measure;
  let progression_rule: ProgressionRule = p.progression_rule;
  let per_side = p.per_side;
  let alternative: Alternative | null = null;
  if (exerciseId !== p.exercise_id) {
    alternative = p.alternatives.find((a) => a.exercise_id === exerciseId) ?? null;
    if (alternative) {
      rep_min = alternative.rep_min ?? p.rep_min;
      rep_max = alternative.rep_max ?? p.rep_max;
      measure = alternative.measure ?? p.measure;
      progression_rule = alternative.progression_rule ?? p.progression_rule;
      per_side = alternative.per_side ?? p.per_side;
    } else if (exercise) {
      measure = exercise.measure;
    }
  }
  if (rep_max < rep_min) rep_max = rep_min;
  return {
    prescription: p,
    day,
    exercise_id: exerciseId,
    rep_min,
    rep_max,
    measure,
    progression_rule,
    per_side,
    key: trackKey(exerciseId, rep_min, rep_max),
    alternative,
  };
}

function kindOf(code: DayCode): SessionKind {
  if (code === "CARDIO") return "cardio";
  if (code === "TRAVEL") return "travel";
  return "strength";
}

const notDeleted = <T extends { deleted_at: string | null }>(r: T) => r.deleted_at == null;

/**
 * Settings rows written before evening_hour / week_killers existed lack them: fill the schema defaults
 * (evening_hour null stays null, it means off).
 */
export function withSettingsDefaults(s: Settings): Settings {
  if (s.evening_hour !== undefined && s.week_killers !== undefined) return s;
  return {
    ...s,
    evening_hour: s.evening_hour === undefined ? SettingsSchema.shape.evening_hour.parse(undefined) : s.evening_hour,
    week_killers: s.week_killers ?? SettingsSchema.shape.week_killers.parse(undefined),
  };
}

export function normalize(ctx: EngineContext, opts: AnalyzeOptions = {}): Norm {
  const { config, program } = ctx;
  const settings = withSettingsDefaults(ctx.settings);
  const tz = settings.timezone && isValidTimeZone(settings.timezone) ? settings.timezone : config.timezone_default;
  // Canonical ISO (with ms) so every decision date validates against the schema.
  const nowMs = Date.parse(ctx.now);
  const atMs = opts.at ? Date.parse(opts.at) : nowMs;
  const atIso = toIso(atMs);
  const today = localDate(atIso, tz);

  const exercises: Record<string, Exercise> = { ...ctx.exercises };
  for (const row of ctx.history.customExercises ?? []) {
    if (row.deleted_at == null) exercises[row.id] = row;
  }

  const presById = new Map<string, { day: ProgramDay; p: Prescription }>();
  const dayByCode = new Map<DayCode, ProgramDay>();
  for (const day of program.days) {
    dayByCode.set(day.code, day);
    for (const p of day.prescriptions) presById.set(p.id, { day, p });
  }

  const rawSessions = ctx.history.sessions
    .filter(notDeleted)
    .filter((s) => s.id !== opts.excludeSessionId && Date.parse(s.started_at) <= atMs)
    .sort((a, b) => a.started_at.localeCompare(b.started_at) || a.id.localeCompare(b.id));
  const kept = new Set(rawSessions.map((s) => s.id));

  const logsBySession = new Map<string, SetLog[]>();
  for (const log of ctx.history.setLogs) {
    if (log.deleted_at != null || !kept.has(log.session_id)) continue;
    let arr = logsBySession.get(log.session_id);
    if (!arr) logsBySession.set(log.session_id, (arr = []));
    arr.push(log);
  }

  const cardioBySession = new Map<string, CardioLog[]>();
  const walks: CardioLog[] = [];
  const cardioLogs: CardioLog[] = [];
  for (const c of ctx.history.cardioLogs) {
    if (c.deleted_at != null) continue;
    if (c.session_id == null) {
      if (c.date <= today) {
        walks.push(c);
        cardioLogs.push(c);
      }
      continue;
    }
    if (!kept.has(c.session_id)) continue;
    let arr = cardioBySession.get(c.session_id);
    if (!arr) cardioBySession.set(c.session_id, (arr = []));
    arr.push(c);
    cardioLogs.push(c);
  }
  walks.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  const autoMs = config.session.auto_finish_hours * 3_600_000;
  const sessions: NSession[] = rawSessions.map((s) => {
    const day = dayByCode.get(s.program_day_id);
    const logs = (logsBySession.get(s.id) ?? []).sort(
      (a, b) => a.set_index - b.set_index || a.completed_at.localeCompare(b.completed_at) || a.id.localeCompare(b.id),
    );
    const sets: NSet[] = logs.map((log) => {
      const exercise = exercises[log.exercise_id];
      let found = log.prescription_id ? presById.get(log.prescription_id) : undefined;
      if (!found && day) {
        // Ad hoc log without prescription: match by exercise within the session's day.
        const p = day.prescriptions.find(
          (q) => q.exercise_id === log.exercise_id || q.alternatives.some((a) => a.exercise_id === log.exercise_id),
        );
        if (p) found = { day, p };
      }
      const slot = found ? resolveSlot(found.day, found.p, log.exercise_id, exercise) : null;
      return {
        log,
        exercise,
        slot,
        track: slot?.key ?? null,
        measure: slot?.measure ?? exercise?.measure ?? "reps",
        working: !log.is_warmup,
      };
    });
    const workSets = sets.filter((x) => x.working);
    const startMs = Date.parse(s.started_at);
    let lastActivityMs = startMs;
    let lastActivityIso = s.started_at;
    for (const x of sets) {
      const t = Date.parse(x.log.completed_at);
      if (t > lastActivityMs) {
        lastActivityMs = t;
        lastActivityIso = x.log.completed_at;
      }
    }
    const forced = opts.forceFinishedId === s.id && s.ended_at == null;
    const autoFinished = s.ended_at == null && !forced && nowMs - lastActivityMs > autoMs;
    const finished = s.ended_at != null || forced || autoFinished;
    const endedIso = s.ended_at ?? (forced ? toIso(nowMs) : autoFinished ? toIso(lastActivityMs) : null);
    const kind = kindOf(s.program_day_id);
    const cardio = cardioBySession.get(s.id) ?? [];
    const qualifying = kind === "cardio" ? cardio.length > 0 : workSets.length > 0;
    const strengthLike = qualifying && (kind === "strength" || (kind === "travel" && program.travel.counts_toward_floor));
    return {
      s,
      id: s.id,
      code: s.program_day_id,
      date: localDate(s.started_at, tz),
      startMs,
      lastActivityMs,
      lastActivityIso,
      finished,
      autoFinished,
      endedIso,
      kind,
      qualifying,
      strengthLike,
      sets,
      workSets,
      cardio,
      weekIndex: -1,
    };
  });

  const checkinByDate = new Map<string, Checkin>();
  for (const c of ctx.history.checkins) {
    if (c.deleted_at != null || c.date > today) continue;
    const prev = checkinByDate.get(c.date);
    if (!prev || c.updated_at > prev.updated_at) checkinByDate.set(c.date, c);
  }
  const checkins = [...checkinByDate.values()].sort((a, b) => a.date.localeCompare(b.date));

  const repairedMondays = new Set<string>();
  for (const w of ctx.history.trainingWeeks) {
    if (w.deleted_at == null && w.repaired) repairedMondays.add(weekStart(w.start_date));
  }

  return {
    ctx,
    config,
    program,
    settings,
    exercises,
    tz,
    nowMs,
    nowIso: toIso(nowMs),
    atMs,
    atIso,
    today,
    blockStart: settings.block_start_date,
    blockMonday: weekStart(settings.block_start_date),
    sessions,
    sessionById: new Map(sessions.map((x) => [x.id, x])),
    qualifying: sessions.filter((x) => x.qualifying),
    checkins,
    checkinByDate,
    cardioLogs,
    walks,
    repairedMondays,
    presById,
    dayByCode,
  };
}

/** Average of the four check-in scores (all 1..5, higher is better). */
export function checkinAverage(c: Checkin): number {
  return (c.sleep + c.soreness + c.stress + c.energy) / 4;
}

export function incrementFor(n: Norm, exercise: Exercise): number {
  return n.settings.increment_overrides[exercise.id] ?? exercise.increment_kg;
}

export function isBodyweight(exercise: Exercise): boolean {
  return exercise.bodyweight || exercise.equipment === "bodyweight";
}

export function isMainLift(n: Norm, p: Prescription): boolean {
  return p.main_lift || n.program.main_lifts.includes(p.id);
}
