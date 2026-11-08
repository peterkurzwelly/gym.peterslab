/**
 * /dev/kit: every UI kit component in every state, with fixtures typed as engine output.
 * Interactive where it helps (set logging, timers). Nothing here touches Dexie or the engine.
 */
import type { PlannedExercise, PlannedSet } from "@gym/engine";
import type { SessionMode, SetLog } from "@gym/schema";
import { useState, type ReactNode } from "react";
import {
  AdjustmentBanner,
  AlternativesPanel,
  Badge,
  BlockDots,
  Button,
  Card,
  CardioLogForm,
  CheckinCard,
  Chip,
  ChipGroup,
  ExerciseCard,
  FinishBar,
  IntervalTimer,
  ModeBar,
  NextSessionCard,
  NudgeCard,
  Page,
  Pill,
  RestTimer,
  SectionHeader,
  SegmentedControl,
  SetRow,
  ShellDock,
  ShellSync,
  ShellTitle,
  Skeleton,
  SpacingWarnings,
  Stepper,
  SummaryView,
  SyncDot,
  Toggle,
  WeekCard,
  type CheckinScores,
  type SetValues,
  type SyncStatus,
} from "../components";
import * as fx from "../components/__fixtures__";

function Group({ index, title, children }: { index: string; title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader index={index}>{title}</SectionHeader>
      {children}
    </section>
  );
}

function State({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[10.5px] uppercase tracking-[0.14em] text-paper-faint">{label}</div>
      {children}
    </div>
  );
}

const SYNC: SyncStatus[] = ["idle", "syncing", "offline", "auth_required", "error"];

/** Live logging demo: confirm sets, edit them, calibrate, swap, pain. Starts the rest timer in the dock. */
function LoggingDemo({ onRest }: { onRest: (seconds: number, label: string) => void }) {
  const [exercises, setExercises] = useState<PlannedExercise[]>(fx.sessionAWeek1);
  const [logs, setLogs] = useState<SetLog[]>([fx.setLog(fx.backSquat, 0, 60, 8, 3)]);
  const [pain, setPain] = useState<Record<string, boolean>>({});
  const [mode, setMode] = useState<SessionMode>("full");
  const [swapping, setSwapping] = useState(false);

  // Only the first exercise with sets left has a "next" set.
  const activeId = exercises.find((ex) => ex.sets.some((s) => !logs.some((l) => l.prescription_id === ex.prescription_id && l.set_index === s.index)))?.prescription_id;

  const confirm = (ex: PlannedExercise, set: PlannedSet, v: SetValues, existing: SetLog | null) => {
    setLogs((ls) => {
      const rest = ls.filter((l) => l !== existing);
      return [...rest, fx.setLog(ex, set.index, v.weight, v.reps, v.rir, existing ? { id: existing.id } : {})];
    });
    if (!existing) onRest(ex.rest_s, ex.name);
  };

  return (
    <div className="flex flex-col gap-3">
      <ModeBar mode={mode} swapping={swapping} onModeChange={setMode} onSwappingChange={setSwapping} />
      {exercises.map((ex, i) => {
        const mine = logs.filter((l) => l.prescription_id === ex.prescription_id);
        const next = ex.prescription_id === activeId ? ex.sets.find((s) => !mine.some((l) => l.set_index === s.index)) : undefined;
        return (
          <ExerciseCard
            key={ex.prescription_id}
            position={i + 1}
            exercise={ex}
            logged={mine}
            activeSetIndex={next?.index ?? null}
            pain={!!pain[ex.prescription_id]}
            onPainChange={(on) => setPain((p) => ({ ...p, [ex.prescription_id]: on }))}
            onConfirmSet={(set, v, existing) => confirm(ex, set, v, existing)}
            swapMode={swapping}
            onSwap={(id) => {
              const a = ex.alternatives.find((x) => x.exercise_id === id);
              setExercises((list) =>
                list.map((e) =>
                  e.prescription_id === ex.prescription_id
                    ? a
                      ? { ...e, exercise_id: id, name: a.name, swapped: "session" }
                      : (fx.sessionAWeek1.find((d) => d.prescription_id === ex.prescription_id) ?? e)
                    : e,
                ),
              );
            }}
            equipment={ex.exercise_id === "back_squat" || ex.exercise_id === "bench_press" ? "barbell" : undefined}
            today={fx.TODAY}
          />
        );
      })}
    </div>
  );
}

export function KitScreen() {
  const [checkin, setCheckin] = useState<CheckinScores | null>(null);
  const [skipped, setSkipped] = useState(false);
  const [rest, setRest] = useState<{ startedAt: number; endsAt: number; label: string } | null>(null);
  const [showFinish, setShowFinish] = useState(true);
  const [sessionStart] = useState(() => Date.now() - 23 * 60_000);
  const [restDone, setRestDone] = useState(0);
  const [chip, setChip] = useState<number | null>(3);
  const [stepper, setStepper] = useState(82.5);
  const [toggle, setToggle] = useState(false);
  const [seg, setSeg] = useState<"easy" | "hard">("easy");
  const [lastSave, setLastSave] = useState<string>("");

  const startRest = (seconds: number, label: string) => {
    const now = Date.now();
    setRest({ startedAt: now, endsAt: now + seconds * 1000, label });
  };

  return (
    <Page className="pb-6">
      <ShellTitle>
        <span className="text-paper">UI kit</span>
        <span className="text-paper-faint"> · /dev/kit</span>
      </ShellTitle>
      <ShellSync>
        <SyncDot status="idle" />
      </ShellSync>
      <ShellDock>
        {rest && (
          <RestTimer
            startedAt={rest.startedAt}
            endsAt={rest.endsAt}
            label={rest.label}
            onAdd={(s) => setRest((r) => (r ? { ...r, endsAt: r.endsAt + s * 1000 } : r))}
            onSkip={() => setRest(null)}
            onDone={() => {
              setRestDone((n) => n + 1);
              setRest(null);
            }}
          />
        )}
        {showFinish && <FinishBar startedAt={sessionStart} setsDone={5} setsTotal={8} onFinish={() => setShowFinish(false)} />}
      </ShellDock>

      <header className="pt-2">
        <div className="text-[11px] uppercase tracking-[0.16em] text-paper-faint">Sheet 01 · components</div>
        <h1 className="m-0 mt-1 font-display text-[44px] font-normal leading-none">Workout OS kit</h1>
        <p className="mt-2 text-[13px] text-paper-dim">Every component, every state. Fixtures follow engine types.</p>
      </header>

      <Group index="01" title="Week card">
        <State label="Fresh week, nothing yet (neutral)">
          <WeekCard week={fx.weekFresh} block={fx.blockWeek1} goals={fx.goals} />
        </State>
        <State label="Below floor">
          <WeekCard week={fx.weekBelowFloor} block={fx.blockWeek3} goals={fx.goals} />
        </State>
        <State label="Floor reached">
          <WeekCard week={fx.weekFloor} block={fx.blockWeek3Floor} goals={fx.goals} />
        </State>
        <State label="Target reached + bonus">
          <WeekCard week={fx.weekTarget} block={fx.blockWeek3Target} goals={fx.goals} />
        </State>
        <State label="After a zero week (block extended), no goals passed">
          <WeekCard week={fx.weekBelowFloor} block={fx.blockExtended} />
        </State>
        <State label="Dots alone">
          <BlockDots dots={["target", "floor", "below_floor", "floor", "target", "current", "future", "future", "future", "future", "future", "future"]} />
        </State>
      </Group>

      <Group index="02" title="Next session">
        <State label="Next in line, with cardio">
          <NextSessionCard next={fx.nextB} cardio={fx.cardioIntervals} cardioDone={false} onStart={() => {}} onStartCardio={() => {}} />
        </State>
        <State label="Cardio with a spacing note">
          <NextSessionCard next={fx.nextB} cardio={fx.cardioWithWarning} cardioDone={false} onStart={() => {}} onStartCardio={() => {}} />
        </State>
        <State label="Done for today, cardio done">
          <NextSessionCard next={fx.nextDoneToday} cardio={fx.cardioEasy} cardioDone />
        </State>
      </Group>

      <Group index="03" title="Nudges">
        <NudgeCard nudge={fx.nudgeNeverMissTwice} onAction={() => {}} />
        <NudgeCard nudge={fx.nudgeComeback} onAction={() => {}} />
        <NudgeCard nudge={fx.nudgeBookFloor} onAction={() => {}} actionLabel="Add to calendar" />
        <NudgeCard nudge={fx.nudgeBlockComplete} />
      </Group>

      <Group index="04" title="Check-in">
        <State label="Live (save / skip / edit)">
          <CheckinCard
            value={checkin}
            skipped={skipped}
            onSave={(s) => {
              setCheckin(s);
              setSkipped(false);
            }}
            onSkip={() => setSkipped(true)}
          />
        </State>
        <State label="Saved (collapsed)">
          <CheckinCard value={{ sleep: 3, soreness: 4, stress: 3, energy: 4 }} onSave={() => {}} onSkip={() => {}} />
        </State>
        <State label="Skipped">
          <CheckinCard value={null} skipped onSave={() => {}} onSkip={() => {}} />
        </State>
      </Group>

      <Group index="05" title="Banners">
        <AdjustmentBanner adjustments={fx.readinessAdjustments} />
        <SpacingWarnings warnings={fx.spacingWarnings} />
      </Group>

      <Group index="06" title="Session · logging">
        <p className="text-[12px] text-paper-faint">Session A, return week 1. Check confirms the target in one tap and starts rest in the dock. Rests finished: {restDone}.</p>
        <LoggingDemo onRest={startRest} />
      </Group>

      <Group index="07" title="Exercise formats">
        <State label="Bulgarian split squat · /leg, /hand, last time">
          <ExerciseCard exercise={fx.splitSquat} logged={[]} activeSetIndex={0} pain={false} onConfirmSet={() => {}} onPainChange={() => {}} today={fx.TODAY} position={4} />
        </State>
        <State label="Pull-up · BW+5, stalled">
          <ExerciseCard
            exercise={fx.pullUp}
            logged={[fx.setLog(fx.pullUp, 0, 5, 9, 2), fx.setLog(fx.pullUp, 1, 5, 7, 1)]}
            activeSetIndex={2}
            pain={false}
            onConfirmSet={() => {}}
            onPainChange={() => {}}
            today={fx.TODAY}
            position={3}
          />
        </State>
        <State label="Farmer's carry · meters">
          <ExerciseCard exercise={fx.farmersCarry} logged={[]} activeSetIndex={0} pain={false} onConfirmSet={() => {}} onPainChange={() => {}} />
        </State>
        <State label="Biceps curl · superset, note">
          <ExerciseCard exercise={fx.bicepsCurl} logged={[]} activeSetIndex={null} pain={false} onConfirmSet={() => {}} onPainChange={() => {}} />
        </State>
        <State label="Consolidate · top set, pain on (swap offered)">
          <ExerciseCard
            exercise={fx.benchTopSet}
            logged={[fx.setLog(fx.benchTopSet, 0, 82.5, 5, 2)]}
            activeSetIndex={1}
            pain
            onConfirmSet={() => {}}
            onPainChange={() => {}}
            onSwap={() => {}}
          />
        </State>
        <State label="Alternatives panel · limitation swap">
          <div className="overflow-hidden rounded-[3px] border border-line">
            <AlternativesPanel exercise={fx.hackSquatLimitation} onSelect={() => {}} onClose={() => {}} />
          </div>
        </State>
      </Group>

      <Group index="08" title="Set row states">
        <div className="divide-y divide-line/70 overflow-hidden rounded-[3px] border border-line bg-ink-2/50">
          <SetRow set={fx.backSquat.sets[0]!} exercise={fx.backSquat} isNext last={{ weight: 57.5, reps: 8, rir: 3 }} onConfirm={() => {}} />
          <SetRow set={fx.backSquat.sets[1]!} exercise={fx.backSquat} onConfirm={() => {}} />
          <SetRow set={fx.backSquat.sets[0]!} exercise={fx.backSquat} logged={{ weight: 60, reps: 8, rir: 3 }} onConfirm={() => {}} />
          <SetRow set={fx.backSquat.sets[1]!} exercise={fx.backSquat} logged={{ weight: 62.5, reps: 7, rir: 2 }} onConfirm={() => {}} />
          <SetRow set={fx.benchCalibration.sets[0]!} exercise={fx.benchCalibration} isNext startWeight={20} onConfirm={() => {}} />
          <SetRow set={fx.benchTopSet.sets[3]!} exercise={fx.benchTopSet} onConfirm={() => {}} />
          <SetRow set={fx.plank.sets[0]!} exercise={fx.plank} isNext onConfirm={() => {}} />
          <SetRow set={fx.backSquat.sets[0]!} exercise={fx.backSquat} defaultEditing onConfirm={() => {}} />
        </div>
      </Group>

      <Group index="09" title="Dock bars">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => startRest(10, "Demo · 10 s")}>
            Rest 10 s
          </Button>
          <Button size="sm" onClick={() => startRest(180, "Bench press · set 2")}>
            Rest 3 min
          </Button>
          <Button size="sm" onClick={() => setShowFinish((v) => !v)}>
            {showFinish ? "Hide" : "Show"} finish bar
          </Button>
        </div>
        <State label="Rest timer (static copy)">
          <RestTimer startedAt={Date.now() - 60_000} endsAt={Date.now() + 102_000} label="Back squat · set 2" onAdd={() => {}} onSkip={() => {}} onDone={() => {}} sound={false} />
        </State>
        <State label="Finish bar (static copy)">
          <FinishBar startedAt={sessionStart} setsDone={9} setsTotal={9} onFinish={() => {}} />
        </State>
      </Group>

      <Group index="10" title="Summary">
        <Card>
          <SummaryView summary={fx.summaryA} onDone={() => {}} blockWeeks={12} goals={fx.goals} />
        </Card>
      </Group>

      <Group index="11" title="Cardio">
        <State label="Interval timer · demo with second long segments">
          <Card>
            <IntervalTimer plan={fx.cardioDemo} onComplete={(r) => setLastSave(`Timer: ${r.minutes} min, ${r.hardMinutes} hard`)} />
          </Card>
        </State>
        <State label="Interval timer · week 1 protocol">
          <Card>
            <IntervalTimer plan={fx.cardioIntervals} onComplete={() => {}} />
          </Card>
        </State>
        <State label="Cardio log">
          <Card>
            <CardioLogForm
              modalities={["bike", "rower", "run", "walk"]}
              initial={{ modality: "bike", minutes: 26, intensity: "hard", hard_minutes: 8 }}
              onSave={(v) => setLastSave(`Saved: ${v.modality} ${v.minutes} min ${v.intensity}${v.avg_hr ? ` ${v.avg_hr} bpm` : ""}`)}
            />
          </Card>
        </State>
        {lastSave && <p className="text-[12px] text-paper-dim">{lastSave}</p>}
      </Group>

      <Group index="12" title="Sync">
        <div className="flex flex-col items-start gap-1">
          {SYNC.map((s) => (
            <SyncDot key={s} status={s} onClick={s === "auth_required" ? () => {} : undefined} />
          ))}
        </div>
      </Group>

      <Group index="13" title="Primitives">
        <State label="Buttons">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" size="lg">
              Primary
            </Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost" size="sm">
              Ghost
            </Button>
            <Button variant="primary" disabled>
              Disabled
            </Button>
          </div>
        </State>
        <State label="Chips">
          <div className="flex flex-col gap-2">
            <ChipGroup label="Demo" value={chip} onChange={setChip} options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: n }))} />
            <div className="flex gap-2">
              <Chip selected>Selected</Chip>
              <Chip>Idle</Chip>
            </div>
          </div>
        </State>
        <State label="Stepper (tap the number to type)">
          <Stepper label="Weight" value={stepper} step={2.5} onChange={setStepper} unit="kg" />
        </State>
        <State label="Toggle">
          <Toggle checked={toggle} onChange={setToggle} label="Sound" description="Beep when rest ends." />
        </State>
        <State label="Segmented control">
          <SegmentedControl
            label="Intensity"
            value={seg}
            onChange={setSeg}
            options={[
              { value: "easy", label: "Easy" },
              { value: "hard", label: "Hard" },
            ]}
          />
        </State>
        <State label="Badges">
          <div className="flex flex-wrap gap-2">
            <Badge>★</Badge>
            <Badge>Top set</Badge>
            <Badge tone="neutral">Stalled</Badge>
            <Badge tone="neutral">Superset C5</Badge>
            <Badge tone="go">Floor</Badge>
            <Badge tone="solid">Solid</Badge>
          </div>
        </State>
        <State label="Pill">
          <Pill>Next up is A. Keep hard cardio a day away, or go easy today.</Pill>
        </State>
        <State label="Card with caption">
          <Card label="Caption" meta="Meta">
            <p className="text-[14px] text-paper-dim">Hairline card body.</p>
          </Card>
        </State>
        <State label="Skeleton">
          <Skeleton height={14} lines={3} />
        </State>
      </Group>
    </Page>
  );
}
