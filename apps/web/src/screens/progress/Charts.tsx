/**
 * Progress charts. Lazy loaded (Recharts stays out of the Today bundle and the first paint of Progress).
 *
 * Built with the dataviz method on the app's tokens:
 * - e1RM per main lift: small multiples, one series each in paper, the latest point in the orange accent.
 *   Four lifts would need four categorical hues; the palette has one accent, so facets instead of colors.
 * - Weekly volume per muscle: a heatmap on a one-hue paper ramp (validated as an ordinal ramp on the card surface).
 * - Cardio + walking vs WHO 150: stacked columns, two steps of the same paper ramp (intervals bright, walking dim),
 *   2px surface gap, legend + table. The WHO line is a solid hairline.
 * - Check-in average per week: one line, 1 to 5.
 * Every chart has a tooltip (tap or hover) and a table view; nothing is readable only through color or hover.
 */
import { useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import type { BarShapeProps } from "recharts/types/cartesian/Bar";
import type { DotItemDotProps } from "recharts/types/util/types";
import { Card } from "../../components";
import { cx } from "../../lib/cx";
import { fmtKg, fmtRange, fmtScore } from "../../lib/format";
import { muscleLabel } from "../plan/model";
import type { CardioRow, ChartData, CheckinRow, E1rmSeries, VolumeRow } from "./model";

// SVG presentation attributes cannot read CSS variables, so the tokens from styles.css are mirrored here.
const PAPER = "#f2edd5"; // --color-paper
const PAPER_DIM = "#b9bba5"; // --color-paper-dim
const FAINT = "#7f8d7f"; // --color-paper-faint
const LINE = "#1d4d3f"; // --color-line
const ORANGE = "#f26716"; // --color-orange (accent: the latest point)
const SURFACE = "#072d23"; // card surface (ink-2 at 50% over ink): gaps and rings
/** One-hue ramp from paper (OKLCH h 97, C 0.032), L 0.55 / 0.68 / 0.81 / 0.94. Passes the ordinal checks on SURFACE. */
export const PAPER_RAMP = ["#77725d", "#9d9983", "#c6c1aa", "#f2edd5"] as const;
const WALK = PAPER_RAMP[1];

const AXIS_TICK = { fill: FAINT, fontSize: 10, fontFamily: "IBM Plex Mono, ui-monospace, monospace" };

// ---------- shared pieces ----------

function TipBox({ title, rows }: { title: string; rows: { key: string; value: string; label: string; swatch?: string; line?: boolean }[] }) {
  return (
    <div className="pointer-events-none rounded-[3px] border border-line bg-ink px-2.5 py-2 text-[12px] shadow-[0_6px_18px_rgba(0,0,0,0.35)]">
      <div className="text-[10.5px] uppercase tracking-[0.12em] text-paper-faint">{title}</div>
      {rows.map((r) => (
        <div key={r.key} className="mt-1 flex items-center gap-2">
          {r.swatch && <span aria-hidden className={cx("shrink-0", r.line ? "h-[2px] w-3" : "h-2.5 w-2.5 rounded-[2px]")} style={{ background: r.swatch }} />}
          <span className="font-semibold text-paper">{r.value}</span>
          <span className="text-paper-dim">{r.label}</span>
        </div>
      ))}
    </div>
  );
}

function rowOf<T>(props: TooltipContentProps): T | null {
  if (!props.active || !props.payload?.length) return null;
  return (props.payload[0]?.payload as T) ?? null;
}

function TableView({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="group mt-2 border-t border-line/70">
      <summary className="flex min-h-11 cursor-pointer list-none items-center text-[11px] uppercase tracking-[0.14em] text-paper-faint [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">Show table</span>
        <span className="hidden group-open:inline">Hide table</span>
      </summary>
      <div className="overflow-x-auto pb-2">
        <table className="w-full border-collapse text-left text-[12px] tabular-nums text-paper-dim">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h} scope="col" className="border-b border-line/70 py-1 pr-3 font-normal text-paper-faint">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} className={cx("border-b border-line/40 py-1 pr-3", j === 0 && "text-paper")}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="m-0 py-6 text-center text-[13px] leading-snug text-paper-faint">{children}</p>;
}

// ---------- e1RM small multiples ----------

function LiftMultiple({ s }: { s: E1rmSeries }) {
  const data = s.points.map((p, i) => ({ ...p, i }));
  const n = data.length;
  const delta = s.first != null && s.latest != null && n >= 2 ? s.latest - s.first : null;
  return (
    <div className="flex min-w-0 flex-col rounded-[3px] border border-line/80 px-3 pb-2 pt-2.5">
      <span className="truncate text-[12px] text-paper-dim">{s.name}</span>
      {n === 0 ? (
        <>
          <span className="mt-1 text-[13px] text-paper-faint">No sessions yet</span>
          <div className="h-[56px]" aria-hidden />
        </>
      ) : (
        <>
          <span className="mt-0.5 text-[18px] font-semibold leading-tight text-paper [font-variant-numeric:normal]">
            {fmtKg(s.latest!)}
            <span className="ml-1 text-[11px] font-normal text-paper-dim">kg</span>
          </span>
          <span className="text-[11px] text-paper-faint">{delta == null ? "First point" : `${delta >= 0 ? "+" : "−"}${fmtKg(Math.abs(delta))} since first`}</span>
          <LineChart
            data={data}
            responsive
            style={{ width: "100%", height: 56 }}
            margin={{ top: 8, right: 6, bottom: 4, left: 6 }}
            accessibilityLayer
            aria-label={`${s.name} e1RM, ${n} sessions`}
          >
            <XAxis dataKey="i" type="number" domain={n > 1 ? [0, n - 1] : [-1, 1]} hide />
            <YAxis domain={["dataMin - 1", "dataMax + 1"]} hide />
            <Tooltip
              cursor={{ stroke: LINE, strokeWidth: 1 }}
              isAnimationActive={false}
              content={(p: TooltipContentProps) => {
                const r = rowOf<(typeof data)[number]>(p);
                return r ? <TipBox title={r.label} rows={[{ key: "v", value: `${fmtKg(r.e1rm)} kg`, label: "e1RM" }]} /> : null;
              }}
            />
            <Line
              dataKey="e1rm"
              stroke={PAPER}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={false}
              activeDot={{ r: 4, fill: PAPER, stroke: SURFACE, strokeWidth: 2 }}
              isAnimationActive={false}
            />
            <ReferenceDot x={n - 1} y={s.latest!} r={4} fill={ORANGE} stroke={SURFACE} strokeWidth={2} />
          </LineChart>
        </>
      )}
    </div>
  );
}

function E1rmCard({ series }: { series: E1rmSeries[] }) {
  const any = series.some((s) => s.points.length > 0);
  const longest = Math.max(0, ...series.map((s) => s.points.length));
  return (
    <Card label="e1RM per main lift" meta="kg · estimated">
      {!any ? (
        <Empty>Your first session with each main lift draws its first point.</Empty>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {series.map((s) => (
            <LiftMultiple key={s.exercise_id} s={s} />
          ))}
        </div>
      )}
      <p className="m-0 mt-2 text-[11.5px] leading-snug text-paper-faint">Estimated 1 rep max from your best set each session. Orange marks the latest.</p>
      {any && (
        <TableView
          caption="e1RM per main lift"
          head={["Session", ...series.map((s) => s.name)]}
          rows={Array.from({ length: longest }, (_, i) => [`${i + 1}`, ...series.map((s) => (s.points[i] ? `${fmtKg(s.points[i]!.e1rm)} · ${s.points[i]!.label}` : ""))])}
        />
      )}
    </Card>
  );
}

// ---------- volume heatmap ----------

function binOf(v: number, band: { min: number; max: number }): number {
  if (v <= 0) return -1;
  if (v < band.min / 2) return 0;
  if (v < band.min) return 1;
  if (v <= band.max) return 2;
  return 3;
}

function VolumeCard({ volume }: { volume: ChartData["volume"] }) {
  const rows: VolumeRow[] = volume.rows.slice(-12);
  const band = volume.band;
  const [sel, setSel] = useState<{ week: string; muscle: string } | null>(null);
  const any = rows.some((r) => Object.values(r.by_muscle).some((v) => (v ?? 0) > 0));
  const selRow = sel ? rows.find((r) => r.week_id === sel.week) : null;
  const selVal = selRow && sel ? (selRow.by_muscle[sel.muscle as keyof VolumeRow["by_muscle"]] ?? 0) : null;
  const legend = [`<${fmtKg(band.min / 2)}`, `${fmtKg(band.min / 2)}–${band.min}`, `${fmtRange(band.min, band.max)} band`, `>${band.max}`];
  const cols = `76px repeat(${rows.length}, minmax(0, 1fr))`;

  const readout = (r: VolumeRow, m: string, v: number) => {
    const where = r.band ? (v < r.band.min ? "below band" : v > r.band.max ? "above band" : "in band") : "no band this phase";
    return `${muscleLabel(m)} · week of ${r.label} · ${fmtScore(v)} sets · ${where}`;
  };

  return (
    <Card label="Sets per muscle" meta="Weekly">
      {!any ? (
        <Empty>Each week fills a column once you log sets.</Empty>
      ) : (
        <>
          <p className="m-0 mb-2 min-h-[34px] text-[12px] leading-snug text-paper-dim" aria-live="polite">
            {selRow && sel && selVal != null ? readout(selRow, sel.muscle, selVal) : "Tap a cell for the number."}
          </p>
          <div role="table" aria-label="Weekly fractional sets per muscle" className="flex flex-col gap-[2px]">
            <div role="row" className="grid items-end gap-[2px]" style={{ gridTemplateColumns: cols }}>
              <span role="columnheader" className="text-[10px] text-paper-faint">
                Week
              </span>
              {rows.map((r) => (
                <span
                  key={r.week_id}
                  role="columnheader"
                  aria-label={r.is_zero ? `Paused week of ${r.label}` : `Week ${r.training_week}, ${r.label}`}
                  className={cx("text-center text-[10px] tabular-nums", r.is_current ? "text-paper" : "text-paper-faint")}
                >
                  {r.is_zero ? "·" : r.training_week}
                </span>
              ))}
            </div>
            {volume.muscles.map((m) => (
              <div key={m} role="row" className="grid items-center gap-[2px]" style={{ gridTemplateColumns: cols }}>
                <span role="rowheader" className="truncate pr-1 text-[11.5px] text-paper-dim">
                  {muscleLabel(m)}
                </span>
                {rows.map((r) => {
                  const v = r.by_muscle[m] ?? 0;
                  const b = binOf(v, band);
                  const on = sel?.week === r.week_id && sel.muscle === m;
                  return (
                    <button
                      key={r.week_id}
                      type="button"
                      role="cell"
                      aria-label={readout(r, m, v)}
                      onClick={() => setSel(on ? null : { week: r.week_id, muscle: m })}
                      className={cx("h-[22px] min-w-0 rounded-[3px] outline-offset-1", b < 0 && "border border-line/70", on && "outline-2 outline-paper")}
                      style={b >= 0 ? { background: PAPER_RAMP[b] } : undefined}
                    />
                  );
                })}
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-paper-dim" aria-label="Legend">
            {legend.map((l, i) => (
              <span key={l} className="inline-flex items-center gap-1.5">
                <span aria-hidden className="h-2.5 w-2.5 rounded-[2px]" style={{ background: PAPER_RAMP[i] }} />
                {l}
              </span>
            ))}
          </div>
          <TableView
            caption="Weekly fractional sets per muscle"
            head={["Week", ...volume.muscles.map(muscleLabel)]}
            rows={rows.map((r) => [r.is_zero ? `${r.label} (paused)` : `${r.training_week} · ${r.label}`, ...volume.muscles.map((m) => fmtScore(r.by_muscle[m] ?? 0))])}
          />
        </>
      )}
    </Card>
  );
}

// ---------- cardio + walking vs WHO ----------

/** Stacked segment with a rounded top only when it is the top of its stack, and a 2px surface gap below an upper segment. */
function segment(kind: "cardio" | "walking") {
  return function Segment(props: BarShapeProps) {
    const { x, y, width, height, fill } = props;
    const row = props.payload as CardioRow | undefined;
    if (!row || !height || height <= 0 || width <= 0) return <g />;
    const isTop = kind === "walking" || row.walking <= 0;
    const gap = kind === "walking" && row.cardio > 0 ? 2 : 0;
    const h = Math.max(0, height - gap);
    if (h <= 0) return <g />;
    const r = isTop ? Math.min(4, width / 2, h) : 0;
    const d = r
      ? `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} L${x + width},${y + h} Z`
      : `M${x},${y} h${width} v${h} h${-width} Z`;
    return <path d={d} fill={fill} />;
  };
}
const CardioSeg = segment("cardio");
const WalkSeg = segment("walking");

function CardioCard({ rows }: { rows: CardioRow[] }) {
  const data = rows.slice(-12);
  const target = data[data.length - 1]?.target ?? 150;
  const any = data.some((r) => r.total > 0);
  const top = Math.max(target * 1.15, ...data.map((r) => r.total));
  return (
    <Card label="Cardio and walking" meta={`WHO ${target} min`}>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-paper-dim" aria-label="Legend">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-[2px]" style={{ background: PAPER }} />
          Cardio
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-[2px]" style={{ background: WALK }} />
          Walking
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-px w-3" style={{ background: PAPER_DIM }} />
          WHO {target}
        </span>
      </div>
      {!any ? (
        <Empty>Cardio and walks stack up here week by week, against the WHO {target} minutes.</Empty>
      ) : (
        <BarChart
          data={data}
          responsive
          style={{ width: "100%", height: 176 }}
          margin={{ top: 8, right: 4, bottom: 0, left: -14 }}
          barCategoryGap="28%"
          accessibilityLayer
          aria-label={`Weekly cardio and walking minutes against ${target}`}
        >
          <CartesianGrid vertical={false} stroke={LINE} strokeWidth={1} />
          <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: LINE }} interval="preserveStartEnd" minTickGap={8} tickMargin={6} />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} domain={[0, Math.ceil(top / 50) * 50]} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: "rgba(242,237,213,0.06)" }}
            isAnimationActive={false}
            content={(p: TooltipContentProps) => {
              const r = rowOf<CardioRow>(p);
              return r ? (
                <TipBox
                  title={`Week of ${r.label}`}
                  rows={[
                    { key: "t", value: `${Math.round(r.total)} of ${r.target}`, label: "WHO min" },
                    { key: "c", value: `${Math.round(r.cardio)}`, label: "cardio", swatch: PAPER },
                    { key: "w", value: `${Math.round(r.walking)}`, label: "walking", swatch: WALK },
                  ]}
                />
              ) : null;
            }}
          />
          <ReferenceLine y={target} stroke={PAPER_DIM} strokeWidth={1} ifOverflow="extendDomain" />
          <Bar dataKey="cardio" stackId="who" fill={PAPER} maxBarSize={24} shape={CardioSeg} isAnimationActive={false} />
          <Bar dataKey="walking" stackId="who" fill={WALK} maxBarSize={24} shape={WalkSeg} isAnimationActive={false} />
        </BarChart>
      )}
      <p className="m-0 mt-2 text-[11.5px] leading-snug text-paper-faint">Moderate minutes. Hard interval minutes count double, as WHO counts them. Tap a week for its numbers.</p>
      {any && (
        <TableView
          caption="Weekly cardio and walking minutes"
          head={["Week", "Cardio", "Walking", "Total"]}
          rows={data.map((r) => [r.label, Math.round(r.cardio), Math.round(r.walking), `${Math.round(r.total)} of ${r.target}`])}
        />
      )}
    </Card>
  );
}

// ---------- check-in average ----------

function CheckinCard({ rows }: { rows: CheckinRow[] }) {
  const data = rows.slice(-12);
  const lastIdx = data.map((r) => r.avg != null).lastIndexOf(true);
  const any = lastIdx >= 0;
  const Dot = (p: DotItemDotProps) => {
    const { cx: x, cy: y, index } = p;
    if (x == null || y == null || p.value == null) return <g key={`d${index}`} />;
    return <circle key={`d${index}`} cx={x} cy={y} r={4} fill={index === lastIdx ? ORANGE : PAPER} stroke={SURFACE} strokeWidth={2} />;
  };
  return (
    <Card label="Check-in average" meta="1 to 5">
      {!any ? (
        <Empty>The 20 second check-in on Today adds a point per week. Skippable, always.</Empty>
      ) : (
        <LineChart
          data={data}
          responsive
          style={{ width: "100%", height: 150 }}
          margin={{ top: 10, right: 8, bottom: 0, left: 0 }}
          accessibilityLayer
          aria-label="Weekly check-in average"
        >
          <CartesianGrid vertical={false} stroke={LINE} strokeWidth={1} />
          <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: LINE }} interval="preserveStartEnd" minTickGap={8} tickMargin={6} padding={{ left: 12, right: 12 }} />
          <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} tick={AXIS_TICK} tickLine={false} axisLine={false} width={18} />
          <Tooltip
            cursor={{ stroke: LINE, strokeWidth: 1 }}
            isAnimationActive={false}
            content={(p: TooltipContentProps) => {
              const r = rowOf<CheckinRow>(p);
              return r ? <TipBox title={`Week of ${r.label}`} rows={[{ key: "a", value: r.avg == null ? "No check-in" : fmtScore(r.avg), label: r.avg == null ? "" : "average" }]} /> : null;
            }}
          />
          <Line
            dataKey="avg"
            stroke={PAPER}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            connectNulls={false}
            dot={Dot}
            activeDot={{ r: 5, fill: PAPER, stroke: SURFACE, strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      )}
      {any && (
        <TableView caption="Weekly check-in average" head={["Week", "Average"]} rows={data.map((r) => [r.label, r.avg == null ? "none" : fmtScore(r.avg)])} />
      )}
    </Card>
  );
}

export default function ProgressCharts({ data }: { data: ChartData }) {
  return (
    <div className="flex flex-col gap-3">
      <E1rmCard series={data.e1rm} />
      <VolumeCard volume={data.volume} />
      <CardioCard rows={data.cardio} />
      <CheckinCard rows={data.checkin} />
    </div>
  );
}
