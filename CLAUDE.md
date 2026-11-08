# gym.peterslab.app · Workout OS

Personal, single user training app for Peter on iPhone (home screen PWA). Primary job: consistency, 12 weeks without a zero week.

Read first: `docs/SPEC.md` (what), `docs/PROGRAM.md` (training content), `docs/ENGINE_RULES.md` (exact engine semantics, wins over the spec), `docs/DECISIONS.md` (deviations).

## Layout

| Path | What |
|---|---|
| `packages/schema` | Zod schemas + types for every synced row, both configs and the sync protocol. Single source of truth for shapes. |
| `packages/engine` | Pure TypeScript engine. No I/O, no clock (`ctx.now`), no randomness. Public contract: `src/index.ts` + `src/types.ts`. |
| `config/engine.json` | Every engine threshold. Never hard code a number that lives here. |
| `config/program.json` | Peter's program (sessions A, B, C, travel, phases, cardio, limitations). |
| `data/exercises.json` | Exercise library seeded from free-exercise-db (Unlicense) + our tags. Built by `scripts/build-exercises.mjs`. |
| `apps/web` | Vite + React + Tailwind v4 PWA. `src/data` = Dexie + outbox sync + engine hook. `src/components` = UI kit. `src/screens` = screens. |
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
4. Copy: short, plain, no guilt. No red, no "failed". Missed sessions are never shown as failure. Avoid dashes as punctuation; use "·" or a full stop.
5. Design: ink `#04261E` background, paper `#F2EDD5` text, one orange accent `#F26716` for primary actions. Green only for floor/target reached. Instrument Serif for display, IBM Plex Mono for everything else. Tokens in `apps/web/src/styles.css`.
6. iPhone first: primary actions in the bottom third, ≥ 44 pt tap targets, safe area insets, no modals during logging, no keyboard unless a field is tapped.
7. Rows: ULID ids (except deterministic singleton ids), `updated_at` ISO UTC, soft delete via `deleted_at`. Last write wins on `updated_at`.
8. `/api` fails closed: Access JWT or sync key required, except `GET/HEAD` on `/api/health`, `/api/auth/login` and `/api/ics` (echoes its query into a calendar file, no stored data; still rate limited). Secrets only in Worker secrets, never in this public repo.
