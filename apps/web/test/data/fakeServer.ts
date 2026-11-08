/**
 * In-memory stand-in for POST /api/sync with the documented semantics:
 * LWW on updated_at (strictly newer wins, ties keep the server row), a rev per accepted row,
 * pull of rows with rev > cursor in rev order, at most `limit` per response.
 * Like the Worker, a cursor ahead of the rev or a different epoch is a reset: pull from 0 and answer reset: true.
 */
import { SYNC_TABLES, SyncRequest, type SyncResponse, type SyncTable } from "@gym/schema";

type Row = { id: string; updated_at: string } & Record<string, unknown>;
export type ServerMode = "ok" | "offline" | "401" | "redirect" | "500";

export class FakeServer {
  rev = 0;
  rows = new Map<string, { table: SyncTable; row: Row; rev: number }>();
  /** Every row received in a push, in order. */
  pushes: { table: SyncTable; id: string; updated_at: string }[] = [];
  /** body is parsed with SyncRequest (unknown fields stripped); raw is the JSON as sent. */
  requests: { body: SyncRequest; raw: { changes?: Record<string, Record<string, unknown>[]> }; headers: Record<string, string> }[] = [];
  limit = 1000;
  mode: ServerMode = "ok";
  /** Runs while the request is "in flight", before the server answers. */
  onRequest: ((body: SyncRequest) => Promise<void> | void) | null = null;
  /** The database epoch (null = a server without one). */
  epoch: number | null;
  /** Row ids the server refuses (listed in rejected, not stored). */
  refuse = new Set<string>();
  /** Raw rows added to the next responses as is (rows this client cannot parse, fields it does not know). */
  extraChanges: Record<string, unknown[]> = {};

  constructor(epoch: number | null = 1) {
    this.epoch = epoch;
  }

  /** Insert a row as if another device had synced it. */
  seed(table: SyncTable, row: Row): void {
    this.rows.set(`${table}/${row.id}`, { table, row: structuredClone(row), rev: ++this.rev });
  }

  get(table: SyncTable, id: string): Row | undefined {
    return this.rows.get(`${table}/${id}`)?.row;
  }

  pushCount(table: SyncTable, id: string): number {
    return this.pushes.filter((p) => p.table === table && p.id === id).length;
  }

  fetch = async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (this.mode === "offline") throw new TypeError("Failed to fetch");
    if (this.mode === "401") return new Response("", { status: 401 });
    if (this.mode === "redirect") return { type: "opaqueredirect", status: 0, ok: false } as Response;
    if (this.mode === "500") return new Response("boom", { status: 500 });

    const raw = JSON.parse(String(init?.body));
    const body = SyncRequest.parse(raw);
    this.requests.push({ body, raw, headers: { ...(init?.headers as Record<string, string>) } });
    await this.onRequest?.(body);

    const reset = body.cursor > this.rev || (body.epoch !== undefined && this.epoch !== null && body.epoch !== this.epoch);
    const from = reset ? 0 : body.cursor;

    let accepted = 0;
    const rejected: SyncResponse["rejected"] = [];
    for (const table of SYNC_TABLES) {
      for (const row of (body.changes[table] ?? []) as Row[]) {
        this.pushes.push({ table, id: row.id, updated_at: row.updated_at });
        if (this.refuse.has(row.id)) {
          rejected.push({ table, id: row.id, reason: "refused by test" });
          continue;
        }
        const cur = this.rows.get(`${table}/${row.id}`);
        if (cur && Date.parse(row.updated_at) <= Date.parse(cur.row.updated_at)) continue;
        this.rows.set(`${table}/${row.id}`, { table, row: structuredClone(row), rev: ++this.rev });
        accepted++;
      }
    }

    const newer = [...this.rows.values()].filter((r) => r.rev > from).sort((a, b) => a.rev - b.rev);
    const limit = Math.min(this.limit, body.limit ?? Infinity);
    const page = newer.slice(0, limit);
    const changes: Record<string, unknown[]> = {};
    for (const r of page) (changes[r.table] ??= []).push(structuredClone(r.row));
    for (const [table, rows] of Object.entries(this.extraChanges)) (changes[table] ??= []).push(...structuredClone(rows));
    this.extraChanges = {};
    const res = {
      cursor: page.length ? page[page.length - 1]!.rev : from,
      more: newer.length > page.length,
      accepted,
      rejected,
      changes,
      server_time: new Date().toISOString(),
      reset,
      ...(this.epoch !== null && { epoch: this.epoch }),
    };
    return new Response(JSON.stringify(res), { status: 200, headers: { "content-type": "application/json" } });
  };
}
