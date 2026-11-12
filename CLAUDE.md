# gym.peterslab.app · Workout OS

Personal, single user training app for Peter on iPhone (home screen PWA). The goal is not the app: it is Peter getting lean and strong ("ripped"). Three levers, all on Today: train (the 12 week program, never a zero week), fuel (calories and protein from the engine, corrected by the real weight trend), move (daily steps).

Read first: `docs/SPEC.md` (what; its section 5 design and its screen list are superseded by D27 to D29), `docs/PROGRAM.md` (training content), `docs/ENGINE_RULES.md` (exact engine semantics, wins over the spec), `docs/DECISIONS.md` (deviations).

## Layout

| Path | What |
|---|---|
| `packages/schema` | Zod schemas + types for every synced row, both configs and the sync protocol. Single source of truth for shapes. |
| `packages/engine` | Pure TypeScript engine. No I/O, no clock (`ctx.now`), no randomness. Public contract: `src/index.ts` + `src/types.ts`. |
| `config/engine.json` | Every engine threshold. Never hard code a number that lives here. |
| `config/program.json` | Peter's program (sessions A, B, C, travel, phases, cardio, limitations). |
| `data/exercises.json` | Exercise library seeded from free-exercise-db (Unlicense) + our tags. Built by `scripts/build-exercises.mjs`. |
| `data/exercise-guides.json` | One how-to guide per exercise (plain text + a checked YouTube video). Photos: `apps/web/public/ex/<id>-0.webp` (start) and `-1.webp` (end), fetched by `scripts/fetch-exercise-images.mjs`. |
| `apps/web` | Vite + React + Tailwind v4 PWA. `src/data` = Dexie + outbox sync + engine hooks (`useEngine`, `usePlan`, `useBody`). `src/components` = UI kit (Sheet, GuideSheet, SetRow, ...). `src/screens` = Home (Today), Workout + `workout/` (full screen player), Cardio, Program, Progress, Settings (the You tab), Summary. `src/lib/plain.ts` + `effort.ts` = plain wording. |
| `apps/api` | Hono Worker under `/api` + D1 migrations (`apps/api/migrations`). |
| `wrangler.jsonc` | One Worker `gym`: static assets from `apps/web/dist` + `/api/*` to the Worker. Custom domain gym.peterslab.app. |

## Commands

- `npm install` (workspaces). Do not add dependencies casually; the lockfile is shared.
- `npm test` all tests · `npm run typecheck` all packages
- `npm run dev` web dev server on :5173 (proxies `/api` to :8787) · `npx wrangler dev` API + built assets on :8787
- `npm run build` builds the PWA · `npm run deploy` builds and deploys the Worker
- `npm run db:migrate:local` / `db:migrate:remote` apply D1 migrations

## Rules

1. Logging never waits for the network. Every write goes to Dexie first, through `apps/web/src/data/repo.ts`, which also queues the outbox.
2. The engine owns every number. UI never computes targets; it renders `EngineState` / `SessionPlan` and shows each target's `reason`.
3. Every target on screen has an explanation from a `Decision`.
4. Copy: short, plain, no guilt. No red, no "failed". Missed sessions are never shown as failure. Avoid dashes as punctuation; use "·" or a full stop. No gym shorthand on screen: never RIR, floor, e1RM, deload. Say "leave 3 in the tank", "minimum", "estimated max", "easy week". Engine text goes through `plain()` before it is shown. Every exercise name on screen opens its guide (`useGuide()`).
5. Design ("night + volt"): night `#0a0a0c` background, cards `#15151a`, white text, one volt accent `#c9f73a` for primary actions and done. Data colors: fuel coral (protein, calories), move blue (steps, cardio), body violet (weight). Warn amber, never red. Barlow Condensed (uppercase) for headings and big numbers, the system font for everything else. 20 px rounded cards, bottom sheets instead of new pages. Tokens in `apps/web/src/styles.css`.
6. iPhone first: primary actions in the bottom third, ≥ 44 pt tap targets, safe area insets, logging a set is one tap and never opens a modal, no keyboard unless a field is tapped.
7. Rows: ULID ids (except deterministic singleton ids), `updated_at` ISO UTC, soft delete via `deleted_at`. Last write wins on `updated_at`.
8. `/api` fails closed: Access JWT or sync key required, except `GET/HEAD` on `/api/health`, `/api/auth/login` and `/api/ics` (echoes its query into a calendar file, no stored data; still rate limited). Secrets only in Worker secrets, never in this public repo.
