# src/data · offline-first data layer

Dexie (IndexedDB) is the source of truth on the phone. Every write goes to Dexie first, through `repo.ts`, and is queued in an outbox. Sync with `POST /api/sync` happens in the background. **Logging never waits for the network.**

Import everything from `../data` (the barrel `index.ts`).

| File | What |
|---|---|
| `db.ts` | Dexie database `workout-os` (version 2): one table per synced row type + `outbox` + `meta` |
| `repo.ts` | The only write path. One transaction per mutation, `updated_at` strictly increasing per row, outbox queued |
| `context.ts` | Builds `EngineContext` from Dexie (`loadContext`, `buildContext`) |
| `hooks.ts` | `useEngine`, `usePlan`, `useSessionSummary`, `useCardioPlan`, `useBody`, plus live reads |
| `sync.ts` | `syncClient` singleton, `useSyncStatus` |
| `backup.ts` | Export / import, local file and server |
| `storage.ts` | `navigator.storage.persist()` and usage estimate |
| `boot.ts` | `bootData()`: one call at app start |
| `clock.ts` | `nowIso()` (injectable in tests with `setClock`) |

## Boot

```tsx
// main.tsx or App.tsx, once
useEffect(() => bootData(), []); // persistent storage + settings row + background sync; returns stop()
```

## Cold open → next session

```tsx
const { ready, state, error } = useEngine();
if (!ready) return null;              // first paint is a few ms: Dexie only, no network
if (error || !state) return <Calm text="Could not plan today. Your log is safe." />;
const next = state.next;              // NextSession
next.plan.exercises[0];               // PlannedExercise with sets, reason, decision_id
state.current_week;                   // WeekState for the week card
state.active;                         // { session, plan } when a session is in progress
```

`useEngine` recomputes on every write (local or synced), every 30 s and when the app becomes visible. Engine errors come back as `error`; nothing throws into render. Several components can call it: identical data shares one `computeState`.

## Log the first set (≤ 2 taps)

```ts
// Tap 1: start (or resume state.active.session)
const session = await startSession({ code: next.code, mode: "full" }); // mode: full | short | travel | comeback
// Tap 2: confirm the prefilled set
const ex = next.plan.exercises[0];
const target = ex.sets[0];
await logSet({
  sessionId: session.id,
  prescriptionId: ex.prescription_id,
  exerciseId: ex.exercise_id,
  setIndex: target.index,
  target: { weight: target.weight, reps: target.reps, rir: target.rir },
  weight: target.weight ?? 0, reps: target.reps, rir: target.rir,
  isTopSet: target.kind === "top",
});
```

- While logging, plan with the session id so targets stay frozen: `usePlan({ code, mode, swaps: session.swaps, sessionId: session.id })`.
- Logged sets live: `useSessionLogs(session.id)` → `{ session, sets, cardio }`.
- Logging the same slot (session, prescription, exercise, set index) again updates that set, so a double tap never duplicates.
- Edit / remove: `updateSet(id, { weight, reps, rir, painFlag, isTopSet })`, `deleteSet(id)` (soft delete).
- Pain: `setPain(sessionId, exerciseId, true)` flags every logged set of that exercise in the session.
- Swap for this session: `swapExercise(sessionId, prescriptionId, exerciseId)` (null removes it). Swap for the block: `updateSettings({ block_swaps: { ...settings.block_swaps, B3: "lat_pulldown" } })`.

## Finish a session

```ts
const { error } = await finishSession(session.id); // sets ended_at, stores the engine's decisions, syncs
navigate(`/summary/${session.id}`);
// Summary screen
const { ready, summary, error } = useSessionSummary(id); // SessionSummary: changes, prs, week
```

`finishSession` never fails because of the engine: the session is finished first, `error` tells you if decisions could not be stored. `discardSession(id)` soft deletes the session with its sets, cardio logs and decisions. Sessions left open are auto finished by the engine; `useEngine` stores their `ended_at` once.

## Check-in

```ts
await saveCheckin({ date: state.today, sleep: 4, soreness: 3, stress: 4, energy: 5 }); // 1..5, higher is better
const checkin = useCheckin(state.today); // live, null when none
```

One row per local date (`ck_YYYY-MM-DD`), saving again overwrites it. `state.readiness` reflects it on the next render.

## Body and fuel

```tsx
const body = useBody();                            // BodyState | null (null while loading)
if (!body) return null;
body.targets;                                      // kcal, protein_g, fat_min_g, steps + reason (show it under the numbers)
body.missing;                                      // ["sex", "birth_year", "height_cm", "weight"] still needed for kcal
body.pace; body.pace_text;                         // setup | collecting | on_pace | slow | fast | off_goal
body.series;                                       // one { date, weight, avg } per day for the chart
body.log_today; body.protein_today; body.protein_hit; body.steps_hit;

await saveBodyLog(body.today, { weight_kg: 84.6 });           // upsert for that local date, merges
await saveBodyLog(body.today, { waist_cm: 91, note: null });  // null clears a field, left out fields stay
await addToBodyLog(body.today, "protein_g", 30);              // adds to the day's total (protein_g | kcal | steps)
await addToBodyLog(body.today, "protein_g", -30);             // undo: never below 0, never above the schema max
const logs = useBodyLogs();                                   // BodyLog[], oldest first, [] while loading

await updateSettings({ sex: "male", birth_year: 1986, height_cm: 180, job_activity: "desk" });
await updateSettings({ goal: "cut", cut_rate_pct: 0.5, goal_weight_kg: 80, steps_target: 8000 });
await updateSettings({ kcal_override: 2100 });                // own number wins; null gives the engine's back
```

- One row per local date (`bd_YYYY-MM-DD`). Pass `body.today` (the engine's local date), not a date from `new Date()`.
- `saveBodyLog` validates against the schema and throws on a value outside its range (`BODY_LIMITS` in `@gym/schema` has the ranges for input fields); nothing is written then. `addToBodyLog` clamps instead, so a quick add button cannot fail.
- `useBody` recomputes when a body log or the settings change (local or synced) and when the local day rolls over (the shared 30 s / app visible clock). Within a day the same object is returned while nothing changes, and every component shares it.
- Every number comes from the engine (`computeBody`, ENGINE_RULES section 10). The UI renders `targets` and shows `targets.reason`; the decisions behind them are in `body.decisions` and are not stored.
- `cut_rate_pct` is percent of body weight per week: 0.5 means 0.5%. Allowed 0.25 to 1.

## Cardio and walks

```ts
const { plan } = useCardioPlan();                 // CardioPlan (segments, counts_as, warnings)
const s = await startCardioSession();
await logCardio({ sessionId: s.id, modality: "bike", minutes: plan.total_min,
  hardMinutes: plan.hard_minutes, intensity: plan.kind === "intervals" ? "hard" : "easy", avgHr: null, source: "timer" });
await finishSession(s.id);
await logWalk(state.today, 30);                   // walking minutes only, never a session
```

`logCardio` defaults `date` to today in `settings.timezone`.

## Weeks, settings, exercises

```ts
await repairWeek(week.id);                          // only when week.can_repair; repairWeek(id, false) undoes
await updateSettings({ interval_modality: "rower" });
const settings = useSettings();                     // live row
await saveCustomExercise({ name: "Sled push", pattern: "carry", primary_muscles: ["quads"],
  secondary_muscles: [], equipment: "other", fatigue_rating: 2, increment_kg: 5, step_kg: 5,
  default_rest_s: 120, tags: [] });
```

## Sync status

```tsx
const { state, pending, lastSyncAt, lastError } = useSyncStatus();
// state: idle | syncing | offline | auth_required | error
await syncNow();                 // "Sync now" button; never throws
await setSyncKey(pastedKey);     // Settings: stored on this device only, sent as Authorization: Bearer
```

- `auth_required`: no or wrong sync key (401/403), or an expired Cloudflare Access session (redirect). Show "Add your sync key in Settings" (`lastError` has the text).
- `offline`: rows wait in the outbox; nothing is lost. Show it quietly, never as a failure.
- Triggers: start, back online, app visible / hidden (flush with keepalive), 2 s after writes, every 60 s while visible, after `finishSession`. `error` (5xx) retries with backoff.
- Rows the server refuses (or this bundle cannot validate) stay in the outbox and are retried once per sync; `lastError` says "N changes could not be saved on the server" until they go through.
- Pulled rows keep fields this bundle does not know, and rewrites keep them, so an older bundle never pushes a row back without them. A pulled row this bundle cannot parse waits in meta `quarantine` and lands after the app updates; the rest of the page applies.
- `reset: true` from the server (database recreated, wiped or restored) queues every local row, soft-deleted ones included, and pushes them in the same sync.
- Settings: `ensureSettings()` (boot, `useEngine`) seeds the defaults locally with `updated_at` 1970 and does not queue them, so a fresh device never overwrites the real settings on the server. The first pull replaces the seed; the first `updateSettings` is stamped now and synced. An edit made before the first pull still pushes a whole row built on the defaults, so paste the sync key before changing settings on a new device.

## Export / import

```ts
await downloadExport();                         // iPhone: share sheet (Save to Files); elsewhere a download
const file = await readExportFile(input.files[0]); // validates, throws ImportError with a readable message
await importLocal(file, "merge");               // last write wins per row
await importLocal(file, "replace");             // local rows not in the file are soft deleted; file rows win
const remote = await fetchRemoteExport();       // GET /api/export (throws ApiError: auth_required | offline | error)
await pushRemoteImport(file, "merge");          // POST /api/import?mode=merge|replace, then syncs
const { usage, quota, persisted } = await storageEstimate();
```

Everything imported is queued for sync. Export, import and sync walk `SYNC_TABLES`, so `body_log` travels with the rest. A file written before a table or a settings field existed still imports: missing tables are skipped and missing settings fields take their defaults. `replace` is the clear everything path: local rows missing from the file are soft deleted, body logs included.

## Database versions

- **1**: the first release.
- **2**: adds the `body_log` store (`id, date`). Existing stores and rows carry over untouched; the settings row on the device gets the defaults of fields added since it was written (no new `updated_at`, the server fills the same defaults).

Adding a synced table: add it to `SYNC_TABLES` / `TableSchemas` in `@gym/schema`, add the store in a new `this.version(n)` in `db.ts` (never edit an old version), and add the D1 migration. Sync, export, import and reset pick it up from `SYNC_TABLES`.

## Rules for UI code

- Never write to `db` directly. Use `repo` functions only (they validate, bump `updated_at` and queue the outbox).
- Never compute targets. Render `state` / `plan` and show each target's `reason`.
- Await writes only for navigation; the UI updates from live queries anyway.
