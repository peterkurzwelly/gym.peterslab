# Workout OS · Build spec

Version 1.1 · 2026-11-08 · Consistency first · Owner: Peter · Builder: Claude Code

This spec is the source of truth for the build. Read it fully before writing code. When something is unclear, ask instead of guessing. Every number in the engine lives in config, never hard coded.

## 1. What we are building

A personal training app for one user (Peter) on iPhone. **Its primary job is consistency:** Peter has trained a lot over the years, but in bursts (four sessions one week, none the next, then a month off). The app exists to get him through 12 weeks without a zero week. Second, it tells him what to do next, lets him log each set in one or two taps, sets the next session's targets from what he actually did, and explains every change.

The training content is defined in `PROGRAM.md`. This spec defines how the app runs it.

**Single user.** No onboarding flow, no multi tenancy, no sign up. Peter's settings live in a config file and a settings screen.

**Design principles**

1. **Consistency over optimization.** The week is the unit of success. Hitting the floor is a win. The app never shows a missed session as failure.
2. **No fixed days.** The app always offers the next session in line, whenever it fits.
3. The deterministic engine owns every number. AI only proposes and writes text.
4. Every target carries a one line reason, stored in a decision log.
5. Open the app, land on the next session, log the first set within 5 seconds.
6. Works offline in the gym. Syncs when online.

## 2. User profile and goals

| Field | Value |
|---|---|
| Primary goal | Consistency: 12 weeks without a zero week |
| Fitness goals | Strength, muscle, general health, endurance (balanced) |
| Experience | Returning lifter, history of training in bursts |
| Weekly target | 3 strength + 1 cardio. Floor: 2 strength (30 min versions OK). Bonus: 4th strength or extra easy cardio |
| Device | iPhone, Safari home screen app |
| Limitations | Configurable list, for example `shoulder_symmetry`, `knee_friendly`. **Peter to confirm actual entries.** |

## 3. Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Vite + React + TypeScript, installable PWA | Fast iteration, no App Store |
| Styling | Tailwind CSS | |
| Local data | IndexedDB via Dexie | Offline first; logging never waits for network |
| Validation | Zod | Shared schemas client and server |
| API | Cloudflare Worker with Hono | Matches Peter's existing Cloudflare setup |
| Database | Cloudflare D1 (SQLite) | Source of truth for sync; free tier far exceeds one user |
| Auth | Cloudflare Access in front of the app | Zero auth code for a single user |
| Hosting | Cloudflare Pages (static) + Worker routes under `/api` | |
| Engine | Pure TypeScript package `packages/engine`, no I/O, versioned | Runs client side for offline use; fully unit tested |
| Tests | Vitest for engine and sync; Playwright for one happy path | |
| Charts | Recharts | |
| AI (phase 3) | Anthropic API called only from the Worker | Keys stay server side |

**Repo layout**

```
workout-os/
  apps/web/            # PWA
  apps/api/            # Worker (Hono) + D1 migrations
  packages/engine/     # progression, readiness, scheduling rules
  packages/schema/     # Zod schemas + shared types
  data/exercises.json  # seeded from free-exercise-db (Unlicense) + tags
  config/engine.json   # all thresholds
  config/program.json  # Peter's program
```

**Not chosen, for the record:** Next.js + Supabase (adds a second platform outside Cloudflare, server rendering adds nothing here). Native SwiftUI is phase 4, only if HealthKit or Watch data proves it would change decisions.

## 4. Screens

Three tabs: **Today**, **Plan**, **Progress**. Settings behind a gear icon.

### 4.1 Today

1. **Week card, always on top:** "Week 3 of 12 · 2 of 4 done · Floor reached ✓". Three states: below floor (neutral, shows what reaches it), floor reached (green), target reached. Weeks without a zero shown as a row of 12 dots.
2. **Next session**, not a date-bound session: "Next: Session B · ~55 min · ★ 30 min version". Cardio offered alongside if not yet done this week. Phase shown small ("Return phase").
3. **Comeback nudge:** if 48 hours pass after a planned session was missed, the card says "Never miss twice: ★ 30 min version of B is enough today." No guilt language, no red.
4. Check-in card (collapses after answering): sleep, soreness, stress, energy, each 1 to 5 chips. About 20 seconds. Skippable.
5. Adjustment banner if readiness changed anything: "Sleep 2/5: top set −7.5%, 1 set dropped."
6. Buttons: **★ 30 min version**, **Travel version**, **Swap exercise**.
7. Exercise cards. Each set row shows: target weight × reps @ RIR, last time's result, a large check button. Tap check to confirm as prescribed. Tap the numbers to adjust with steppers (±2.5 kg, ±1 rep). RIR picked from chips 0 to 4. Pain toggle per exercise, separate from soreness.
8. Rest timer starts automatically on confirm; default per exercise from config; vibrate at end where supported.
9. Finish button opens the summary: what changed for next time and why ("Bench +2.5 kg: all sets hit 8 reps at RIR 2").

Cardio sessions show modality, target duration and intensity (for 4x4: interval structure with a simple timer). Log minutes, intensity, optional average HR.

Rules: primary actions in the bottom third, no modals during logging, no keyboard unless the user taps a field.

### 4.2 Plan

1. The 12-week block as 12 rows: phase, sessions done, floor or target reached.
2. This week: done sessions, next in line, Sunday booking reminder for the two floor sessions (deep link to add them to the calendar).
3. Weekly targets: sets per muscle vs band, cardio done, walking minutes (manual, optional).
4. Edit: swap an exercise for the block, change session order.

### 4.3 Progress and weekly review

1. **Weeks without a zero** as the headline number (x of 12). Floor weeks and target weeks shown separately. One repair allowed per 4 weeks. Cumulative totals that never reset (sessions, sets, cardio minutes, kg lifted).
2. Four headline numbers: sessions vs target, sets per muscle vs band, cardio minutes vs WHO, e1RM trend on main lifts.
3. Charts: e1RM per main lift, weekly volume per muscle, cardio minutes, check-in average.
4. Flags from the engine (stalls, deload triggered, readiness trend).
5. Sunday review (2 minutes): floor hit? target hit? which exercises moved up? then "Book your two floor sessions" with calendar deep links.

## 5. Program structure

Full content (sessions, exercises, alternatives, cardio progression) lives in `PROGRAM.md` and is encoded in `config/program.json`.

| Element | Rule |
|---|---|
| Sessions | Strength A (squat + bench), B (hinge + overhead), C (volume + arms), plus Cardio (4x4 intervals) |
| Order | Strength rotates A → B → C → A, no fixed weekdays. Cardio anywhere in the week |
| Weekly target | 3 strength + 1 cardio |
| Floor | 2 strength (★ 30 min versions count). Floor reached = week counts |
| Bonus | 4th strength (next in line) or extra easy cardio |
| 30 min version | Only ★ exercises, one set fewer |
| Travel version | Dumbbell circuit, 3 rounds, counts toward floor |
| Spacing | Warn (do not block) on strength 3 days in a row, or hard cardio within 24 h before A or B |
| Walking | Optional manual log, shown against WHO minutes |

Exercise selection respects `limitations` from config, for example `knee_friendly` prefers hack squat or leg press over deep barbell squat; `shoulder_symmetry` prefers unilateral dumbbell pressing and rows. **These mappings need Peter's confirmation.**

## 6. Progression engine

Pure functions in `packages/engine`. Input: program, history, state, check-in, config. Output: targets plus `Decision[]` entries. Same input always gives the same output.

### 6.1 Core calculations

- **e1RM** from a set: Epley with RIR, `e1rm = weight × (1 + (reps + rir) / 30)`. Use the best set per session per exercise.
- **Fractional sets**: each working set counts 1.0 for the exercise's primary muscles and 0.5 for secondary.
- **Rounding**: to the exercise's `increment_kg` (barbell 2.5, dumbbell per available pair, machines per stack step).

### 6.2 Phases

| Phase | Rule |
|---|---|
| **Calibration (week 1)** | Start at `return.start_pct` (default 0.6, range 0.5 to 0.7) of remembered working weights, or derive e1RM from a set of about 8 reps stopped at RIR ≥3. No max tests before week 12. |
| **Return (weeks 1 to 4)** | 2 sets per exercise in week 1, then 3. RIR 3 to 4. Double progression with large jumps allowed (see 6.3). Cap e1RM rise at 10% per session. |
| **Build (weeks 5 to 7)** | 3 sets, starred main lifts up to 4. RIR 2. Normal increments. |
| **Deload (week 8)** | Sets halved, same loads, RIR 3 to 4. Cardio replaced by 30 min easy. Deload sessions count fully toward floor and target. |
| **Push (weeks 9 to 11)** | 3 to 4 sets. RIR 1 to 2. Normal increments. |
| **Consolidate (week 12)** | 2 to 3 sets, RIR 2 to 3, plus one top set at RIR 1 on each main lift to show progress against week 1. Then prompt to plan the next 12 weeks. |
| **Volume guardrail** | Target about 8 to 10 fractional sets per muscle per week in build and push. Per session cap 11 fractional sets per muscle. |
| **Calendar vs training weeks** | Phases follow training weeks. A zero week does not advance the phase (the block extends by one week). |

### 6.3 Double progression (accessories and return phase)

Prescription example: 3 sets × 6 to 8 reps @ RIR 2, bench press 80 kg.

| Logged | Next session | Decision text |
|---|---|---|
| 8, 8, 8 at RIR ≥ target | 82.5 kg × 6 | "All sets hit top of range at RIR 2: +2.5 kg" |
| 10, 10, 9 at RIR ≥ target (return phase) | +5% to +10% (rounded) | "Beat range by 2+ reps in return phase: larger jump" |
| 8, 7, 6 | 80 kg, aim 8, 8, 8 | "Within range: same load, add reps" |
| 6, 5, 4 (below rep_min on 2+ sets) | 80 kg, flag review | "Below range: hold load, check fatigue, rest, technique" |
| Below range 2 sessions running | −5 to −10% | "Missed range twice: reset load" |
| Pain flag on exercise | No increase; suggest substitution | "Pain logged: no load increase, swap suggested" |

### 6.4 Events

| Event | Rule |
|---|---|
| **Stall** | e1RM not improved over 3 exposures: suggest variation or rep range change; flag in weekly review. |
| **Reactive deload** | Any of: e1RM down ≥5% on 2 main lifts across 2 sessions; rep targets missed 2 sessions running on 2+ exercises; check-in average ≤2 for 3 days. Pulls the week 8 deload forward (once per block). |
| **Daily readiness** | Check-in average ≤2.25: drop 1 to 2 sets per exercise, top set −5 to −10%, swap intervals for easy cardio. Keep the session. Never diagnostic wording. |
| **Missed session** | Nothing to reschedule: the next session in line stays next. Never stack two sessions in one day. |
| **Never miss twice** | 48 h after the last session with the floor not yet reached, show the comeback nudge (★ 30 min version). |
| **Zero week** | First session back: one set fewer per exercise, same loads, no progression decision from it. Phase does not advance. |
| **30 minute mode** | Only ★ exercises, one set fewer. Progression still applies to the logged sets. |
| **Break 7 to 14 days** | Resume at 85% of previous loads for one week. Break >14 days: restart the return phase from week 2. |
| **Substitution** | Same movement pattern and primary muscle, similar fatigue rating, filtered by limitations and equipment. Map load through e1RM if history exists; else conservative estimate at RIR 3 and recalibrate. Main lifts stay fixed for the 12-week block; accessories may rotate at week 9. |
| **Interference guard** | Warn on hard cardio within 24 h before session A or B. Prefer bike or rower for intervals. |

All thresholds above live in `config/engine.json`. Rules from coaching convention rather than research are tagged `"evidence": "convention"` in config so they are easy to find and tune later.

### 6.5 Decision log

Every engine output writes a `Decision`: `{ id, date, rule_id, engine_version, inputs_snapshot, output, explanation }`. The UI shows `explanation`. The log is how Peter (and later the AI) answers "why".

## 7. Data model

Client generated ULIDs. Every row has `updated_at` and `deleted_at` (soft delete). Same schema in Dexie and D1.

| Table | Key fields |
|---|---|
| `exercise` | id, name, pattern (squat, hinge, h_push, v_push, h_pull, v_pull, lunge, carry, core, isolation), primary_muscles[], secondary_muscles[], equipment, fatigue_rating (1 to 3), increment_kg, default_rest_s, tags[] (knee_friendly, low_spinal_load), source, custom |
| `program` | id, name, split, active |
| `phase` | id, program_id, name (return, build, deload, push, consolidate), week_from, week_to, sets_rule, target_rir |
| `program_day` | id, program_id, order_index, code (A, B, C, CARDIO), name, fatigue_tag (heavy_lower, mixed, intervals), has_short_version |
| `prescription` | id, program_day_id, exercise_id, order, sets, rep_min, rep_max, target_rir, starred (in 30 min version), alternatives[], progression_rule, superset_group |
| `progression_state` | exercise_id, phase, e1rm, best_e1rm, remembered_best, last_top_set, stall_count, next_targets JSON |
| `training_week` | id, block_week_index, start_date, strength_done, cardio_done, floor_reached, target_reached, repaired, is_zero |
| `session` | id, program_day_id, training_week_id, started_at, ended_at, mode (full, short, travel, comeback), notes |
| `set_log` | id, session_id, exercise_id, prescription_id, set_index, target_weight, target_reps, target_rir, weight, reps, rir, is_warmup, pain_flag |
| `cardio_log` | id, session_id, date, modality, minutes, intensity (easy, hard), avg_hr, source |
| `checkin` | id, date, sleep, soreness, stress, energy, hrv, rhr, sleep_hours, hrv_type (sdnn, rmssd) |
| `decision` | id, date, rule_id, engine_version, inputs_snapshot JSON, output JSON, explanation |

Templates are never mutated by logging. Logs keep target and actual side by side.

**Sync:** client writes to Dexie first; an outbox pushes changes to `POST /api/sync` when online; server returns rows changed since the client's last sync timestamp. Last write wins on `updated_at`. Single user makes conflicts rare.

## 8. API (Worker)

| Route | Purpose |
|---|---|
| `POST /api/sync` | Push outbox, pull changes since timestamp |
| `GET /api/export` | Full JSON export |
| `POST /api/import` | Restore from export |
| `POST /api/ai/*` | Phase 3 only |

## 9. Build phases and acceptance criteria

### Phase 1 · Logger + engine core (MVP)

- Exercise library seeded and tagged (patterns, muscles, increments, limitation tags).
- `config/program.json` encoding `PROGRAM.md` (sessions A, B, C, Cardio, phases, starred exercises, alternatives).
- Week card (floor and target state), next session in line, 30 min version.
- Today screen with prefilled sets, one tap confirm, steppers, RIR chips, rest timer, finish summary.
- Engine: e1RM, fractional sets, double progression, return phase, steady state, planned deload, decision log.
- Offline storage with sync to D1. Export and import.
- PWA installable on iPhone home screen.

**Done when:**
1. From a cold open, the first set of the next session can be logged in ≤5 seconds and ≤2 taps.
2. The week card shows the correct floor and target state after any combination of full, short and cardio sessions.
3. A full session logged in airplane mode survives app close and syncs later with no data loss.
4. Every target on screen has an explanation from the decision log.
5. Engine unit tests cover every row in tables 6.2, 6.3 and 6.4, including the bench press examples.
6. Changing a threshold in `engine.json` changes behavior without code changes.

### Phase 2 · Adaptive week

- Check-in with readiness adjustment and banner.
- Never miss twice nudge, zero week comeback session, break handling, travel version.
- Spacing warnings.
- Cardio logging, 4x4 timer, WHO minutes total.
- Reactive deload and stall detection.
- Plan tab and Progress tab with Sunday review, weeks without a zero, repair, cumulative totals, calendar booking deep links.

**Done when:** a simulated 12 week history (fixture) with a zero week, several floor-only weeks, one bad sleep week and one stall produces the expected week states, phase extension, comeback session, deload timing and flags, verified by tests.

### Phase 3 · AI layer (optional)

- Weekly review narrative written from the week's numbers and decision log.
- Substitution suggestions in plain language, validated against pattern and limitations.
- Free text or voice logging ("bench 80 for 8, 8, 7") parsed to sets with confirmation.
- Mesocycle proposal as JSON, accepted only if the engine's validator passes (volume bands, max jumps, deload placement, interference rules).
- "Why?" answers grounded in the decision log.

Rule: the LLM never writes a target directly. It proposes; the engine validates and decides.

### Phase 4 · Native and wearables (only if justified by data)

- SwiftUI companion for HealthKit (sleep, resting HR, SDNN) and Apple Watch logging, Live Activity rest timer.
- Oura or WHOOP via their OAuth APIs. Never mix SDNN and rMSSD baselines.

## 10. Out of scope

Social features, multiple users, fixed weekday scheduling, nutrition tracking, video form analysis, HRV driven load changes in phases 1 to 3, ACWR injury prediction.

## 11. Open questions for Peter

1. Confirm `limitations`: what exactly do shoulder symmetry and knee friendly mean for you (pain, imbalance, prior injury)? This drives exercise selection.
2. Remembered working weights for main lifts, to seed calibration.
3. Which wearable, if any? Decides phase 4 relevance.
4. Preferred interval modality: bike, rower or both?
5. What usually kills your weeks (travel, work peaks, evenings, energy)? Decides which fallback the app pushes hardest.

## 12. Evidence notes (short)

Volume ~10 sets per muscle weekly and 2×/week frequency: ACSM 2026 position stand. Fractional set counting and diminishing returns: Pelland et al. (preprint). Per session cap ~11 sets: Remmert et al. (preprint). Closer to failure helps muscle more than strength: Robinson et al. 2024. Fast regain after a break: Halonen et al. 2024. Deload means cutting volume: Bell et al. 2023 Delphi. Concurrent training costs little strength or muscle when sessions are separated, cycling interferes less than running: Schumann et al. 2022, Wilson et al. 2012. 4x4 intervals: Helgerud et al. 2007. Subjective check-in beats objective markers: Saw et al. 2016. Flexible scheduling beats rigid: Beshears et al. LLM generated programs rated moderate and inconsistent: Biology of Sport study. Starting percentages, jump sizes and deload thresholds are coaching convention and flagged in config. Full sources in the research report "Personal training app spec".
