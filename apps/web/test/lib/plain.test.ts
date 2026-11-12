/**
 * plain(): the engine's gym shorthand, reworded for the screen. Display only.
 * The inputs are sentences the engine really writes (planning.ts, progression.ts, events.ts, weeks.ts, cardio.ts).
 */
import { describe, expect, it } from "vitest";
import { plain } from "../../src/lib/plain";

describe("plain", () => {
  it("says how many reps to leave instead of RIR", () => {
    expect(plain("All sets hit top of range at RIR 3: +2.5 kg.")).toBe("All sets hit top of range with 3 left in the tank: +2.5 kg.");
    expect(plain("Push phase: same weights, RIR 1 to 2.")).toBe("Push phase: same weights, 1 to 2 left in the tank.");
    expect(plain("Push block: RIR 1–2.")).toBe("Push block: 1 to 2 left in the tank.");
    expect(plain("Consolidate: one top set at RIR 1 on each main lift to see your progress.")).toBe("Consolidate: one top set with 1 left in the tank on each main lift to see your progress.");
    expect(plain("Top set, RIR 1.")).toBe("Top set, 1 left in the tank.");
    expect(plain("Log your RIR honestly.")).toBe("Log your reps left honestly.");
  });

  it("calls the floor the minimum", () => {
    expect(plain("2 strength sessions reach the floor")).toBe("2 workouts reach the weekly minimum");
    expect(plain("1 more strength session reaches the floor")).toBe("1 more workout reaches the weekly minimum");
    expect(plain("Book your two floor sessions for the week.")).toBe("Book your two minimum workouts for the week.");
    expect(plain("Floor at risk: the 30 min version counts fully.")).toBe("Minimum at risk: the 30 min version counts fully.");
    expect(plain("Sunday review: floor, target and what moved up. Two minutes.")).toBe("Sunday review: minimum, target and what moved up. Two minutes.");
    expect(plain("The floor is two sessions.")).toBe("The weekly minimum is two sessions.");
  });

  it("spells out e1RM", () => {
    expect(plain("From your 100 kg e1RM: 60 kg × 8 at RIR 3.")).toBe("From your estimated max of 100 kg: 60 kg × 8 with 3 left in the tank.");
    expect(plain("Back squat: no e1RM gain in 3 sessions. Try a variation or a new rep range.")).toBe("Back squat: no strength gain in 3 sessions. Try a variation or a new rep range.");
    expect(plain("Bench press top set: e1RM 101 kg, start of the block 95 kg.")).toBe("Bench press top set: estimated max 101 kg, start of the block 95 kg.");
  });

  it("turns a deload into an easy week", () => {
    expect(plain("Deload week: 2 sets, same weights, RIR 3 to 4.")).toBe("Easy week: 2 sets, same weights, 3 to 4 left in the tank.");
    expect(plain("Deload week: 30 min easy, conversation pace.")).toBe("Easy week: 30 min easy, conversation pace.");
    expect(plain("Deload session: no load change, same targets next time.")).toBe("Easy session: no load change, same targets next time.");
    expect(plain("Sleep is down: week 6 becomes a deload week. Week 8 is a normal week now.")).toBe("Sleep is down: week 6 becomes an easy week. Week 8 is a normal week now.");
  });

  it("drops the star", () => {
    expect(plain("Never miss twice: ★ 30 min version of B is enough today.")).toBe("Never miss twice: 30 min version of B is enough today.");
  });

  it("leaves plain sentences and longer words alone, and passes null through", () => {
    for (const text of ["Within range: same load, add reps.", "The floorboards and the stirring crowd.", "Week 1: 60% of your remembered 100 kg × 8. It should feel light."]) {
      expect(plain(text)).toBe(text);
    }
    expect(plain(null)).toBeNull();
    expect(plain(undefined)).toBeNull();
  });

  it("leaves no shorthand behind in any of the above", () => {
    const all = [
      "All sets hit top of range at RIR 3: +2.5 kg.",
      "Deload week: 2 sets, same weights, RIR 3 to 4.",
      "From your 100 kg e1RM: 60 kg × 8 at RIR 3.",
      "1 more strength session reaches the floor",
      "Never miss twice: ★ 30 min version of B is enough today.",
    ];
    for (const text of all) expect(plain(text)).not.toMatch(/\bRIR\b|e1RM|\bfloor\b|deload|★/i);
  });
  it("groups kcal thousands and makes the first-time weight hint concrete", () => {
    expect(plain("About 2492 kcal to hold weight, minus 467 to lose 0.5% a week.")).toBe("About 2\u2009492 kcal to hold weight, minus 467 to lose 0.5% a week.");
    expect(plain("Trend says eat less: 100 kcal less.")).toBe("Trend says eat less: 100 kcal less.");
    expect(plain("No history yet: pick a weight you could lift about 8 times with 3 or more reps left.")).toBe(
      "No history yet: start light. Pick a weight you can lift 8 times and still have 3 more in you.",
    );
  });
});
