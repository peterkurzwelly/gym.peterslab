/**
 * SPEC 9.5: engine tests cover every row of tables 6.2, 6.3 and 6.4, including the bench press examples.
 * This map names, per row, the spec test titles (literal text in the files) that cover it, so deleting the
 * tests for a row fails here.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
const FILES = ["phases.test.ts", "double-progression.test.ts", "events.test.ts", "session-modifiers.test.ts", "twelve-weeks.test.ts"];
const SOURCE = Object.fromEntries(FILES.map((f) => [f, read(f)]));

type Row = { row: string; file: string; needles: string[] };

/* prettier-ignore */
const ROWS: Row[] = [
  // 6.2 phases (the per week sets / RIR table uses PHASE_ROWS labels)
  { row: "6.2 Calibration (week 1)", file: "phases.test.ts", needles: ["6.2 calibration · start_pct", "6.2 calibration · nothing known", "6.2 calibration · the first logged set", "6.2 calibration · no max tests"] },
  { row: "6.2 Return (weeks 1 to 4)", file: "phases.test.ts", needles: ['label: "return week 1"', 'label: "return week 2"', "6.2 return · e1RM rise capped at 10%"] },
  { row: "6.2 Build (weeks 5 to 7)", file: "phases.test.ts", needles: ['label: "build week 5"'] },
  { row: "6.2 Deload (week 8)", file: "phases.test.ts", needles: ['label: "deload week 8"', "6.2 deload · sets halved", "6.2 deload · cardio replaced", "6.2 deload · deload sessions count fully"] },
  { row: "6.2 Push (weeks 9 to 11)", file: "phases.test.ts", needles: ['label: "push week 9"'] },
  { row: "6.2 Consolidate (week 12)", file: "phases.test.ts", needles: ['label: "consolidate week 12"', "6.2 consolidate · one top set per main lift", "6.2 consolidate · the summary compares each top set"] },
  { row: "6.2 Volume guardrail", file: "phases.test.ts", needles: ["6.2 volume · session cap 11", "6.2 volume · weekly fractional sets per muscle, band 8 to 10"] },
  { row: "6.2 Calendar vs training weeks", file: "phases.test.ts", needles: ["6.2 calendar vs training · a zero week does not advance", "6.2 calendar vs training · the block extends by one week"] },
  // 6.3 double progression, bench press example
  { row: "6.3 8, 8, 8 at RIR ≥ target", file: "double-progression.test.ts", needles: ["6.3 row 1 · 8, 8, 8"] },
  { row: "6.3 10, 10, 9 (return phase)", file: "double-progression.test.ts", needles: ["6.3 row 2 · 10, 10, 9"] },
  { row: "6.3 8, 7, 6", file: "double-progression.test.ts", needles: ["6.3 row 3 · 8, 7, 6"] },
  { row: "6.3 6, 5, 4", file: "double-progression.test.ts", needles: ["6.3 row 4 · 6, 5, 4"] },
  { row: "6.3 Below range 2 sessions running", file: "double-progression.test.ts", needles: ["6.3 row 5 · below range two sessions running, some sets", "6.3 row 5 · below range two sessions running, every set"] },
  { row: "6.3 Pain flag on exercise", file: "double-progression.test.ts", needles: ["6.3 row 6 · pain flag"] },
  // 6.4 events
  { row: "6.4 Stall", file: "events.test.ts", needles: ["6.4 stall · e1RM not improved over the last 3 exposures"] },
  { row: "6.4 Reactive deload", file: "events.test.ts", needles: ["6.4 reactive deload · trigger 1", "6.4 reactive deload · trigger 2", "6.4 reactive deload · trigger 3", "6.4 reactive deload · once per block"] },
  { row: "6.4 Daily readiness", file: "session-modifiers.test.ts", needles: ["6.4 readiness · average 1.75", "6.4 readiness · intervals swapped", "6.4 readiness · never diagnostic wording"] },
  { row: "6.4 Missed session", file: "events.test.ts", needles: ["6.4 missed session · days without training change nothing", "6.4 never stack ·"] },
  { row: "6.4 Never miss twice", file: "events.test.ts", needles: ["6.4 never miss twice · ≥ 48 h", "6.4 never miss twice · not once the week's floor is reached"] },
  { row: "6.4 Zero week", file: "events.test.ts", needles: ["6.4 zero week · phase does not advance", "6.4 zero week · the comeback session yields no progression decision"] },
  { row: "6.4 30 minute mode", file: "session-modifiers.test.ts", needles: ["6.4 30 min · only starred exercises, one set fewer", "6.4 30 min · progression still applies"] },
  { row: "6.4 Break 7 to 14 days / > 14 days", file: "events.test.ts", needles: ["6.4 break 7 to 14 days · 7 days", "6.4 break 7 to 14 days · applies for one week", "6.4 break > 14 days · restart the return phase at week 2"] },
  { row: "6.4 Substitution", file: "session-modifiers.test.ts", needles: ["6.4 substitution · knee_friendly", "6.4 substitution · precedence", "6.4 substitution · substitute with e1RM history", "6.4 substitution · substitute without history"] },
  { row: "6.4 Interference guard", file: "session-modifiers.test.ts", needles: ["6.4 interference · hard cardio within 24 h", "6.4 interference · intervals prefer bike or rower"] },
];

describe("SPEC 9.5 · every row of tables 6.2, 6.3 and 6.4 has spec tests", () => {
  for (const r of ROWS)
    it(`9.5 coverage · ${r.row}`, () => {
      const src = SOURCE[r.file] ?? "";
      for (const needle of r.needles) expect(src.includes(needle), `${r.file}: "${needle}"`).toBe(true);
    });

  it("9.5 coverage · the phase 2 twelve-week fixture asserts week states, extension, comeback, deload timing and flags", () => {
    const src = SOURCE["twelve-weeks.test.ts"] ?? "";
    for (const needle of ["week statuses, counts, training weeks and phases", "one-week phase extension", "comeback session:", "after Thursday's session: training week 5 becomes the deload", "overhead press stalls after its third flat exposure", "no unexpected flags"])
      expect(src.includes(needle), needle).toBe(true);
  });
});
