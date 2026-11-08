/**
 * In-memory stand-in for POST /api/sync with the documented semantics:
 * LWW on updated_at (strictly newer wins, ties keep the server row), a rev per accepted row,
 * pull of rows with rev > cursor in rev order, at most `limit` per response.
 */
import { SYNC_TABLES, SyncRequest, type SyncResponse, type SyncTable } from "@gym/schema";

type Row = { id: string; updated_at: string } & Record<string, unknown>;
export type ServerMode = "ok" | "offline" | "401" | "redirect" | "500";

export class FakeServer {
  rev = 0;
  rows = new Map<string, { table: SyncTable; row: Row; rev: number }>();
  /** Every row received in a push, in order. */
  pushes: { table: SyncTable; id: string; updated_at: string }[] = [];
  requests: { body: SyncRequest; headers: Record<string, string> }[] = [];
  limit = 1000;
  mode: ServerMode = "ok";
  /** Runs while the request is "in flight", before the server answers. */
  onRequest: ((body: SyncRequest) => Promise<void> | void) | null = null;

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

    const body = SyncRequest.parse(JSON.parse(String(init?.body)));
    this.requests.push({ body, headers: { ...(init?.headers as Record<string, string>) } });
    await this.onRequest?.(body);

    let accepted = 0;
    for (const table of SYNC_TABLES) {
      for (const row of (body.changes[table] ?? []) as Row[]) {
        this.pushes.push({ table, id: row.id, updated_at: row.updated_at });
        const cur = this.rows.get(`${table}/${row.id}`);
        if (cur && Date.parse(row.updated_at) <= Date.parse(cur.row.updated_at)) continue;
        this.rows.set(`${table}/${row.id}`, { table, row: structuredClone(row), rev: ++this.rev });
        accepted++;
      }
    }

    const newer = [...this.rows.values()].filter((r) => r.rev > body.cursor).sort((a, b) => a.rev - b.rev);
    const limit = Math.min(this.limit, body.limit ?? Infinity);
    const page = newer.slice(0, limit);
    const changes: Record<string, Row[]> = {};
    for (const r of page) (changes[r.table] ??= []).push(structuredClone(r.row));
    const res: SyncResponse = {
      cursor: page.length ? page[page.length - 1]!.rev : body.cursor,
      more: newer.length > page.length,
      accepted,
      rejected: [],
      changes: changes as SyncResponse["changes"],
      server_time: new Date().toISOString(),
    };
    return new Response(JSON.stringify(res), { status: 200, headers: { "content-type": "application/json" } });
  };
}
