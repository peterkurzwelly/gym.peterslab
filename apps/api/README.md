# @gym/api · Workout OS Worker

One Cloudflare Worker (`gym`, see the root `wrangler.jsonc`) serves gym.peterslab.app:

- `/api/*` runs this Hono app (`run_worker_first`).
- Everything else is the PWA from `apps/web/dist` (static assets, SPA fallback).
- D1 (`DB`) is the sync source of truth. The phone works offline from Dexie and syncs when online.

## Files

| Path | What |
|---|---|
| `src/index.ts` | Worker entry. Only a default export (workerd treats named exports as entrypoints). |
| `src/app.ts` | Hono app: middleware, routes. |
| `src/auth.ts` | Access JWT / sync token / dev flag. Fails closed. |
| `src/sync.ts` | `POST /api/sync`. |
| `src/transfer.ts` | Export and import. |
| `src/store.ts` | D1 reads/writes, rev allocation, pull pagination. |
| `src/columns.ts` | Column layout derived from the Zod schemas in `@gym/schema`. |
| `src/rows.ts` | Per-row validation, LWW planning. |
| `src/ics.ts` | Calendar file builder. |
| `migrations/0001_init.sql` | Explicit schema. `test/schema.test.ts` checks it against the Zod schemas. |

## Endpoints

Every `/api` response has `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. Errors are JSON
`{ "error": "<code>" }` and never include stack traces.

| Route | Auth | What |
|---|---|---|
| `GET /api/health` | public | `{ ok: true, version }` |
| `GET /api/auth/login` | public | `302` to `/`. Only used when Cloudflare Access is switched on: navigate here (outside the service worker) so Access can renew an expired session. |
| `GET /api/auth/check` | yes | `{ ok: true, method: "access" \| "token" \| "dev", email? }` |
| `POST /api/sync` | yes | Push outbox + pull changes. `SyncRequest` / `SyncResponse` in `packages/schema`. |
| `GET /api/export` | yes | `ExportFile` with every row of every table, soft-deleted rows included. |
| `POST /api/import?mode=merge\|replace` | yes | Restore an `ExportFile`. Default mode `merge`. |
| `GET /api/ics?start=&title=&minutes=&notes=` | public | `text/calendar` with one event and a 30 min alarm. Echoes its query, reads no stored data. |

Status codes: `400` invalid JSON or request (`invalid_json`, `invalid_request` with `issues`, `invalid_params`),
`401` `{ error: "unauthorized", reason }`, `404` `not_found`, `413` `payload_too_large`, `429` `rate_limited`,
`500` `internal_error`.

### Auth (fails closed)

Production uses the sync key (DECISIONS D14): a Worker secret `SYNC_TOKEN`, pasted once in Settings on each
device and sent as a Bearer token. Cloudflare Access verification is also implemented, but it is off: home
screen apps on iPhone can loop on the Access login when the session expires.

A request passes when one of these holds, checked in this order:

1. **Cloudflare Access** (off unless both vars are set). A valid JWT in `Cf-Access-Jwt-Assertion` (or the `CF_Authorization` cookie), RS256,
   verified against `https://<team>/cdn-cgi/access/certs`, issuer `https://<team>`, audience `ACCESS_AUD`.
   Needs both `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`. The team domain may be written as
   `peterslab.cloudflareaccess.com`, `https://peterslab.cloudflareaccess.com/` or just `peterslab`.
   `ACCESS_AUD` may hold a comma separated list.
2. **Sync token.** `Authorization: Bearer <SYNC_TOKEN>`, compared in constant time. Tokens shorter than
   16 characters are ignored (treated as not configured).
3. **Dev.** `DEV_ALLOW_ALL` is exactly `"true"`. Local `.dev.vars` only.

Otherwise `401` with `reason`:

- `auth_not_configured`: neither Access nor a sync token is configured.
- `missing_credentials`: configured, but the request carries no JWT and no `Authorization` header.
- `invalid_credentials`: something was presented and nothing verified (also when the Access certs endpoint is unreachable).

Public routes (`GET`/`HEAD` only, still rate limited): `/api/health`, `/api/auth/login` and `/api/ics`. The calendar
link opens with a plain navigation, which cannot carry the `Authorization` header, so `/api/ics` takes no auth. It
only echoes its query into a calendar file and reads no stored data: never add stored data to it.

### Sync protocol

- Every row is validated with its Zod schema. Invalid rows and unknown tables land in `rejected`
  (`{ table, id, reason }`); the rest of the push still applies.
- Last write wins on `updated_at`, compared as instants (`…00Z` equals `…00.000Z`). Strictly newer wins;
  a tie keeps the server row. Duplicate ids within one push collapse to the newest.
- Each written row gets a new global `rev`. The push is one D1 batch (all or nothing). Revs are reserved inside
  that batch, so they become visible in commit order and a cursor can never skip a row.
- Pull returns rows with `rev > cursor` from all tables in rev order, at most `limit` (default 1000, max 2000).
  `more: true` means call again with the returned `cursor`. `cursor` is the highest rev returned, or the request
  cursor when nothing came back. Soft-deleted rows sync like any row.
- `changes` in the response always lists all eight tables (empty arrays when nothing changed). Rows the client
  just pushed come back too (they have new revs); applying them is a no-op under LWW.
- Reset: the response always carries `reset` and the database `epoch` (a random number in `sync_meta`, migration
  `0003`). A cursor ahead of the server's rev, or an `epoch` in the request that differs from the database's, means
  the database was recreated, wiped or restored: the server pulls from `0` and answers `reset: true`. The client then
  queues every row it holds (soft-deleted included) and pushes them, so the server gets the device's history back.
  A client that never saw an epoch (first sync, older bundle) is judged by the cursor only.

### Export and import

- `GET /api/export` sends `Content-Disposition: attachment; filename=workout-os-export-YYYY-MM-DD.json`.
- `merge`: same LWW as a sync push. Invalid rows are reported in `rejected`, valid rows still land.
- `replace`: every live row whose id is not in the file is soft-deleted (`deleted_at = updated_at = now`), then
  every file row is written with `updated_at = now` (the same instant), even if older than the server row. All with
  new revs, in one batch. A file with any invalid row is refused (`400 invalid_rows`) and nothing changes. Rows that
  are already soft-deleted and not in the file stay as they are.
- Response: `{ ok: true, mode, counts: { <table>: { received, written, deleted } }, rejected }`.
- Import bodies may be up to 16 MB (a year of logs outgrows 2 MB). Every other route caps bodies at 2 MB.
- After a `replace`, every device takes the restored rows on its next pull: they are stamped with the import instant,
  so they are newer than any local copy made before the restore (devices only apply strictly newer rows).

### Calendar file

`GET /api/ics?start=2026-11-10T18:00:00+01:00&title=Session%20A&minutes=45&notes=Floor%20session`

- `start` (required): ISO date-time with `Z` or an offset. Remember to URL-encode `+` as `%2B`.
- `title`: 1 to 120 chars, default `Workout`. `minutes`: integer 5 to 480, default 60. `notes`: up to 1000 chars.
- Times are written in UTC. `UID` is derived from start + title, so adding the same booking twice updates the event.
- Served `inline; filename=session.ics`, so iPhone Safari offers "Add to Calendar".

## Database

`migrations/0001_init.sql`: one table per entry in `SYNC_TABLES`, columns named exactly like the Zod fields.
Arrays/objects/records are JSON `TEXT`, booleans `INTEGER` 0/1, nullable fields `NULL`, plus `rev INTEGER NOT NULL`
(unique index). `sync_meta(key, value)` holds the global rev under `key = 'rev'` and the database epoch under
`key = 'epoch'` (`0003_sync_epoch.sql`).

Wiping or restoring the database by hand: a recreated database gets a fresh epoch from its migrations. After any
`DELETE FROM` wipe or a D1 Time Travel restore, rotate the epoch so every device notices and pushes its rows again:

```bash
npx wrangler d1 execute DB --remote --command "UPDATE sync_meta SET value = abs(random() % 9007199254740991) WHERE key = 'epoch'"
```

Adding a field to a synced schema: add a new migration (`0002_….sql`) with `ALTER TABLE … ADD COLUMN`, with a
`DEFAULT` when the field is `NOT NULL`. `test/schema.test.ts` fails until the migration matches.

## Local development

```bash
# once: local auth bypass (gitignored), next to wrangler.jsonc in the repo root
echo 'DEV_ALLOW_ALL=true' > .dev.vars

npm run db:migrate:local          # wrangler d1 migrations apply DB --local
npm run dev:api                   # builds the PWA, then wrangler dev on :8787
npm run dev                       # optional: Vite on :5173, proxies /api to :8787
```

Under `wrangler dev` the request URL host is rewritten to the route (`gym.peterslab.app`); that is expected.

Tests run inside workerd with `@cloudflare/vitest-pool-workers` (bindings in `vitest.config.ts`, migrations applied
in `test/setup.ts`):

```bash
npm test -w @gym/api
npx tsc -p apps/api/tsconfig.json
```

## Production setup

1. Create the database in the EU jurisdiction and put its id in `wrangler.jsonc` (`database_id`):
   ```bash
   npx wrangler d1 create gym --jurisdiction eu
   ```
2. Apply migrations: `npm run db:migrate:remote`.
3. Sync key (the auth in use, DECISIONS D14). Generate it, store it as a Worker secret, and keep your copy out of
   the repo (`.sync-key` is gitignored). Paste it once in Settings → Sync on each device:
   ```bash
   openssl rand -base64 32 | npx wrangler secret put SYNC_TOKEN
   ```
4. Deploy: `npm run deploy`.
5. Check: `curl https://gym.peterslab.app/api/health` answers `{ "ok": true, … }`, and
   `curl -H "Authorization: Bearer <key>" https://gym.peterslab.app/api/auth/check` answers
   `{ "ok": true, "method": "token" }`. Without the header it is `401`.

Optional, not recommended for the home screen app: Cloudflare Access. Putting an Access application in front of
`gym.peterslab.app` makes the installed PWA loop on the Access login whenever the session expires, and sync stops
until it is opened in Safari. If you still want it (for example only for `/api/export`), set
`"vars": { "ACCESS_TEAM_DOMAIN": "<team>.cloudflareaccess.com", "ACCESS_AUD": "<aud tag>" }` in `wrangler.jsonc`
(not secrets), keep the sync key as well, and bypass `/api/health`, `/api/auth/login` and `/api/ics`.

Never put `DEV_ALLOW_ALL` or `SYNC_TOKEN` in `wrangler.jsonc`; the repo is public.

Rate limit: `RATE_LIMITER` (120 requests per 60 s per `CF-Connecting-IP`). A limiter outage fails open; auth does not.
