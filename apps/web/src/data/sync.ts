/**
 * Outbox sync with POST /api/sync. Dexie is the source of truth on the device; the network is optional.
 * Push: latest row per (table, id) from the outbox. Pull: last-write-wins on updated_at.
 * Never throws into the UI: every outcome lands in the status store.
 */
import { useSyncExternalStore } from "react";
import type { Table } from "dexie";
import { ulid } from "ulid";
import { SYNC_TABLES, SyncResponse, TableSchemas, type Changes, type RowOf, type SyncRequest, type SyncTable } from "@gym/schema";
import { db as defaultDb, getMeta, setMeta, type WorkoutDb } from "./db";
import { ApiError, apiJson } from "./api";
import { nowIso } from "./clock";

export type SyncState = "idle" | "syncing" | "offline" | "auth_required" | "error";

export interface SyncStatus {
  state: SyncState;
  lastSyncAt: string | null;
  /** Rows waiting to be pushed. */
  pending: number;
  lastError: string | null;
}

export interface SyncClientOptions {
  database?: WorkoutDb;
  fetch?: typeof fetch;
  endpoint?: string;
  /** Delay after a write before syncing. */
  debounceMs?: number;
  /** Periodic sync while the page is visible. */
  intervalMs?: number;
  /** Max distinct rows per push request. */
  pushBatchSize?: number;
  /** Optional pull page size sent to the server. */
  pullLimit?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  /** Safety stop for push/pull loops in one sync. */
  maxRounds?: number;
}

type AnyRow = RowOf<SyncTable>;
type AnyTable = Table<AnyRow, string>;

interface Batch {
  changes: Changes;
  /** Outbox seqs covered by this push; deleted only after the server accepted the request. */
  seqs: number[];
  /** Distinct rows left in the outbox beyond this batch. */
  hasMore: boolean;
  invalid: number;
}

const DEFAULTS = {
  endpoint: "/api/sync",
  debounceMs: 2_000,
  intervalMs: 60_000,
  pushBatchSize: 500,
  backoffBaseMs: 5_000,
  backoffMaxMs: 5 * 60_000,
  maxRounds: 50,
};

const LOCK_NAME = "workout-os-sync";
const keyOf = (table: string, id: string) => `${table}\u0000${id}`;
const isVisible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

export class SyncClient {
  private opts: SyncClientOptions & typeof DEFAULTS;
  private status: SyncStatus = { state: "idle", lastSyncAt: null, pending: 0, lastError: null };
  private listeners = new Set<() => void>();
  private inflight: Promise<SyncStatus> | null = null;
  private rerun = false;
  private started = false;
  private failures = 0;
  private nextAllowedAt = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private teardown: (() => void)[] = [];
  private clientIdPromise: Promise<string> | null = null;

  constructor(options: SyncClientOptions = {}) {
    this.opts = { ...DEFAULTS, ...options };
  }

  private get db(): WorkoutDb {
    return this.opts.database ?? defaultDb;
  }

  /** Change options later (tests, or pointing at another fetch). */
  configure(options: SyncClientOptions): void {
    this.opts = { ...this.opts, ...options };
    if (options.database) this.clientIdPromise = null;
  }

  // ---------- status store ----------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getStatus = (): SyncStatus => this.status;

  private setStatus(patch: Partial<SyncStatus>): void {
    const next = { ...this.status, ...patch };
    const same = (Object.keys(next) as (keyof SyncStatus)[]).every((k) => next[k] === this.status[k]);
    if (same) return;
    this.status = next;
    for (const l of this.listeners) l();
  }

  // ---------- lifecycle and triggers ----------

  /** Attach triggers (online, visibility, interval) and sync once. Returns stop(). Idempotent. */
  start(): () => void {
    if (this.started) return () => this.stop();
    this.started = true;

    void this.loadInitialStatus();
    void this.sync();

    if (typeof window !== "undefined") {
      const onOnline = () => void this.sync();
      const onOffline = () => {
        if (this.status.state !== "syncing") this.setStatus({ state: "offline" });
      };
      window.addEventListener("online", onOnline);
      window.addEventListener("offline", onOffline);
      this.teardown.push(() => {
        window.removeEventListener("online", onOnline);
        window.removeEventListener("offline", onOffline);
      });
    }
    if (typeof document !== "undefined") {
      const onVisibility = () => {
        // Hidden: flush with keepalive so a closing app still gets its rows out.
        if (document.visibilityState === "hidden") void this.sync({ keepalive: true });
        else void this.sync();
      };
      document.addEventListener("visibilitychange", onVisibility);
      this.teardown.push(() => document.removeEventListener("visibilitychange", onVisibility));
    }
    const interval = setInterval(() => {
      if (isVisible()) void this.autoSync();
    }, this.opts.intervalMs);
    this.teardown.push(() => clearInterval(interval));

    return () => this.stop();
  }

  stop(): void {
    this.started = false;
    for (const fn of this.teardown.splice(0)) fn();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.debounceTimer = this.retryTimer = null;
  }

  /** Called by repo after every local write: refresh the pending count and sync after a short pause. */
  notifyWrite(): void {
    void this.refreshPending();
    if (!this.started) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.autoSync();
    }, this.opts.debounceMs);
  }

  /** Sync now if started (e.g. after finishing a session). */
  requestSync(): void {
    if (this.started) void this.sync();
  }

  /** Automatic triggers respect the error backoff; explicit sync() does not. */
  private autoSync(opts: { keepalive?: boolean } = {}): Promise<SyncStatus> {
    if (Date.now() < this.nextAllowedAt) return Promise.resolve(this.status);
    return this.sync(opts);
  }

  /** Push and pull until both are done. Single flight: concurrent calls share the run. Never rejects. */
  sync(opts: { keepalive?: boolean } = {}): Promise<SyncStatus> {
    if (this.inflight) {
      this.rerun = true;
      return this.inflight;
    }
    this.inflight = this.runWithLock(opts).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async runWithLock(opts: { keepalive?: boolean }): Promise<SyncStatus> {
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (locks?.request) {
      try {
        // Another tab already syncing: skip, it will push the shared outbox.
        return await locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => (lock ? this.run(opts) : this.status));
      } catch {
        /* fall through without the lock */
      }
    }
    return this.run(opts);
  }

  private async run(opts: { keepalive?: boolean }): Promise<SyncStatus> {
    let rounds = 0;
    do {
      this.rerun = false;
      await this.runOnce(opts);
      rounds++;
    } while (this.rerun && this.status.state === "idle" && rounds < 3);
    return this.status;
  }

  // ---------- one sync ----------

  private async runOnce(opts: { keepalive?: boolean }): Promise<void> {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      this.setStatus({ state: "offline", lastError: "Offline", pending: await this.countPendingSafe() });
      return;
    }
    this.setStatus({ state: "syncing" });
    try {
      const clientId = await this.getClientId();
      let rejected = 0;
      let invalid = 0;
      let more = true;
      for (let round = 0; more && round < this.opts.maxRounds; round++) {
        const batch = await this.collectBatch();
        invalid += batch.invalid;
        const cursor = (await getMeta<number>("cursor", this.db)) ?? 0;
        const body: SyncRequest = { client_id: clientId, cursor, changes: batch.changes };
        if (this.opts.pullLimit) body.limit = this.opts.pullLimit;

        const json = await apiJson(
          this.opts.endpoint,
          { method: "POST", body },
          { fetch: this.opts.fetch, database: this.db, keepalive: opts.keepalive },
        );
        const parsed = SyncResponse.safeParse(json);
        if (!parsed.success) throw new ApiError("error", "Unexpected sync response");
        const res = parsed.data;
        if (res.rejected.length) {
          rejected += res.rejected.length;
          console.warn("[sync] server refused rows", res.rejected.map((r) => `${r.table}/${r.id}: ${r.reason}`));
        }
        await this.applyResponse(res, batch);
        more = res.more || batch.hasMore;
      }

      this.failures = 0;
      this.nextAllowedAt = 0;
      const lastSyncAt = nowIso();
      await setMeta("last_sync_at", lastSyncAt, this.db);
      const refused = rejected + invalid;
      this.setStatus({
        state: "idle",
        lastSyncAt,
        pending: await this.countPending(),
        lastError: refused ? `${refused} change${refused === 1 ? "" : "s"} could not be saved on the server` : null,
      });
    } catch (err) {
      const kind = err instanceof ApiError ? err.kind : "error";
      const message = err instanceof Error ? err.message : String(err);
      if (kind === "error") this.backoff();
      this.setStatus({ state: kind, lastError: message, pending: await this.countPendingSafe() });
    }
  }

  private backoff(): void {
    this.failures++;
    const delay = Math.min(this.opts.backoffMaxMs, this.opts.backoffBaseMs * 2 ** (this.failures - 1));
    this.nextAllowedAt = Date.now() + delay;
    if (!this.started) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.autoSync();
    }, delay);
  }

  /** Reads the outbox and the current rows (soft-deleted included) in one consistent read. */
  private async collectBatch(): Promise<Batch> {
    const d = this.db;
    const tables = SYNC_TABLES.map((t) => d.table(t));
    return d.transaction("r", [d.outbox, ...tables], async () => {
      const entries = await d.outbox.orderBy("seq").toArray();
      const chosen = new Map<string, { table: SyncTable; id: string }>();
      const seqs: number[] = [];
      let hasMore = false;
      for (const e of entries) {
        const key = keyOf(e.table, e.row_id);
        if (!chosen.has(key)) {
          if (chosen.size >= this.opts.pushBatchSize) {
            hasMore = true;
            continue;
          }
          chosen.set(key, { table: e.table, id: e.row_id });
        }
        seqs.push(e.seq!);
      }

      const byTable = new Map<SyncTable, string[]>();
      for (const { table, id } of chosen.values()) {
        const ids = byTable.get(table) ?? [];
        ids.push(id);
        byTable.set(table, ids);
      }

      const changes: Record<string, AnyRow[]> = {};
      let invalid = 0;
      for (const [table, ids] of byTable) {
        const rows = await (d.table(table) as AnyTable).bulkGet(ids);
        const valid: AnyRow[] = [];
        rows.forEach((row, i) => {
          if (!row) return; // row vanished locally; nothing to push
          const parsed = TableSchemas[table].safeParse(row);
          if (parsed.success) valid.push(parsed.data as AnyRow);
          else {
            invalid++;
            console.warn(`[sync] skipping invalid ${table}/${ids[i]}`);
          }
        });
        if (valid.length) changes[table] = valid;
      }
      return { changes: changes as Changes, seqs, hasMore, invalid };
    });
  }

  /** Applies pulled rows (LWW, no outbox), drops the pushed outbox entries and stores the cursor, atomically. */
  private async applyResponse(res: SyncResponse, batch: Batch): Promise<void> {
    const d = this.db;
    const tables = SYNC_TABLES.map((t) => d.table(t));
    await d.transaction("rw", [d.outbox, d.meta, ...tables], async () => {
      for (const table of SYNC_TABLES) {
        const incoming = res.changes[table] as AnyRow[] | undefined;
        if (incoming?.length) await applyLww(d.table(table) as AnyTable, incoming);
      }
      // Only the entries this push covered. Writes queued during the request have other seqs and stay.
      if (batch.seqs.length) await d.outbox.bulkDelete(batch.seqs);
      await d.meta.put({ key: "cursor", value: res.cursor });
    });
  }

  // ---------- helpers ----------

  async getClientId(): Promise<string> {
    if (!this.clientIdPromise) {
      const d = this.db;
      this.clientIdPromise = d
        .transaction("rw", d.meta, async () => {
          const existing = await getMeta<string>("client_id", d);
          if (existing) return existing;
          const id = ulid();
          await setMeta("client_id", id, d);
          return id;
        })
        .catch((err) => {
          this.clientIdPromise = null;
          throw err;
        });
    }
    return this.clientIdPromise;
  }

  /** Store (or clear with null/"") the fallback sync key. Kept in meta only: never synced or logged. */
  async setSyncKey(key: string | null): Promise<void> {
    const trimmed = key?.trim() ?? "";
    if (trimmed) await setMeta("sync_key", trimmed, this.db);
    else await this.db.meta.delete("sync_key");
    this.nextAllowedAt = 0;
    if (this.started) void this.sync();
  }

  async hasSyncKey(): Promise<boolean> {
    return !!(await getMeta<string>("sync_key", this.db));
  }

  async countPending(): Promise<number> {
    const entries = await this.db.outbox.toArray();
    return new Set(entries.map((e) => keyOf(e.table, e.row_id))).size;
  }

  private async countPendingSafe(): Promise<number> {
    try {
      return await this.countPending();
    } catch {
      return this.status.pending;
    }
  }

  async refreshPending(): Promise<void> {
    this.setStatus({ pending: await this.countPendingSafe() });
  }

  private async loadInitialStatus(): Promise<void> {
    try {
      const lastSyncAt = (await getMeta<string>("last_sync_at", this.db)) ?? null;
      if (lastSyncAt && !this.status.lastSyncAt) this.setStatus({ lastSyncAt });
      await this.refreshPending();
    } catch {
      /* status stays as is */
    }
  }
}

/** Last write wins: write an incoming row only when local is missing or strictly older. Never queues outbox. */
export async function applyLww(table: AnyTable, incoming: AnyRow[]): Promise<number> {
  // Newest per id in case a page repeats a row.
  const newest = new Map<string, AnyRow>();
  for (const row of incoming) {
    const prev = newest.get(row.id);
    if (!prev || Date.parse(row.updated_at) > Date.parse(prev.updated_at)) newest.set(row.id, row);
  }
  const rows = [...newest.values()];
  const local = await table.bulkGet(rows.map((r) => r.id));
  const toPut = rows.filter((row, i) => {
    const cur = local[i];
    return !cur || Date.parse(row.updated_at) > Date.parse(cur.updated_at);
  });
  if (toPut.length) await table.bulkPut(toPut);
  return toPut.length;
}

/** The app's sync client. Call syncClient.start() once at boot. */
export const syncClient = new SyncClient();

/** Live sync status for the UI. */
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(syncClient.subscribe, syncClient.getStatus, syncClient.getStatus);
}

export const startSync = (): (() => void) => syncClient.start();
export const syncNow = (): Promise<SyncStatus> => syncClient.sync();
export const setSyncKey = (key: string | null): Promise<void> => syncClient.setSyncKey(key);
export const getClientId = (): Promise<string> => syncClient.getClientId();
