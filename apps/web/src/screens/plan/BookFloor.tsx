/**
 * "Book your two floor sessions": pick two days and a time, then add each to the calendar
 * through a plain link to /api/ics (Google Calendar as a fallback). Used by Plan and the Sunday review.
 */
import { spacingWarnings, type EngineContext, type EngineState } from "@gym/engine";
import type { StrengthDayCode } from "@gym/schema";
import { useMemo, useState } from "react";
import { Card, CheckIcon, Chip } from "../../components";
import { cx } from "../../lib/cx";
import { fmtApproxMin, fmtLocalDate, fmtRange } from "../../lib/format";
import {
  BOOK_TIMES,
  DEFAULT_BOOK_TIME,
  bookingWindow,
  codesInLine,
  defaultBookingDays,
  googleHref,
  icsHref,
  windowDays,
  zonedIso,
  type BookingWindow,
  type CalendarEvent,
} from "./booking";
import { CalendarIcon, Caption, ExternalIcon, LinkButton } from "./ui";

const TIME_KEY = "gym.plan.bookTime";
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function readTime(): string {
  try {
    const t = localStorage.getItem(TIME_KEY);
    return t && (BOOK_TIMES as readonly string[]).includes(t) ? t : DEFAULT_BOOK_TIME;
  } catch {
    return DEFAULT_BOOK_TIME;
  }
}

function saveTime(t: string) {
  try {
    localStorage.setItem(TIME_KEY, t);
  } catch {
    /* per-device convenience only */
  }
}

/** The engine's spacing check for starting `code` at that local date and time. Never blocks; only steers the defaults. */
function spacingOk(ctx: EngineContext, code: StrengthDayCode, date: string, time: string): boolean {
  try {
    const at = new Date(zonedIso(date, time, ctx.settings.timezone)).toISOString();
    return spacingWarnings(ctx, code, { at }).length === 0;
  } catch {
    return true;
  }
}

function weekRangeText(w: BookingWindow): string {
  const [, sm, sd] = w.week_start.split("-").map(Number) as [number, number, number];
  const [, em, ed] = w.week_end.split("-").map(Number) as [number, number, number];
  const mon = (m: number) => ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
  return sm === em ? `${fmtRange(sd, ed)} ${mon(em)}` : `${sd} ${mon(sm)} · ${ed} ${mon(em)}`;
}

export interface BookFloorProps {
  state: EngineState;
  ctx: EngineContext;
  className?: string;
  /** Card caption. */
  label?: string;
}

export function BookFloor({ state, ctx, className, label = "Book your workouts" }: BookFloorProps) {
  const [time, setTimeState] = useState(readTime);
  const floor = ctx.config.week.strength_floor;
  const win = useMemo(() => bookingWindow(state, ctx.now, ctx.settings.timezone, floor, time), [state, ctx.now, ctx.settings.timezone, floor, time]);
  const defaults = useMemo(() => defaultBookingDays(win, (d) => spacingOk(ctx, state.next.code, d, time)), [win, ctx, state.next.code, time]);
  const [picked, setPicked] = useState<{ key: string; days: string[] } | null>(null);
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const days = picked && picked.key === win.week_start ? picked.days : defaults;
  const sorted = [...days].sort();

  const setTime = (t: string) => {
    setTimeState(t);
    saveTime(t);
  };

  const toggle = (date: string) => {
    const cur = days;
    const next = cur.includes(date) ? cur.filter((d) => d !== date) : cur.length < 2 ? [...cur, date] : [cur[1]!, date];
    setPicked({ key: win.week_start, days: next });
  };

  const order = ctx.settings.session_order.length ? ctx.settings.session_order : ctx.program.rotation;
  const codes = codesInLine(state.next.code, order, sorted.length);
  const events = sorted.map((date, i): { date: string; code: StrengthDayCode; event: CalendarEvent } => {
    const code = codes[i]!;
    const day = ctx.program.days.find((d) => d.code === code);
    const minutes = i === 0 ? state.next.est_minutes : (day?.est_minutes ?? state.next.est_minutes);
    const name = day ? ` · ${day.name}` : "";
    return {
      date,
      code,
      event: {
        title: `Workout · Session ${code}`,
        start: zonedIso(date, time, ctx.settings.timezone),
        minutes,
        notes: `Workout ${i + 1} of ${sorted.length}${name}. Short on time? The 30 min version counts fully. gym.peterslab.app`,
      },
    };
  });

  const two = win.count >= 2;
  const firstOpenIdx = events.findIndex((e) => !opened[`${e.date}|${time}`]);

  return (
    <Card label={label} meta={weekRangeText(win)} className={className}>
      <h3 className="m-0 font-display text-[28px] font-normal leading-[1.05] text-fg">
        {two ? "Book your two must-do workouts" : "Book your must-do workout"}
      </h3>
      <p className="mt-1.5 text-[13px] leading-snug text-fg-dim">
        {two
          ? `${win.which === "next" ? "Next week" : "This week"}: two sessions in the calendar are the week. The rest is upside.`
          : "One more workout reaches this week's minimum. Put it in the calendar."}
      </p>

      <Caption className="mt-4">Days</Caption>
      <div className="mt-1.5 grid grid-cols-7 gap-1" role="group" aria-label="Days to book">
        {windowDays(win).map(({ date, open }) => {
          const on = days.includes(date);
          return (
            <Chip
              key={date}
              selected={on}
              disabled={!open}
              aria-label={`${fmtLocalDate(date)}${on ? ", booked" : ""}`}
              onClick={() => toggle(date)}
              className="min-h-[52px] min-w-0 flex-col gap-0.5 px-0 py-1 leading-none disabled:opacity-35"
            >
              <span className="text-[10px] uppercase tracking-[0.08em]">{WEEKDAY[new Date(`${date}T12:00:00Z`).getUTCDay()]}</span>
              <span className="text-[16px]">{Number(date.slice(8, 10))}</span>
            </Chip>
          );
        })}
      </div>

      <Caption className="mt-4">Time</Caption>
      <div className="mt-1.5 grid grid-cols-6 gap-1" role="radiogroup" aria-label="Time">
        {BOOK_TIMES.map((t) => (
          <Chip key={t} asRadio selected={t === time} onClick={() => setTime(t)} className="min-w-0 px-0 text-[13px]">
            {t}
          </Chip>
        ))}
      </div>

      {events.length === 0 ? (
        <p className="mt-4 text-[13px] text-fg-faint">Pick a day above to add it to your calendar.</p>
      ) : (
        <ul className="m-0 mt-4 list-none divide-y divide-line/70 border-t border-line/70 p-0">
          {events.map((e, i) => {
            const key = `${e.date}|${time}`;
            const done = !!opened[key];
            return (
              <li key={e.date} className="flex flex-col gap-2 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[14px] text-fg">
                    {fmtLocalDate(e.date)} · {time}
                  </span>
                  <span className="shrink-0 text-[12px] text-fg-dim">
                    Session {e.code} · {fmtApproxMin(e.event.minutes)}
                  </span>
                </div>
                <div className="flex gap-2">
                  <LinkButton
                    href={icsHref(e.event)}
                    external
                    variant={done ? "ghost" : i === firstOpenIdx ? "primary" : "secondary"}
                    className="flex-1"
                    icon={done ? <CheckIcon size={16} /> : <CalendarIcon size={16} />}
                    onClick={() => setOpened((o) => ({ ...o, [key]: true }))}
                  >
                    {done ? "Sent to calendar" : "Add to calendar"}
                  </LinkButton>
                  <LinkButton href={googleHref(e.event)} external variant="ghost" icon={<ExternalIcon size={15} />} className={cx("shrink-0")}>
                    Google
                  </LinkButton>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
