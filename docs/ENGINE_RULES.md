# Engine rules

The authoritative semantics for `packages/engine`. SPEC.md sections 5 and 6 and PROGRAM.md say *what*; this file says *exactly how*, including how ambiguous parts were resolved. Every threshold named here lives in `config/engine.json` or `config/program.json` and must be read from there, never hard coded. Where this file and the spec disagree, this file wins and the difference is listed in `docs/DECISIONS.md`.

Each rule has a `rule_id`. Every number the engine outputs carries a `Decision` with that `rule_id` and a one line `explanation` in plain, guilt free language (no "failed", "missed" as blame, no red, no diagnosis).

## 0. Ground rules

- **Pure.** `now` comes from `ctx.now`. No `Date.now()`, no `Math.random()`. Same input, same output, same decision ids.
- **Ignore deleted rows** (`deleted_at != null`) everywhere.
- **Local time.** All day and week logic uses `settings.timezone` (default `Europe/Stockholm`). A session belongs to the local date of its `started_at`. Weeks run Monday to Sunday.
- **Working sets** are set logs with `is_warmup = false`. Top sets (`is_top_set`) count as working sets for volume and e1RM, but are excluded from double progression evaluation.
- **Finished sessions.** A session is finished when `ended_at` is set, or when its last activity (latest set `completed_at`, else `started_at`) is more than `session.auto_finish_hours` before `now` (reported in `auto_finished`). Unfinished sessions never feed progression. They do count toward the week as soon as they have one logged set (strength) or a cardio log (cardio).
- **Qualifying session** (counts toward week totals): strength day (`A`, `B`, `C`) with ≥1 working set; `TRAVEL` with ≥1 working set (counts as strength when `program.travel.counts_toward_floor`); `CARDIO` session with a cardio log. Walks (`cardio_log.session_id = null`, modality `walk`) never count as sessions; they only add walking minutes.
- **Decision ids** are deterministic: progression `d:<source_session_id>:<exercise_id>@<rep_min>-<rep_max>`; first exposure `d:init:<exercise_id>@<rep_min>-<rep_max>`; plan level `d:plan:<YYYY-MM-DD>:<code>:<rule_id>`; week/event level `d:event:<rule_id>:<week_id or session_id>`. `date` is the source session's `ended_at` (or `ctx.now` for plan level). `updated_at` = `date`, `deleted_at` = null.
- **Rounding.** Loads round to the exercise's increment (`settings.increment_overrides[exercise_id]` ?? `exercise.increment_kg`) with `nearest`, except reductions (reset, readiness, break, e1RM mapping) which round **down**, and increases which round **up** to at least one `step_kg` above the old load. Never output a negative load. Results carry at most 2 decimals.

## 1. Calculations

- `e1rm(w, reps, rir) = w × (1 + (reps + (rir ?? 0)) / e1rm.divisor)`. For bodyweight exercises e1RM uses the logged added load and is only used for trends when > 0. Measures other than `reps` produce no e1RM.
- Session e1RM per exercise = best (max) over its working sets in that session.
- **Fractional sets:** each working set adds `fractional_sets.primary` to each primary muscle and `fractional_sets.secondary` to each secondary muscle of the exercise actually performed.
- **kg lifted** = Σ weight × reps over working strength sets with measure `reps`; `per_hand` exercises count × 2.

## 2. Weeks, block and phases

**Calendar weeks.** Week 1 starts on the Monday of `settings.block_start_date`. `weeks` lists every calendar week from there through the current one.

**Week counts.** `strength_done` = qualifying strength sessions; `cardio_done` = qualifying cardio sessions. `floor_reached = strength_done ≥ week.strength_floor`. `target_reached = strength_done ≥ strength_target AND cardio_done ≥ cardio_target`. `bonus_done = max(0, strength_done − strength_target) + max(0, cardio_done − cardio_target)`.

**Zero week** (`rule_id: event.zero_week`): a completed calendar week (Sunday has passed) with no qualifying session of the kinds in `week.zero_week_counts`.

**Status.** future; current and below floor → `in_progress`; floor → `floor`; target → `target`; completed below floor with ≥1 session → `below_floor`; completed zero → `zero`.

**Training week index.** Phases follow training weeks, not calendar weeks. Walk calendar weeks in order with `tw = 1`: a calendar week gets the current `tw`; after a completed week that was **not zero**, `tw += 1`; after a zero week, `tw` stays (the block extends by one week, `extension_weeks += 1`). Repairs do not change `tw`.
- **Long break** (`event.break_long`): if the first qualifying session after a gap of more than `break.short_days_max` days falls in a calendar week whose `tw > break.long_restart_week`, that week's `tw` becomes `long_restart_week` and counting continues from there. For the current week with no session yet, apply the same prospectively when `today − last session date > short_days_max`.
- **Block complete** when the current `tw > program.block_weeks`. Then `next` still works (consolidate rules repeat) and a `block_complete` nudge says "Block done. Plan the next 12 weeks."

**Phase** of a training week: the `program.phases` entry whose `week_from ≤ tw ≤ week_to`, except the deload week (below).

**Deload week.** Planned at `deload.planned_week`. **Reactive deload** (`event.reactive_deload`, max `reactive_deload.max_per_block` per block): evaluated after each finished session on the replayed history. Triggers when any of:
1. **e1RM drop:** at least `e1rm_drop_lifts` main lifts (prescriptions in `program.main_lifts`) whose latest progression eligible e1RM is ≤ (1 − `e1rm_drop_pct`) × the e1RM `e1rm_drop_span_sessions` exposures earlier.
2. **Missed reps:** at least `missed_reps_exercises` exercises whose last `missed_reps_sessions` progression eligible exposures were all *below range* (section 3).
3. **Check-ins:** the last `checkin_days` check-ins on consecutive local dates all have average ≤ `checkin_avg_max`.

When it triggers during training week *k* and *k + 1* < planned week, training week *k + 1* becomes the deload week, the planned week 8 deload is cancelled (week 8 takes the phase before it, i.e. build) and `block.deload_week = k + 1`. If *k + 1* ≥ planned week (deload already done or next), it does not trigger; instead emit flag `deload_criteria_met`. A `reactive_deload` flag is emitted when it triggers.

**Deload rules** (`phase.deload`): sets = `deload.sets_factor` × the sets the `deload.sets_base_phase` rule would give, rounded per `sets_rounding`, at least `deload.min_sets`. Same loads (the base target, no increase). RIR from the deload phase. Cardio is replaced by `program.cardio.deload_easy_min` minutes easy. Deload sessions count fully toward floor and target. **No progression decision comes out of a deload session** (`phase.deload_hold`): tracks keep their base.

## 3. Tracks and double progression

**Tracks.** Load progression is tracked per **exercise + rep range**: key `<exercise_id>@<rep_min>-<rep_max>`, where the rep range is the prescription's, or the alternative's override when the exercise is used as an alternative. So Romanian deadlift as light A4 (8 to 10) and as heavy B1 alternative (6 to 8) progress separately, while seated cable row in A3 (8 to 12) and C3 (10 to 12) are separate tracks too. e1RM statistics (`stats`) are per exercise across all tracks.

**Sets per exercise** for a phase rule: main lifts (`prescription.main_lift`) get `main_lift`, other starred get `starred`, non starred get `prescription.sets` capped by `other_cap` when not null. Travel (`TRAVEL`) uses its program sets (rounds) and ignores phase set rules. Target RIR = phase `rir_min`; `rir_range = [rir_min, rir_max]`.

**First exposure of a track** (no finished progression eligible exposure yet):
- `calib.remembered`: `settings.remembered_weights[exercise_id]` exists → weight = remembered.weight × `settings.start_pct`, rounded nearest. Reps = `calibration.first_exposure_target` end of the range. Explanation e.g. "Week 1: 60% of your remembered 100 kg × 5. It should feel light."
- `calib.e1rm_map`: the exercise has e1RM history from another track → weight = e1RM / (1 + (target_reps + target_rir)/divisor), rounded down.
- `calib.pick`: otherwise `weight = null`, `calibration = true`, reps = `calibration.calibration_reps` clamped to the range, rir ≥ `calibration_min_rir`. Explanation: "No history yet: pick a weight you could lift about 8 times with 3 or more reps left."
- For `bodyweight` exercises without remembered weight the first exposure is weight 0 at the first-exposure reps (`calib.bodyweight`).

**Evaluating an exposure.** Only finished, progression eligible sessions (section 4 lists the exclusions). Take the working, non top sets of the exercise in that session for this track. `load` = the maximum weight among them. Sets at a lower weight count as not reaching the top. Let `target_rir` be the phase `rir_min` of the session's training week.

Rules, first match wins (`progression_rule: double`):

| rule_id | Condition | Next base | Explanation (example) |
|---|---|---|---|
| `dp.pain` | any set of the exercise in the session has `pain_flag` | same load, same reps target; suggest an allowed alternative | "Pain logged: no load increase, swap suggested." |
| `dp.reset` | below range now and in the previous `reset.consecutive_below − 1` exposures of this track | load × (1 − pct), rounded down; reps = rep_min. pct = `pct_max` if every set was below rep_min in all those exposures, else `pct_min` | "Missed range twice: reset load −5% to 75 kg." |
| `dp.below_range` | at least `below_range_min_sets` sets with reps < rep_min | same load, reps = hold target | "Below range: hold load, check fatigue, rest and technique." |
| `dp.large_jump` | phase `large_jumps` is true, rir ≥ target on every set, every set reps ≥ rep_max + `large_jump.all_sets_min_over`, and at least `share_sets_over` of the sets reach rep_max + `reps_over` | load × (1 + pct) rounded up, reps = after_increase target. pct interpolates linearly from `pct_min` at an *average* extra of `reps_over` (or less) to `pct_max` at `reps_over_for_max` or more. Must be ≥ one step_kg | "Beat range by 2+ reps in return phase: larger jump to 85 kg." |
| `dp.increase` | every set reps ≥ rep_max at rir ≥ target (rir null counts as meeting target) | load + `step_kg`, reps = `after_increase_target` | "All sets hit top of range at RIR 2: +2.5 kg." |
| `dp.hold_rir` | every set reps ≥ rep_max but some rir < target | same load, reps = rep_max | "Top of range but harder than planned: same load." |
| `dp.hold_add_reps` | otherwise (within range) | same load, reps = `hold_target` | "Within range: same load, add reps." |

Bench press examples (prescription 3 × 6 to 8, target RIR 2, 80 kg, step 2.5, increment 2.5): 8,8,8 @ RIR ≥2 → 82.5 × 6 (`dp.increase`). Return phase 10,10,9 @ RIR ≥ target → every set ≥ 9, two of three sets ≥ 10, average extra 1.67 → pct_min 5% → 84 rounded up → 85 × 6 (`dp.large_jump`; see DECISIONS.md D7 for why 10,10,9 qualifies). 8,7,6 → 80 × 8 (`dp.hold_add_reps`). 6,5,4 → 80, flag `below_range` (`dp.below_range`, two sets below 6). Below range two exposures running → −5% (some sets in range) or −10% (every set below range both times), rounded down (`dp.reset`).

**Caps.** Any increase is capped at `progression.max_jump_pct` above the previous load (rounded down to the increment, but at least one step). In the return phase the e1RM stored in `stats` may rise at most `return_e1rm_cap_pct` per session (`cap.return_e1rm`); the uncapped value is kept in the decision's inputs_snapshot.

**`reps_only`** tracks (planks, hanging knee raise, push-ups, assisted pull-ups): reps (or seconds) progress the same way with load fixed; when every set reaches rep_max → `ro.top`: "Top of range: add load or pick a harder variation." Below range → `ro.below_range` hold. Otherwise `ro.add_reps`.

**`none`** tracks: log only, `none.log` "Log only."

**Stall** (`event.stall`): an exercise whose best e1RM has not improved over the last `stall.exposures` progression eligible exposures (its e1RM did not exceed the best from before those exposures). Emits a `stall` flag "Bench press: no e1RM gain in 3 sessions. Try a variation or a new rep range." and sets `stalled` on the planned exercise and stats.

## 4. Session modifiers (planning)

`planSession` starts from each track's base target, then applies, in this order:

1. **Swaps.** Effective exercise per prescription: session swap (`opts.swaps`) > block swap (`settings.block_swaps`) > limitation swap > program default. **Limitation swap** (`swap.limitation`): if the default exercise has a tag in any active limitation's `avoid_tags`, or the limitation has `prefer_tags` and the default lacks them while an alternative has them, use the first allowed alternative that has a prefer tag (else the first allowed). Alternatives are marked `allowed = false` with a reason when they carry an avoid tag. Main lifts are never block swapped (session swaps are fine).
2. **Phase sets and RIR** (section 3), or deload rules.
3. **Short version** (`mode: short`, `mode.short`): only starred prescriptions, sets − `short_version.set_reduction` (min `min_sets`). Progression applies to logged sets as normal.
4. **Travel** (`code: TRAVEL`, `mode: travel`): the travel day prescriptions, rounds from the day, progression as normal on their own tracks. Does not advance the A, B, C rotation.
5. **Comeback after a zero week** (`event.comeback`): the first strength session after a completed zero week (no qualifying session since that week ended). Sets − `comeback.set_reduction` (min `min_sets`), same loads. Flag `comeback`, mode stays as chosen (or `comeback` when the UI starts it from the nudge). No progression decision from it (`event.comeback_hold`).
6. **Short break** (`event.break_short`): last qualifying session was `short_days_min`..`short_days_max` days ago (inclusive) → loads × `short_load_pct` (rounded down) for every session in the `short_duration_days` days starting at the first session back. Flag `break_resume`. No progression decisions from those sessions (`event.break_hold`). **Long break** (> `short_days_max`): restart the return phase at `long_restart_week` (section 2) with loads × `long_load_pct` for the first session back, flag `long_break_restart`; that session yields no progression decision, later ones progress normally. When a break and a zero week comeback both apply, apply both (fewer sets and lower loads).
7. **Readiness** (`event.readiness`) from today's check-in (local date = plan date): average of the four scores (all 1..5, higher is better). If average ≤ `readiness.threshold`: drop sets per the last `set_drops` entry whose `max_avg ≥ average` (more severe wins), min `readiness.min_sets`; load cut pct interpolates linearly from `at_threshold_pct` (at threshold) to `at_floor_pct` (at `floor_avg` or lower), rounded to the nearest `pct_step`; applied to the scope in config (`first_exercise` = the first exercise in program order that is in the plan). Intervals are swapped for `cardio_swap_easy_min` easy. Banner names the lowest score first: "Sleep 2/5: Back squat −7.5%, 1 set dropped per exercise." Exercises whose load was cut yield no progression decision from that session (`event.readiness_hold`); others progress normally.
8. **Consolidate top set** (`phase.top_set`): in a phase with `top_set`, each main lift gets one extra set of `kind: top` at `top_set.rir` for rep_min reps, weight = latest e1RM / (1 + (rep_min + rir)/divisor) rounded down. Flag `consolidate_top_set`. The summary compares its e1RM with the first e1RM of the block.
9. **Session volume cap** (`volume.session_cap`): if any tracked muscle would exceed the cap in fractional sets for this session, remove sets from non starred exercises first (last in order first), then starred non main, never below 1 set; decision `volume.session_cap`.

**Progression eligible** = finished, strength or travel, not deload, not comeback, not break resume / long break first session, and for readiness only the exercises without a load cut.

## 5. Next session, cardio and nudges

- **Next in line** (`plan.next_in_line`): rotation = `settings.session_order`. Next = the code after the last qualifying strength session's code (A, B or C; travel sessions do not advance it unless `program.travel.advances_rotation`). No history → first in rotation ("First session of the block"). A missed day changes nothing: there is nothing to reschedule.
- **Never stack** (`plan.never_stack`): if a qualifying strength session already happened today, `next.done_today = true` and its reason says "Done for today. Next: Session C, whenever it fits." Cardio on the same day is fine.
- **Cardio** (`cardio.intervals` / `cardio.easy` / `cardio.deload` / `cardio.readiness_swap`): protocol by the current training week from `program.cardio.protocols` (training weeks > 12 use the last protocol). Deload week → easy for `deload_easy_min`. Readiness adjusted today → easy. `counts_as = target` until `cardio_done ≥ cardio_target`, else `bonus` (then an easy session is suggested). Modality options from `settings.interval_modality` (both → bike and rower; prefer bike or rower for intervals).
- **Never miss twice** (`event.never_miss_twice`): when the current week's floor is not reached and at least `never_miss_twice.hours` have passed since the last qualifying strength session (or since block start if none), nudge: "Never miss twice: ★ 30 min version of B is enough today." with action `{ mode: short, code: next }`. Not shown when `done_today`.
- **Comeback nudge** (`event.comeback`): when the next session is a comeback session: "Coming back is easy on purpose: one set less, same weights."
- **Break nudges** (`event.break_short` / `event.break_long`).
- **Book floor** (`event.book_floor`): on Sundays, and Mondays with no session yet: "Book your two floor sessions for the week."
- **Sunday review** (`event.sunday_review`): on Sundays.

## 6. Spacing warnings (never block)

- `spacing.consecutive_strength`: starting strength would make more than `max_consecutive_strength_days` consecutive local days with a qualifying strength session.
- `spacing.hard_cardio_before_heavy`: starting `A` or `B` (`heavy_days`) within `hard_cardio_before_heavy_hours` after a hard cardio log; and starting hard cardio when the next strength session in line is a heavy day: "Next up is A. Keep hard cardio a day away, or go easy today."

## 7. Volume and analytics

- Weekly fractional sets per tracked muscle from finished and in progress sessions. `band` = `{band_min, band_max}` when the week's phase is in `volume.band_phases`. Flags `volume_low` / `volume_high` only for completed weeks in band phases.
- WHO minutes = Σ easy minutes + Σ hard_minutes × `who.hard_multiplier` + (minutes − hard_minutes) for hard sessions + walking minutes. Target `who.weekly_minutes`.
- `readiness_trend` flag when the last 7 days' check-in average is ≤ `readiness.threshold`.

## 8. Repairs and streak

- A completed, unrepaired zero week `can_repair` when no other week within the previous `repair.window_weeks − 1` calendar weeks (and the following ones up to now) is repaired, and at most `max_per_window` repairs exist in any window of `window_weeks`. Repair is a streak freeze: a repaired zero week counts in `weeks_without_zero` and does not break `current_run`, but it is still a zero week for the engine (comeback, no phase advance).
- `weeks_without_zero` counts completed non zero weeks + repaired zero weeks + the current week once it has a qualifying session. `floor_weeks` and `target_weeks` count completed weeks plus the current week once reached.
- Dots: index i (0..11) is training week i+1: the status of the last non zero calendar week with that training week (`target`, `floor`, `below_floor`), `current` for the current training week if not yet floor/target, else `future`.

## 9. Session summary

`summarizeSession` lists, per exercise logged, the progression decision produced by this session (`from` = the base before, `to` = the new base, `explanation`), or the hold rule when the session was not progression eligible, plus e1RM PRs (session e1RM > previous best) and the updated week state. Example line: "Bench press +2.5 kg: all sets hit 8 reps at RIR 2."
