/**
 * Exercise guides: what the movement is, how to do it, a demo video. Content lives in data/exercise-guides.json,
 * photos in public/ex (free-exercise-db, Unlicense; scripts/fetch-exercise-images.mjs).
 */
import raw from "../../../../data/exercise-guides.json";

export interface ExerciseVideo {
  id: string;
  title: string;
  channel: string;
}

export interface ExerciseGuide {
  /** What the movement is, in plain words. */
  what: string;
  /** What to look for in the gym. */
  find: string;
  setup: string[];
  do: string[];
  feel: string;
  avoid: string[];
  video: ExerciseVideo | null;
}

const GUIDES = raw as unknown as Record<string, ExerciseGuide>;

const tidy = (text: string) => text.replace(/\s+/g, " ").trim();

export function guideFor(exerciseId: string): ExerciseGuide | null {
  const g = GUIDES[exerciseId];
  if (!g) return null;
  // Titles come from YouTube as written there, stray spaces included.
  return g.video ? { ...g, video: { ...g.video, title: tidy(g.video.title), channel: tidy(g.video.channel) } } : g;
}

/** Demo photo: frame 0 is the start position, frame 1 the end position. */
export function demoSrc(exerciseId: string, frame: 0 | 1): string {
  return `/ex/${exerciseId}-${frame}.webp`;
}

export function videoWatchUrl(video: ExerciseVideo): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`;
}

export function videoEmbedUrl(video: ExerciseVideo): string {
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(video.id)}?playsinline=1&rel=0&modestbranding=1&autoplay=1`;
}

/** Fallback when no verified video exists: a search that always works. */
export function videoSearchUrl(name: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${name} proper form`)}`;
}
