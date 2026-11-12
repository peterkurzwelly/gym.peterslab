/**
 * "How to" for an exercise: start and end photo, what it is, what to look for in the gym, steps, a demo video.
 * Open it from anywhere with useGuide()(exerciseId).
 */
import type { Exercise } from "@gym/schema";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useInRouterContext, useLocation } from "react-router-dom";
import { useEngine } from "../data";
import { demoSrc, guideFor, videoEmbedUrl, videoSearchUrl, videoWatchUrl, type ExerciseGuide } from "../lib/guides";
import { DumbbellIcon, VideoIcon } from "./Icons";
import { Sheet } from "./Sheet";

type OpenGuide = (exerciseId: string) => void;
const GuideContext = createContext<OpenGuide>(() => {});

/** Opens the guide sheet for an exercise id. */
export function useGuide(): OpenGuide {
  return useContext(GuideContext);
}

/** A back swipe or any route change closes the guide, so it never stays open (and playing) over another screen. */
function CloseOnNavigate({ onNavigate }: { onNavigate: () => void }) {
  const { pathname } = useLocation();
  useEffect(() => onNavigate(), [pathname, onNavigate]);
  return null;
}

export function GuideProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState<string | null>(null);
  const open = useCallback<OpenGuide>((exerciseId) => setId(exerciseId), []);
  const close = useCallback(() => setId(null), []);
  const inRouter = useInRouterContext();
  return (
    <GuideContext.Provider value={open}>
      {children}
      {inRouter && <CloseOnNavigate onNavigate={close} />}
      <GuideSheet exerciseId={id} onClose={close} />
    </GuideContext.Provider>
  );
}

const MUSCLE: Record<string, string> = {
  lower_back: "Lower back",
  quads: "Quads",
  hamstrings: "Hamstrings",
  glutes: "Glutes",
  chest: "Chest",
  back: "Back",
  shoulders: "Shoulders",
  biceps: "Biceps",
  triceps: "Triceps",
  forearms: "Forearms",
  traps: "Traps",
  calves: "Calves",
  core: "Core",
};
const muscleName = (m: string) => MUSCLE[m] ?? m.replace(/_/g, " ");

function Steps({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <section>
      <h3 className="gym-label m-0 mb-2">{title}</h3>
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {items.map((text, i) => (
          <li key={i} className="flex gap-3 text-[15px] leading-snug text-fg">
            <span className="mt-[1px] grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-raise-2 text-[12px] font-semibold text-fg-dim">{i + 1}</span>
            <span className="min-w-0">{text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Fact({ title, children, color }: { title: string; children: ReactNode; color?: string }) {
  return (
    <div className="rounded-2xl bg-raise px-4 py-3">
      <div className="gym-label mb-1" style={color ? { color } : undefined}>
        {title}
      </div>
      <div className="text-[15px] leading-snug text-fg">{children}</div>
    </div>
  );
}

function Media({ exercise, guide }: { exercise: Pick<Exercise, "id" | "name">; guide: ExerciseGuide | null }) {
  const [playing, setPlaying] = useState(false);
  const online = typeof navigator === "undefined" || navigator.onLine !== false;
  const video = guide?.video ?? null;

  return (
    <div className="flex flex-col gap-3">
      {playing && video ? (
        <div className="relative aspect-video overflow-hidden rounded-2xl bg-black">
          <iframe
            src={videoEmbedUrl(video)}
            title={video.title}
            className="absolute inset-0 h-full w-full border-0"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {([0, 1] as const).map((frame) => (
            <figure key={frame} className="relative m-0 aspect-[4/3] overflow-hidden rounded-2xl bg-black">
              <FrameImage src={demoSrc(exercise.id, frame)} exerciseId={exercise.id} name={exercise.name} />
              <figcaption className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-[3px] text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg">{frame === 0 ? "Start" : "End"}</figcaption>
            </figure>
          ))}
        </div>
      )}

      {video ? (
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            disabled={!online && !playing}
            className="gym-press flex min-h-14 w-full items-center gap-3 rounded-2xl bg-fg px-4 text-left text-night disabled:opacity-50"
          >
            <VideoIcon size={26} />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold leading-tight">{playing ? "Back to photos" : "Watch the video"}</span>
              <span className="block truncate text-[12px] leading-tight opacity-70">{online || playing ? video.channel : "Needs a connection"}</span>
            </span>
          </button>
          <a href={videoWatchUrl(video)} target="_blank" rel="noreferrer" className="self-center px-3 py-2 text-[13px] text-fg-dim underline decoration-fg-faint/50 underline-offset-4">
            Open in YouTube
          </a>
        </div>
      ) : (
        <a
          href={videoSearchUrl(exercise.name)}
          target="_blank"
          rel="noreferrer"
          className="gym-press flex min-h-14 w-full items-center gap-3 rounded-2xl bg-raise px-4 text-fg no-underline"
        >
          <VideoIcon size={26} />
          <span className="text-[15px] font-semibold">Find a video on YouTube</span>
        </a>
      )}
    </div>
  );
}

function FrameImage({ src, exerciseId, name }: { src: string; exerciseId: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <div className="absolute inset-0 grid place-items-center bg-raise text-fg-faint" role="img" aria-label={`${name}: no photo`} data-exercise={exerciseId}>
        <DumbbellIcon size={22} />
      </div>
    );
  return <img src={src} alt="" className="absolute inset-0 h-full w-full object-contain" onError={() => setFailed(true)} />;
}

export function GuideSheet({ exerciseId, onClose }: { exerciseId: string | null; onClose: () => void }) {
  const { ctx } = useEngine();
  // Keep the last exercise while the sheet closes, so the content does not blank out.
  const [shownId, setShownId] = useState<string | null>(exerciseId);
  useEffect(() => {
    if (exerciseId) setShownId(exerciseId);
  }, [exerciseId]);
  const id = exerciseId ?? shownId;
  const exercise = id ? (ctx?.exercises[id] ?? null) : null;
  const guide = useMemo(() => (id ? guideFor(id) : null), [id]);
  const name = exercise?.name ?? "Exercise";
  const muscles = exercise ? [...exercise.primary_muscles, ...exercise.secondary_muscles.filter((m) => !exercise.primary_muscles.includes(m))] : [];

  return (
    <Sheet open={exerciseId != null} onClose={onClose} title={name} eyebrow="How to">
      {id && (
        <div className="flex flex-col gap-5 pt-1" key={id}>
          <Media exercise={{ id, name }} guide={guide} />

          {guide?.what && <p className="m-0 text-[16px] leading-snug text-fg">{guide.what}</p>}

          {muscles.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {muscles.map((m, i) => (
                <span key={m} className={i < (exercise?.primary_muscles.length ?? 0) ? "rounded-full bg-volt px-2.5 py-1 text-[12px] font-semibold text-night" : "rounded-full bg-raise px-2.5 py-1 text-[12px] text-fg-dim"}>
                  {muscleName(m)}
                </span>
              ))}
            </div>
          )}

          {guide ? (
            <>
              {guide.find && <Fact title="In the gym, look for">{guide.find}</Fact>}
              <Steps title="Set up" items={guide.setup} />
              <Steps title="Do it" items={guide.do} />
              {guide.feel && (
                <Fact title="You should feel it in" color="var(--color-volt)">
                  {guide.feel}
                </Fact>
              )}
              {guide.avoid.length > 0 && (
                <section>
                  <h3 className="gym-label m-0 mb-2">Watch out</h3>
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {guide.avoid.map((text, i) => (
                      <li key={i} className="flex gap-3 text-[15px] leading-snug text-fg-dim">
                        <span aria-hidden className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
                        <span className="min-w-0">{text}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          ) : (
            <Steps title="How to do it" items={exercise?.instructions ?? []} />
          )}
        </div>
      )}
    </Sheet>
  );
}
