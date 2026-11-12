/**
 * The engine explains itself in gym shorthand (RIR, floor, e1RM, deload). This turns one of its sentences into
 * plain words for the screen. Display only: nothing here changes a number, and stored decisions keep the
 * engine's own text.
 */
const RULES: [RegExp, string][] = [
  [/★\s*/g, ""],
  // "2492 kcal" reads like the other numbers on screen: "2 492 kcal" (thin space, as fmtInt).
  [/\b(\d{1,3})(\d{3})(?= kcal\b)/g, "$1\u2009$2"],
  [/pick a weight you could lift about (\d+) times with (\d) or more reps left/g, "start light. Pick a weight you can lift $1 times and still have $2 more in you"],
  // effort: "at RIR 3", "RIR 3 to 4", "RIR 3–4", "RIR 2"
  [/\bat RIR (\d)\b(?!\s*(?:to|–|-)\s*\d)/g, "with $1 left in the tank"],
  [/\bRIR (\d)\s*(?:to|–|-)\s*(\d)\b/g, "$1 to $2 left in the tank"],
  [/\bRIR (\d)\b/g, "$1 left in the tank"],
  [/\bRIR\b/g, "reps left"],
  // strength estimate
  [/\bno e1RM gain\b/g, "no strength gain"],
  [/\b(\d[\d.,]*) kg e1RM\b/g, "estimated max of $1 kg"],
  [/\be1RM\b/g, "estimated max"],
  // the week
  [/\bfloor sessions\b/g, "minimum workouts"],
  [/\bfloor session\b/g, "minimum workout"],
  [/\b(reach(?:es)?|toward|at) the floor\b/g, "$1 the weekly minimum"],
  [/\bthe floor\b/g, "the weekly minimum"],
  [/\bThe floor\b/g, "The weekly minimum"],
  [/\bfloor\b/g, "minimum"],
  [/\bFloor\b/g, "Minimum"],
  [/\bstrength sessions\b/g, "workouts"],
  [/\bstrength session\b/g, "workout"],
  // easy weeks
  [/\ba deload\b/g, "an easy"],
  [/\bDeload\b/g, "Easy"],
  [/\bdeload\b/g, "easy"],
];

export function plain(text: string): string;
export function plain(text: string | null | undefined): string | null;
export function plain(text: string | null | undefined): string | null {
  if (text == null) return null;
  let out = text;
  for (const [re, to] of RULES) out = out.replace(re, to);
  return out;
}
