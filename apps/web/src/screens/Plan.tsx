/**
 * Plan tab (SPEC 4.2): the block as rows, this week with the floor booking, weekly targets, and edits.
 * Renders engine state only; writes go through the data layer (updateSettings, logWalk).
 */
import { useMemo } from "react";
import { Page, Pill, SectionHeader, ShellTitle, Skeleton, type WeekGoals } from "../components";
import { useEngine } from "../data";
import { BlockSheet } from "./plan/BlockSheet";
import { BookFloor } from "./plan/BookFloor";
import { EditBlock } from "./plan/EditBlock";
import { blockRows, groupByPhase } from "./plan/model";
import { ThisWeek } from "./plan/ThisWeek";
import { WeeklyTargets } from "./plan/WeeklyTargets";

export function PlanScreen() {
  const { ready, state, ctx, error } = useEngine();
  const groups = useMemo(() => (state && ctx ? groupByPhase(blockRows(state, ctx.program)) : []), [state, ctx]);

  if (!ready) {
    return (
      <Page>
        <Skeleton height={28} width="40%" />
        <Skeleton height={420} />
      </Page>
    );
  }
  if (error || !state || !ctx) {
    return (
      <Page>
        <Pill>Could not plan right now. Your log is safe.</Pill>
      </Page>
    );
  }

  const goals: WeekGoals = ctx.config.week;
  const block = state.block;

  return (
    <Page className="gap-6">
      <ShellTitle>
        <span className="text-paper">Plan</span>
        <span className="text-paper-faint"> · {block.complete ? "Block done" : `Week ${block.training_week} of ${block.block_weeks}`}</span>
      </ShellTitle>

      <section className="flex flex-col gap-3" aria-labelledby="plan-block">
        <SectionHeader index="01" right={block.extension_weeks > 0 ? `+${block.extension_weeks} wk` : `${block.block_weeks} weeks`}>
          <span id="plan-block">The block</span>
        </SectionHeader>
        <BlockSheet groups={groups} goals={goals} extensionWeeks={block.extension_weeks} />
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="plan-week">
        <SectionHeader index="02">
          <span id="plan-week">This week</span>
        </SectionHeader>
        <ThisWeek state={state} ctx={ctx} goals={goals} />
        <BookFloor state={state} ctx={ctx} />
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="plan-targets">
        <SectionHeader index="03">
          <span id="plan-targets">Weekly targets</span>
        </SectionHeader>
        <WeeklyTargets state={state} ctx={ctx} />
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="plan-edit">
        <SectionHeader index="04">
          <span id="plan-edit">Edit</span>
        </SectionHeader>
        <EditBlock state={state} ctx={ctx} />
      </section>
    </Page>
  );
}
