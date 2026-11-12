/** Exercise guides: every exercise Peter can meet in the program has a how-to with a video. */
import { describe, expect, it } from "vitest";
import type { ProgramConfig } from "@gym/schema";
import programJson from "../../../../config/program.json";
import rawGuides from "../../../../data/exercise-guides.json";
import { demoSrc, guideFor, videoEmbedUrl, videoSearchUrl, videoWatchUrl } from "../../src/lib/guides";

const program = programJson as unknown as ProgramConfig;

/** Every exercise a session can show: the prescribed one and its alternatives. */
function programExerciseIds(): string[] {
  const ids = new Set<string>();
  for (const day of program.days) {
    for (const p of day.prescriptions) {
      ids.add(p.exercise_id);
      for (const a of p.alternatives) ids.add(a.exercise_id);
    }
  }
  return [...ids].sort();
}

describe("guides", () => {
  it("every exercise in config/program.json has a complete guide with a video", () => {
    const ids = programExerciseIds();
    expect(ids.length).toBeGreaterThan(20);
    const incomplete = ids.filter((id) => {
      const g = guideFor(id);
      return !g || !g.what || !g.find || !g.setup.length || !g.do.length || !g.feel || !g.video || !g.video.id || !g.video.title || !g.video.channel;
    });
    expect(incomplete).toEqual([]);
  });

  it("guideFor tidies stray whitespace in video titles and channels", () => {
    const raw = rawGuides as unknown as Record<string, { video: { title: string; channel: string } | null }>;
    const untidy = (s: string) => s !== s.replace(/\s+/g, " ").trim();
    const messy = Object.keys(raw).filter((id) => raw[id]!.video && (untidy(raw[id]!.video!.title) || untidy(raw[id]!.video!.channel)));
    // The data has such entries (YouTube titles as written there); if it is ever cleaned, this loop is a no-op.
    for (const id of Object.keys(raw)) {
      const v = guideFor(id)?.video;
      if (!v) continue;
      expect(untidy(v.title), `${id} title`).toBe(false);
      expect(untidy(v.channel), `${id} channel`).toBe(false);
    }
    for (const id of messy) {
      const v = guideFor(id)!.video!;
      expect(v.title).toBe(raw[id]!.video!.title.replace(/\s+/g, " ").trim());
      expect(v.channel).toBe(raw[id]!.video!.channel.replace(/\s+/g, " ").trim());
    }
  });

  it("an unknown exercise has no guide", () => {
    expect(guideFor("not_an_exercise")).toBeNull();
  });

  it("builds photo and video addresses", () => {
    expect(demoSrc("back_squat", 0)).toBe("/ex/back_squat-0.webp");
    expect(demoSrc("back_squat", 1)).toBe("/ex/back_squat-1.webp");
    const video = guideFor("back_squat")!.video!;
    expect(videoWatchUrl(video)).toBe(`https://www.youtube.com/watch?v=${video.id}`);
    expect(videoEmbedUrl(video)).toMatch(new RegExp(`^https://www\\.youtube-nocookie\\.com/embed/${video.id}\\?`));
    expect(videoSearchUrl("Back squat")).toBe("https://www.youtube.com/results?search_query=Back%20squat%20proper%20form");
  });
});
