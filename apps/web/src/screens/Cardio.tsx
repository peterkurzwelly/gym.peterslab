/** Cardio: what the session is, then the interval timer and the log form. */
import type { Session } from "@gym/schema";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Page, Pill, ShellDock, Skeleton, SpacingWarnings, describeCardioTotal } from "../components";
import { startCardioSession, useEngine, useSettings } from "../data";
import { cx } from "../lib/cx";
import { CardioPanel } from "./today/CardioPanel";
import { EngineError } from "./today/Calm";
import { TopBar } from "./Workout";
import { plain } from "../lib/plain";

const KIND_STYLE: Record<string, string> = {
  warmup: "bg-raise-2",
  easy: "bg-move/35",
  hard: "bg-move",
  cooldown: "bg-raise-2",
};

export function CardioScreen() {
  const navigate = useNavigate();
  const { ready, state, error } = useEngine();
  const settings = useSettings();
  const [started, setStarted] = useState<Session | null>(null);
  const [starting, setStarting] = useState(false);
  // Hold the running cardio: after Save the live state drops it a moment before the summary shows, and a
  // Start button must not appear in between.
  const running = state?.active?.session.program_day_id === "CARDIO" ? state.active.session : null;
  useEffect(() => {
    if (running) setStarted((s) => (s?.id === running.id ? s : running));
  }, [running]);

  if (!ready)
    return (
      <Page className="pt-[calc(env(safe-area-inset-top)+16px)]">
        <Skeleton height={320} />
      </Page>
    );
  if (error || !state) return <EngineError title="Cardio could not be planned" detail={error?.message ?? null} />;

  const plan = state.cardio;
  const active = state.active?.session ?? null;
  const activeCardio = active && active.program_day_id === "CARDIO" ? active : null;
  // One open session at a time: cardio started now would hide the open workout until it is saved.
  const openWorkout = active && active.program_day_id !== "CARDIO" ? active : null;
  const session = activeCardio ?? started;
  const total = plan.segments.reduce((n, s) => n + s.seconds, 0) || 1;

  const start = async () => {
    if (starting) return;
    setStarting(true);
    try {
      setStarted(await startCardioSession());
    } catch (e) {
      console.warn("[cardio] start", e);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col pt-[env(safe-area-inset-top)]">
      <TopBar title="Cardio" onBack={() => navigate("/")} />
      <Page className="gap-4 pt-0">
        <header className="px-1">
          <div className="gym-label !text-move">{plan.counts_as === "target" ? "Counts toward this week" : "Bonus session"}</div>
          <h1 className="m-0 mt-2 font-display text-[46px] uppercase leading-[0.92] text-fg">{plan.kind === "intervals" ? "Intervals" : "Easy cardio"}</h1>
          <p className="m-0 mt-2 text-[15px] leading-snug text-fg-dim">
            {describeCardioTotal(plan)} · {plan.modality_options.length ? plan.modality_options.join(" or ") : "bike or rower"}
          </p>
        </header>

        {!session && openWorkout && <Pill>Your workout is still open. Finish it first, then cardio is one tap away.</Pill>}

        {!session && (
          <>
            <section className="rounded-[20px] bg-card p-4" aria-label="Session structure">
              <div className="flex h-3 gap-[3px] overflow-hidden rounded-full" aria-hidden>
                {plan.segments.map((s, i) => (
                  <span key={i} className={cx("h-full rounded-full", KIND_STYLE[s.kind])} style={{ width: `${(s.seconds / total) * 100}%` }} />
                ))}
              </div>
              <ul className="m-0 mt-4 flex list-none flex-col gap-2 p-0 text-[15px]">
                {plan.warmup_min > 0 && (
                  <li className="flex justify-between gap-3">
                    <span className="text-fg-dim">Warm up, easy</span>
                    <span className="tabular-nums text-fg">{plan.warmup_min} min</span>
                  </li>
                )}
                {plan.intervals ? (
                  <li className="flex justify-between gap-3">
                    <span className="text-fg">
                      {plan.intervals.count} rounds: {plan.intervals.hard_min} min hard, {plan.intervals.easy_min} min easy
                    </span>
                    <span className="tabular-nums text-fg">{plan.intervals.count * (plan.intervals.hard_min + plan.intervals.easy_min)} min</span>
                  </li>
                ) : (
                  <li className="flex justify-between gap-3">
                    <span className="text-fg">Steady, conversation pace</span>
                    <span className="tabular-nums text-fg">{Math.max(0, plan.total_min - plan.warmup_min - plan.cooldown_min)} min</span>
                  </li>
                )}
                {plan.cooldown_min > 0 && (
                  <li className="flex justify-between gap-3">
                    <span className="text-fg-dim">Cool down, easy</span>
                    <span className="tabular-nums text-fg">{plan.cooldown_min} min</span>
                  </li>
                )}
              </ul>
            </section>

            {plan.kind === "intervals" && (
              <section className="rounded-[20px] bg-card p-4">
                <div className="gym-label !text-move">How hard is hard</div>
                <p className="m-0 mt-2 text-[15px] leading-snug text-fg">{plan.hard_description || "Breathing heavily, able to say only a few words."}</p>
                <p className="m-0 mt-2 text-[13.5px] leading-snug text-fg-dim">Easy means you could hold a conversation. The app beeps at every switch, so you can put the phone down.</p>
              </section>
            )}
            <p className="m-0 px-1 text-[13.5px] leading-snug text-fg-faint">{plain(plan.reason)}</p>
            <SpacingWarnings warnings={plan.warnings} />
          </>
        )}

        {session && (
          <CardioPanel
            plan={plan}
            session={session}
            bare
            sound={settings?.sound ?? true}
            onClose={() => {
              setStarted(null);
              navigate("/");
            }}
            onSaved={(id) => navigate(`/summary/${id}`, { replace: true })}
          />
        )}
      </Page>

      {!session && (
        <ShellDock>
          {openWorkout ? (
            <Button variant="primary" size="lg" block className="shadow-[0_12px_32px_rgba(0,0,0,0.6)]" onClick={() => navigate("/workout")}>
              Back to your workout
            </Button>
          ) : (
            <Button variant="primary" size="lg" block className="shadow-[0_12px_32px_rgba(0,0,0,0.6)]" disabled={starting} onClick={() => void start()}>
              Start cardio
            </Button>
          )}
        </ShellDock>
      )}
    </div>
  );
}
