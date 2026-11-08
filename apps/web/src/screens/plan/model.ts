/**
 * Plan tab view model. Pure: engine state + context in, rows out. The engine owns every number;
 * this only arranges what it computed (plus the program's phase table for weeks not reached yet).
 */
import type { EngineContext, EngineState, WeekState } from "@gym/engine";
import type { CardioLog, DayCode, PhaseName, ProgramConfig, Session } from "@gym/schema";
import { localDateOf } from "../../data";
import { addDays } from "./booking";

export interface PhaseInfo {
  name: PhaseName;
  label: string;
  rir: [number, number];
}

/**
 * Phase of a future training week. block.deload_week is the deload (planned 8 or pulled forward);
 * when the deload was pulled forward, week 8 takes the phase before it (ENGINE_RULES 2).
 */
export function phaseForWeek(program: ProgramConfig, trainingWeek: number, deloadWeek: number): PhaseInfo {
  const phases = program.phases;
  const info = (i: number): PhaseInfo => {
    const p = phases[i]!;
    return { name: p.name, label: p.label, rir: [p.rir_min, p.rir_max] };
  };
  const deloadIdx = phases.findIndex((p) => p.name === "deload");
  if (trainingWeek === deloadWeek && deloadIdx >= 0) return info(deloadIdx);
  const last = phases.length - 1;
  let idx = phases.findIndex((p) => p.week_from <= trainingWeek && trainingWeek <= p.week_to);
  if (idx < 0) idx = trainingWeek < (phases[0]?.week_from ?? 1) ? 0 : last;
  if (phases[idx]?.name === "deload" && trainingWeek !== deloadWeek) idx = Math.max(0, idx - 1);
  return info(idx);
}

export type BlockRowKind = "done" | "current" | "future";

export interface BlockRow {
  key: string;
  kind: BlockRowKind;
  training_week: number;
  phase: PhaseInfo;
  start_date: string;
  end_date: string;
  /** Engine week state for past and current rows, null for weeks not reached yet. */
  week: WeekState | null;
}

export interface PhaseGroup {
  key: string;
  phase: PhaseInfo;
  rows: BlockRow[];
}

/** Calendar weeks so far (state.weeks) plus the training weeks still ahead, up to block_weeks. */
export function blockRows(state: EngineState, program: ProgramConfig): BlockRow[] {
  const byName = new Map(program.phases.map((p) => [p.name, p] as const));
  const rows: BlockRow[] = state.weeks.map((w) => {
    const p = byName.get(w.phase);
    return {
      key: w.id,
      kind: w.is_current ? "current" : "done",
      training_week: w.training_week,
      phase: { name: w.phase, label: w.phase_label, rir: p ? [p.rir_min, p.rir_max] : [0, 0] },
      start_date: w.start_date,
      end_date: w.end_date,
      week: w,
    };
  });
  const cur = state.current_week;
  for (let tw = cur.training_week + 1; tw <= state.block.block_weeks; tw++) {
    const start = addDays(cur.start_date, 7 * (tw - cur.training_week));
    rows.push({
      key: `future-${tw}`,
      kind: "future",
      training_week: tw,
      phase: phaseForWeek(program, tw, state.block.deload_week),
      start_date: start,
      end_date: addDays(start, 6),
      week: null,
    });
  }
  return rows;
}

/** Consecutive rows with the same phase, for phase captions between rows. */
export function groupByPhase(rows: BlockRow[]): PhaseGroup[] {
  const groups: PhaseGroup[] = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && last.phase.name === r.phase.name) last.rows.push(r);
    else groups.push({ key: `${r.phase.name}-${r.key}`, phase: r.phase, rows: [r] });
  }
  return groups;
}

export interface WeekSessionRow {
  id: string;
  code: DayCode;
  mode: Session["mode"];
  date: string;
  sets: number;
  cardio_minutes: number;
  active: boolean;
}

/** Sessions the engine counted this week (week.session_ids), oldest first, with sets and cardio minutes. */
export function weekSessions(week: WeekState, ctx: EngineContext, activeId: string | null): WeekSessionRow[] {
  const ids = new Set(week.session_ids);
  const tz = ctx.settings.timezone;
  return ctx.history.sessions
    .filter((s) => ids.has(s.id) && !s.deleted_at)
    .sort((a, b) => a.started_at.localeCompare(b.started_at))
    .map((s) => ({
      id: s.id,
      code: s.program_day_id,
      mode: s.mode,
      date: localDateOf(s.started_at, tz),
      sets: ctx.history.setLogs.filter((l) => l.session_id === s.id && !l.deleted_at && !l.is_warmup).length,
      cardio_minutes: ctx.history.cardioLogs.filter((c) => c.session_id === s.id && !c.deleted_at).reduce((t, c) => t + c.minutes, 0),
      active: s.id === activeId,
    }));
}

/** Walking logs (no session) on a local date. */
export function walksOn(cardioLogs: CardioLog[], date: string): CardioLog[] {
  return cardioLogs.filter((c) => c.session_id == null && c.modality === "walk" && c.date === date && !c.deleted_at);
}

/** "Session A", "★ Session B", "Travel version", "Cardio". */
export function sessionLabel(code: DayCode, mode: Session["mode"]): string {
  if (code === "CARDIO") return "Cardio";
  if (code === "TRAVEL" || mode === "travel") return "Travel version";
  return `${mode === "short" ? "★ " : ""}Session ${code}`;
}

/** First training week of a band phase (for "band starts in week 5"). */
export function firstBandWeek(program: ProgramConfig, bandPhases: readonly PhaseName[]): number | null {
  const weeks = program.phases.filter((p) => bandPhases.includes(p.name)).map((p) => p.week_from);
  return weeks.length ? Math.min(...weeks) : null;
}

const MUSCLE_LABEL: Record<string, string> = {
  lower_back: "Lower back",
};

/** "chest" → "Chest", "lower_back" → "Lower back". */
export function muscleLabel(m: string): string {
  return MUSCLE_LABEL[m] ?? m.charAt(0).toUpperCase() + m.slice(1).replace(/_/g, " ");
}
