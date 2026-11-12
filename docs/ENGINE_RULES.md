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
- **Decision ids** are deterministic: progression `d:<source_session_id>:<exercise_id>@<rep_min>-<rep_max>`; first exposure `d:init:<exercise_id>@<rep_min>-<rep_max>`; plan level `d:plan:<YYYY-MM-DD>:<code>:<rule_id>`; week/event level `d:event:<rule_id>:<week_id or session_id>`; body and fuel `d:body:targets` and `d:body:kcal:<week start>` (section 10). `date` is the source session's `ended_at` (or `ctx.now` for plan level). `updated_at` = `date`, `deleted_at` = null.
- **Rounding.** Loads round to the exercise's increment (`settings.increment_overrides[exercise_id]` ?? `exercise.increment_kg`) with `nearest`, except reductions (reset, readiness, break, e1RM mapping) which round **down**, and increases which round **up** to at least one `step_kg` above the old load. Never output a negative load. Results carry at most 2 decimals.

## 1. Calculations

- `e1rm(w, reps, rir) = w × (1 + (reps + (rir ?? 0)) / e1rm.divisor)`. For bodyweight exercises e1RM uses the logged added load and is only used for trends when > 0. Measures other than `reps` produce no e1RM.
- Session e1RM per exercise = best (max) over its working sets in that session.
- **Fractional sets:** each working set adds `fractional_sets.primary` to each primary muscle and `fractional_sets.secondary` to each secondary muscle of the exercise actually performed.
- **kg lifted** = Σ weight × reps over working strength sets with measure `reps`; `per_hand` exercises count × 2.

## 2. Weeks, block and phases

**Calendar weeks.** Week 1 starts on the Monday of `settings.block_start_date`. `weeks` lists every calendar week from there through the current one.

**Training before the block** (D18). Sessions dated in the 7 days before that Monday (the previous calendar week) belong to week 1: they count in `strength_done`, `cardio_done`, floor, target, zero week, `session_ids`, volume and walking minutes, and they progress as training week 1 (return phase) like any week 1 session. They also set the block's first e1RM. Older sessions belong to no week. Week 1 keeps its Monday as `start_date`. Before the block starts, `next` is the first session in rotation (Session A) planned as training week 1, and nothing is recommended short.

**Week counts.** `strength_done` = qualifying strength sessions; `cardio_done` = qualifying cardio sessions. `floor_reached = strength_done ≥ week.strength_floor`. `target_reached = strength_done ≥ strength_target AND cardio_done ≥ cardio_target`. `bonus_done = max(0, strength_done − strength_target) + max(0, cardio_done − cardio_target)`.

**Zero week** (`rule_id: event.zero_week`): a completed calendar week (Sunday has passed) with no qualifying session of the kinds in `week.zero_week_counts`.

**Status.** future; current and below floor → `in_progress`; floor → `floor`; target → `target`; completed below floor with ≥1 session → `below_floor`; completed zero → `zero`.

**Training week index.** Phases follow training weeks, not calendar weeks. Walk calendar weeks in order with `tw = 1`: a calendar week gets the current `tw`; after a completed week that was **not zero**, `tw += 1`; after a zero week, `tw` stays (the block extends by one week). Repairs do not change `tw`.
- **Long break** (`event.break_long`): if the first qualifying session after a gap of more than `break.short_days_max` days falls in a calendar week whose `tw > break.long_restart_week`, that week's `tw` becomes `long_restart_week` and counting continues from there. For the current week with no session yet, apply the same prospectively when `today − last session date > short_days_max`.
- **Extension.** `extension_weeks` = the current week's calendar index − its `tw`: how many calendar weeks the block runs longer than planned. That is the zero weeks plus the weeks a long break restart took back (D24).
- **Block complete** when the current `tw > program.block_weeks`. Then `next` still works (consolidate rules repeat) and a `block_complete` nudge says "Block done. Plan the next 12 weeks."

**Phase** of a training week: the `program.phases` entry whose `week_from ≤ tw ≤ week_to`, except the deload week (below).

**Deload week.** Planned at `deload.planned_week`. **Reactive deload** (`event.reactive_deload`, max `reactive_deload.max_per_block` per block): evaluated after each finished session on the replayed history. Triggers when any of:
1. **e1RM drop:** at least `e1rm_drop_lifts` main lifts (prescriptions in `program.main_lifts`) whose latest progression eligible e1RM is ≤ (1 − `e1rm_drop_pct`) × the e1RM `e1rm_drop_span_sessions` exposures earlier.
2. **Missed reps:** at least `missed_reps_exercises` exercises whose last `missed_reps_sessions` progression eligible exposures were all *below range* (section 3). Only exposures on `double` tracks with added load (`load > 0`) count; below range at bodyweight or on a `reps_only` track breaks the run (D21).
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
| `dp.bodyweight_hold` | the `dp.reset` condition, but `load` is 0 (bodyweight, no added load): there is nothing to take off | load 0, reps = rep_min; the explanation names an easier option: the first alternative (other than the exercise itself) that is not bodyweight, else the first alternative (D21) | "Below range at bodyweight twice: aim for 6 reps, or try Lat pulldown for now." |
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
3. **Short version** (`mode: short`, `mode.short`): only starred prescriptions, sets − `short_version.set_reduction` (min `min_sets`). Progression applies to logged sets as normal. When the session is also a comeback (step 5) the two reductions do not add up: sets − the larger of the two (with that rule's `min_sets`) (D20).
4. **Travel** (`code: TRAVEL`, `mode: travel`): the travel day prescriptions, rounds from the day, progression as normal on their own tracks. Does not advance the A, B, C rotation.
5. **Comeback after a zero week** (`event.comeback`): the first strength or travel session after a completed zero week (no qualifying *strength or travel* session since that week ended; a cardio session in between does not cancel it). When `comeback.overrides_short_break` is true, a comeback session does not also start the short break window: same weights, as PROGRAM.md rule 4 promises. It also ends a short break window that a cardio session after the zero week had already started, and a comeback started by hand (mode `comeback`) overrides it the same way. Sets − `comeback.set_reduction` (min `min_sets`), same loads. Flag `comeback`, mode stays as chosen (or `comeback` when the UI starts it from the nudge). No progression decision from it (`event.comeback_hold`).
6. **Short break** (`event.break_short`): last qualifying session was `short_days_min`..`short_days_max` days ago (inclusive) → loads × `short_load_pct` (rounded down) for every session in the `short_duration_days` days starting at the first session back. Flag `break_resume`. No progression decisions from those sessions (`event.break_hold`). **Long break** (> `short_days_max`): restart the return phase at `long_restart_week` (section 2) with loads × `long_load_pct` for the first session back, flag `long_break_restart`; that session yields no progression decision, later ones progress normally. When a long break and a zero week comeback both apply, apply both (fewer sets and lower loads). A short break and a comeback: see `comeback.overrides_short_break`.
7. **Readiness** (`event.readiness`) from today's check-in (local date = plan date). In replay, readiness holds come from the session's own `flags` (contains `readiness`, written when the session was started or when a check-in was saved during it), never from a check-in recomputed after the fact: average of the four scores (all 1..5, higher is better). If average ≤ `readiness.threshold`: drop sets per the last `set_drops` entry whose `max_avg ≥ average` (more severe wins), min `readiness.min_sets`; load cut pct interpolates linearly from `at_threshold_pct` (at threshold) to `at_floor_pct` (at `floor_avg` or lower), rounded to the nearest `pct_step`; applied to the scope in config (`first_exercise` = the first exercise in program order that is in the plan). Intervals are swapped for `cardio_swap_easy_min` easy. Banner names the lowest score first and says what actually changed, after rounding and the `min_sets` clamp (D25): one exercise cut → its loads ("Sleep 2/5: Back squat 65 → 60 kg, 1 set dropped per exercise."); several cut (scope `main_lifts` / `all`) → "Main lifts about −5%"; sets → the most sets any exercise lost, "per exercise" when every exercise lost that many, else "where there was room"; nothing changed (already at `min_sets`, no weight to cut) → "Sleep 2/5: noted. The session is already light, nothing more to take off." Exercises whose load was cut yield no progression decision from that session (`event.readiness_hold`); others progress normally.
8. **Consolidate top set** (`phase.top_set`): in a phase with `top_set`, each main lift gets one extra set of `kind: top` at `top_set.rir` for rep_min reps, weight = latest e1RM / (1 + (rep_min + rir)/divisor) rounded down, but at least today's work weight + `step_kg` (rounded up to the increment), so the top set is never at or below the weight of the work sets before it (D22). Flag `consolidate_top_set`. The summary compares its e1RM with the first e1RM of the block.
9. **Session volume cap** (`volume.session_cap`): if any tracked muscle would exceed the cap in fractional sets for this session, remove sets from non starred exercises first (last in order first), then starred non main, never below 1 set; decision `volume.session_cap`.

**Progression eligible** = finished, strength or travel, not deload, not comeback, not break resume / long break first session, and for readiness only the exercises without a load cut.

## 5. Next session, cardio and nudges

- **Next in line** (`plan.next_in_line`): rotation = `settings.session_order`. Next = the code after the last qualifying strength session's code (A, B or C; travel sessions do not advance it unless `program.travel.advances_rotation`). No history → first in rotation ("First session of the block"). A missed day changes nothing: there is nothing to reschedule.
- **Never stack** (`plan.never_stack`): if a qualifying strength session already happened today, `next.done_today = true` and its reason says "Done for today. Next: Session C, whenever it fits." Cardio on the same day is fine.
- **Cardio** (`cardio.intervals` / `cardio.easy` / `cardio.deload` / `cardio.readiness_swap`): protocol by the current training week from `program.cardio.protocols` (training weeks > 12 use the last protocol). Deload week → easy for `deload_easy_min`. Readiness adjusted today → easy. `counts_as = target` until `cardio_done ≥ cardio_target`, else `bonus` (then an easy session is suggested). Modality options from `settings.interval_modality` (both → bike and rower; prefer bike or rower for intervals).
- **Never miss twice** (`event.never_miss_twice`): when the current week's floor is not reached and at least `never_miss_twice.hours` have passed since the latest of: the end of the last qualifying strength session, 00:00 on the current week's Monday, and 00:00 on block start. The week bound means the count restarts each Monday, so a normal weekend gap after a good week never turns it on (D19). Nudge: "Never miss twice: ★ 30 min version of B is enough today." with action `{ mode: short, code: next }`. Not shown when `done_today`.
- **Recommended version** (`plan.recommend_short`): `next.recommended_mode = "short"` when, in this order: the never miss twice nudge is on (`event.never_miss_twice`); `settings.week_killers` has `work_peaks`, the floor is not reached and the days left in the week including today ≤ strength sessions still needed for the floor + 1 (`plan.floor_at_risk`): "Floor at risk: the 30 min version counts fully."; `week_killers` has `evenings`, `settings.evening_hour` is set and the local hour ≥ it (`plan.evening`): "After 19:00: the 30 min version counts fully." (the configured hour). Else `full` with null rule and reason. Guards: nothing is recommended before `settings.block_start_date`, only a day that has a short version recommends it, and the evening rule does not fire when `done_today` (the next session is not today). When short is recommended, a plan decision `d:plan:<today>:<code>:<rule_id>` with `recommended_reason` as its explanation is added to `next.plan.decisions` and `state.decisions`.
- **Comeback nudge** (`event.comeback`): when the next session is a comeback session: "Coming back is easy on purpose: one set less, same weights."
- **Break nudges** (`event.break_short` / `event.break_long`).
- **Book floor** (`event.book_floor`): on Sundays, and Mondays with no session yet: "Book your two floor sessions for the week."
- **Sunday review** (`event.sunday_review`): on Sundays.

## 6. Spacing warnings (never block)

- `spacing.consecutive_strength`: starting strength would make more than `max_consecutive_strength_days` consecutive local days with a qualifying strength session.
- `spacing.hard_cardio_before_heavy`: starting `A` or `B` (`heavy_days`) within `hard_cardio_before_heavy_hours` after a hard cardio log; and starting hard cardio when the next strength session in line is a heavy day: "Next up is A. Keep hard cardio a day away, or go easy today."

## 7. Volume and analytics

- Weekly fractional sets per tracked muscle from finished and in progress sessions. `band` = `{band_min, band_max}` when the week's phase is in `volume.band_phases`. Flags `volume_low` / `volume_high` only for the last completed week, when it is in a band phase and not a zero week, and only where the week is outside the band **and** further from it than the program as written (D23): `volume_low` when sets < `band_min` and < the program's sets, `volume_high` when sets > `band_max` and > the program's sets. The program's sets for a training week = `week.strength_target` sessions in rotation order, default exercises (no swaps), phase or deload sets, fractional per section 1.
- WHO minutes = Σ easy minutes + Σ hard_minutes × `who.hard_multiplier` + (minutes − hard_minutes) for hard sessions + walking minutes. Target `who.weekly_minutes`. A session's cardio log counts in the week of the session (its `started_at` local date, like the session counts), even when the log's own date is the next day. Walks go by their date.
- `readiness_trend` flag when the last 7 days' check-in average is ≤ `readiness.threshold`.

## 8. Repairs and streak

- A completed, unrepaired zero week `can_repair` when no other week within the previous `repair.window_weeks − 1` calendar weeks (and the following ones up to now) is repaired, and at most `max_per_window` repairs exist in any window of `window_weeks`. Repair is a streak freeze: a repaired zero week counts in `weeks_without_zero` and does not break `current_run`, but it is still a zero week for the engine (comeback, no phase advance).
- `weeks_without_zero` counts completed non zero weeks + repaired zero weeks + the current week once it has a qualifying session. `floor_weeks` and `target_weeks` count completed weeks plus the current week once reached.
- Dots: index i (0..11) is training week i+1: the status of the last non zero calendar week with that training week (`target`, `floor`, `below_floor`), `current` for the current training week if not yet floor/target, else `future`.

## 9. Session summary

`summarizeSession` lists, per exercise logged, the progression decision produced by this session (`from` = the base before, `to` = the new base, `explanation`), or the hold rule when the session was not progression eligible, plus e1RM PRs (session e1RM > previous best) and the updated week state. PRs come only from e1RMs that update `stats` (progression eligible, so a hold session never reports one that the next session reports again), and never from bodyweight exercises (their e1RM is added load only, kept for trends). Example line: "Bench press +2.5 kg: all sets hit 8 reps at RIR 2."

## 10. Body and fuel

`computeBody({ config, settings, bodyLogs, now })` returns a `BodyState`. It is separate from `computeState`: it reads body logs and settings only, and nothing in sections 1 to 9 depends on it. Pure and deterministic like the rest: `now` comes in, same input gives the same output and the same decision ids. Every threshold is in `config.body`.

**Units.** In `config.body`, every key ending in `_pct` is **percent of body weight per week** (0.5 means 0.5%), the same unit as `settings.cut_rate_pct`. That differs from the fractions used by the `_pct` keys in the other config groups.

**Inputs.**
- `body_log`: one row per local date (`bd_YYYY-MM-DD`), every value optional. Ignored: deleted rows, rows dated after today, rows without any value. Two rows for one date: the newest `updated_at` wins (then the higher id).
- A **weigh-in** is a row with `weight_kg`. `steps`, `protein_g` and `kcal` are the day's running totals.
- **Today** is the local date of `now` in `settings.timezone` (config default when it is not valid), like section 0.
- Settings rows stored before the body fields existed take: no profile, `job_activity` desk, `goal` cut, `cut_rate_pct` = `cut_rate.default_pct`, `steps_target` = `steps_target_default`. `cut_rate_pct` is held inside `cut_rate.min_pct`..`max_pct`.

**Trend.** For each calendar day D, the trend value is the mean of the weigh-ins in the `trend.window_days` days ending on D, when that window holds at least `trend.min_weigh_ins` of them, else null. Rounded to 2 decimals.
- `series`: one point `{ date, weight, avg }` per calendar day from the first log through today, at most the last `series_max_days` days. Days without a weigh-in have `weight: null`.
- `latest_weight`: the most recent weigh-in. `trend_weight`: the most recent non null trend value. `start_weight`: the first trend value in the whole history (not only the series), or the first weigh-in while there is no trend yet. `change_kg = trend_weight − start_weight`.
- **Current weight** (`current_weight`, used by the targets and shown on screen): `trend_weight` when its day is on or after the last weigh-in (`current_is_trend` true), else `latest_weight`. So one weigh-in after a long pause counts at once.

**Rate.** Needs a trend value for today. The reference is the trend value `rate.span_days` days ago, or the nearest later day that has one, at least `rate.min_span_days` back. The **days between** are counted from where the two averages really sit: each trend value has a center, the mean day of the weigh-ins in its window, and a reference whose center is less than `rate.min_span_days` before today's center is passed over (D30). `rate_kg_per_week = (today − reference) / days between × 7`, `rate_pct_per_week = rate_kg_per_week / reference × 100`. Both signed (negative = losing), 2 decimals. Without a trend today or a reference: null.

**Profile.** `missing` lists what the calorie target still needs, in this order: `sex`, `birth_year`, `height_cm`, `weight` (no weigh-in yet). `profile_complete` when it is empty.

**Targets** (`targets`, decision `d:body:targets`, dated `now`, its `explanation` = `targets.reason`).
- **Maintenance:** Mifflin St Jeor BMR = `mifflin.per_kg` × current weight + `mifflin.per_cm` × `height_cm` − `mifflin.per_year` × age + `male_offset` or `female_offset`, where age = local year of `now` − `birth_year`. `maintenance_kcal` = BMR × `activity_factor[job_activity]`, rounded to a whole kcal. null until the profile is complete. The factor covers the job plus the program's training.
- **Goal offset** (`goal_offset_kcal`): cut = −(`cut_rate_pct` / 100 × current weight × `kcal_per_kg_fat` / 7), rounded to a whole kcal (0 while there is no weight); recomp = `recomp_offset_kcal`; gain = `gain_offset_kcal`.
- **Calories:** `maintenance_kcal + goal_offset_kcal + adjustments_kcal`, rounded to the nearest `kcal_round_to`, never below `kcal_floor[sex]`. null until the profile is complete.
- **Protein:** `protein.g_per_kg` × current weight, rounded to `protein.round_to_g`. **Fat minimum:** `fat.min_g_per_kg` × current weight, rounded to `fat.round_to_g`. Both null until there is a weight. **Steps:** `settings.steps_target`.
- **Overrides:** `settings.kcal_override` and `settings.protein_override_g` win when set (a stored 0 counts as not set), also before the profile is complete and below the floor (it is the user's own number). `maintenance_kcal`, `goal_offset_kcal` and `adjustments_kcal` still show the engine's estimate; the decision output carries `estimate_kcal`.

| rule_id | When | Reason (example) |
|---|---|---|
| `body.overrides` | both overrides set | "Your own targets: 1900 kcal and 150 g protein." |
| `body.kcal_override` | `kcal_override` set | "Your own calorie target, the estimate is 2050 kcal." |
| `body.protein_override` | `protein_override_g` set | "About 2492 kcal to hold weight, minus 467 to lose 0.5% a week, with your own protein target." |
| `body.setup` | no calorie target yet | "Add sex, birth year, height and a weigh-in to get a calorie target." |
| `body.kcal_floor` | the floor was applied | "Held at the 1500 kcal floor, the estimate came out lower." |
| `body.cut` | goal cut | "About 2492 kcal to hold weight, minus 467 to lose 0.5% a week." |
| `body.recomp` | goal recomp | "About 2492 kcal to hold weight, minus 100 for a slow recomp." |
| `body.gain` | goal gain | "About 2492 kcal to hold weight, plus 250 to gain slowly." |

First match wins, top to bottom. With adjustments the reason ends ", minus 100 from your trend." (or plus).

**Pace** (`pace`, `pace_text`). Compared on `rate_pct_per_week` with `pace.tolerance_pct`; the text speaks in kg a week.

| pace | When |
|---|---|
| `setup` | the profile is not complete (wins over everything) |
| `collecting` | no rate yet |
| `fast` | cut: losing more than `cut_rate.max_pct`. gain: gaining more than `gain_rate.max_pct` |
| `on_pace` | cut: losing at least `cut_rate_pct − tolerance` (up to the max). gain: gaining at least `gain_rate.target_pct − tolerance`. recomp: within ± tolerance |
| `slow` | cut or gain: below that bar, but not moving the other way by more than the tolerance (holding still is slow) |
| `off_goal` | cut: gaining more than the tolerance. gain: losing more than the tolerance. recomp: drifting more than the tolerance either way |

Examples: "On pace: down 0.4 kg a week." · "Down 0.1 kg a week. The goal is 0.4 kg a week down." · "Holding steady. The goal is 0.4 kg a week down." · "Down 1.4 kg a week. That is fast, eat a little more." · "Up 0.3 kg a week. Recomp aims to hold weight." · "Trend started. Keep weighing in to see your pace." · "Weigh in a few mornings to see your trend."

**Weeks to goal.** null without `goal_weight_kg` or a current weight. 0 once reached (cut: current weight at or below the goal, gain: at or above). Otherwise `ceil((goal − current_weight) / rate_kg_per_week)` when the rate points at the goal, null when it is flat, points away, or the answer is more than `goal.max_weeks`.

**Weekly adaptive adjustment** (`adjustments_kcal`, one decision per applied step). Replayed from the logs on every call: walk the calendar weeks (Monday to Sunday) from the week after the first log's week through the last **completed** week (its Sunday is before today), with a running total starting at 0 (or at the carried over correction, see below).
1. Skip the week when it or the week before has fewer than `adjustment.min_weigh_ins` weigh-ins, or when it has protein logged (above 0) on fewer than `adjustment.min_protein_days` days. Thin data never moves the target.
2. `gap_days` = mean day of the week's weigh-ins − mean day of the weigh-ins of the week before. Skip the week when it is under `adjustment.min_gap_days`. `change_pct` = (mean weight of the week − mean of the week before) / mean of the week before × 100 × 7 / `gap_days`, 2 decimals. Two fully weighed weeks are 7 days apart, so nothing changes for them; a week weighed only at its end is no longer read as a slow week (D30).
3. The step, with `tolerance = adjustment.tolerance_pct`:
   - **cut:** losing less than `cut_rate_pct − tolerance` (holding or gaining included) → −`step_kcal`. Losing more than `cut_rate.max_pct` → +`step_kcal`.
   - **gain:** gaining less than `gain_rate.target_pct − tolerance` → +`step_kcal`. Gaining more than `gain_rate.max_pct` → −`step_kcal`.
   - **recomp:** up more than the tolerance → −`step_kcal`. Down more than the tolerance → +`step_kcal`.
   - Otherwise nothing.
4. The running total stays within ±`adjustment.max_total_kcal`: a step is cut to what is left, and a step of 0 is no decision.

Each applied step is a decision `d:body:kcal:<Monday of the week>`, `rule_id` `body.adjust_less` or `body.adjust_more`, dated local midnight of the Monday after that week (when it starts to apply), output `{ delta_kcal, total_kcal }`. Explanations: "Down 0.1% a week against a 0.5% goal: 100 kcal less." · "Down 1.28% a week, faster than the 1% limit: 100 kcal more." · "Flat this week against a 0.5% goal: 100 kcal less." · "Up 0.35% a week while holding weight: 100 kcal less."

**A changed goal or pace never re-judges the past** (D30, replaces the replay rule of D26). The app sets `settings.body_adjust_since` to today's local date and `settings.body_adjust_base_kcal` to the `adjustments_kcal` of that moment whenever `goal` or `cut_rate_pct` changes. With `body_adjust_since` set, the running total starts at `body_adjust_base_kcal` (held within ±`max_total_kcal`) and weeks whose Monday is before that date are skipped: they were judged against the goal of their time, and the week of the change itself is mixed. The weeks from the first Monday on or after that date are judged against the current `goal` and `cut_rate_pct`. Without `body_adjust_since` every week since the first log counts. Adjustments do not need the profile. The floor still holds after them.

**Today.** `log_today` is today's row. `weighed_today`: it has a weight. `protein_today` and `steps_today`: its values, 0 when missing. `kcal_today`: its value or null. `protein_hit`: there is a protein target and `protein_today ≥ (1 − protein.hit_tolerance) × target`. `steps_hit`: `steps_today ≥ targets.steps`.

**Week** (`week`, the current calendar week through today): `weigh_ins`; `protein_days` = days the protein target was hit with the tolerance (without a protein target: days with protein logged); `steps_avg` = mean over the days with steps logged, whole steps, else null; `days_logged` = days with any value.

**Waist.** From the rows with `waist_cm`: `first`, `latest`, `change_cm = latest − first`, `latest_date`. null without one.

**Decisions.** `decisions` = the targets decision first, then the adjustment decisions, oldest week first. They are computed, not stored: replaying the logs gives them back.

**Copy.** Every string is one or two short sentences, plain, no guilt, no dashes as punctuation.
