/**
 * D1 access for synced rows.
 *
 * Revs: every write batch first bumps sync_meta.rev by the number of rows it may write, then each row
 * takes a slot of that range inside the same batch. A D1 batch is one transaction, so revs become
 * visible in commit order and a pull cursor can never skip a row that commits later with a lower rev.
 * Rows are passed as one JSON parameter per table (json_each), which keeps the statement count small.
 */
import { SYNC_TABLES, type SyncTable } from "@gym/schema";
import { TABLE_COLUMNS, deserializeRow, type DbRow } from "./columns";

export type Row = Record<string, unknown>;
export type TableRows = Record<SyncTable, Row[]>;

const REV_NOW = `(SELECT m.value FROM sync_meta AS m WHERE m.key = 'rev')`;

/** D1 caps a bound value at 2 MB; stay well below it per statement. */
const MAX_PARAM_CHARS = 400_000;

/** Splits items into JSON arrays no longer than MAX_PARAM_CHARS (a single huge item still gets its own chunk). */
export function chunkJson<T>(items: T[], maxChars = MAX_PARAM_CHARS): { json: string; count: number }[] {
  const chunks: { json: string; count: number }[] = [];
  let parts: string[] = [];
  let size = 2;
  for (const item of items) {
    const s = JSON.stringify(item);
    if (parts.length > 0 && size + s.length + 1 > maxChars) {
      chunks.push({ json: `[${parts.join(",")}]`, count: parts.length });
      parts = [];
      size = 2;
    }
    parts.push(s);
    size += s.length + 1;
  }
  if (parts.length > 0) chunks.push({ json: `[${parts.join(",")}]`, count: parts.length });
  return chunks;
}

function q(name: string): string {
  return `"${name}"`;
}

function emptyTables(): TableRows {
  return Object.fromEntries(SYNC_TABLES.map((t) => [t, [] as Row[]])) as TableRows;
}

/**
 * Upsert from a JSON array (?1). Rev = start of the reserved range (?2 = range size) + offset (?3) + index.
 * "lww" only overwrites a stored row when the incoming updated_at is strictly newer.
 */
function upsertSql(table: SyncTable, mode: "lww" | "force"): string {
  const cols = TABLE_COLUMNS[table].map((c) => c.name);
  const select = cols.map((c) => `json_extract(j.value, '$.${c}')`).join(", ");
  const set = [...cols.filter((c) => c !== "id"), "rev"].map((c) => `${q(c)} = excluded.${q(c)}`).join(", ");
  const guard = mode === "lww" ? ` WHERE julianday(excluded."updated_at") > julianday(${q(table)}."updated_at")` : "";
  return (
    `INSERT INTO ${q(table)} (${[...cols, "rev"].map(q).join(", ")}) ` +
    `SELECT ${select}, ${REV_NOW} - ?2 + ?3 + j.key + 1 FROM json_each(?1) AS j WHERE true ` +
    `ON CONFLICT("id") DO UPDATE SET ${set}${guard}`
  );
}

/** Soft delete the ids in ?2 (JSON array) at time ?1, each with its own rev slot. */
function softDeleteSql(table: SyncTable): string {
  const t = q(table);
  return (
    `UPDATE ${t} SET "deleted_at" = ?1, "updated_at" = ?1, ` +
    `"rev" = ${REV_NOW} - ?3 + ?4 + (SELECT j.key FROM json_each(?2) AS j WHERE j.value = ${t}."id") + 1 ` +
    `WHERE "id" IN (SELECT value FROM json_each(?2))`
  );
}

/** id -> stored updated_at for the given ids. */
export async function readUpdatedAt(
  db: D1Database,
  ids: Partial<Record<SyncTable, string[]>>,
): Promise<Record<SyncTable, Map<string, string>>> {
  const out = Object.fromEntries(SYNC_TABLES.map((t) => [t, new Map<string, string>()])) as Record<
    SyncTable,
    Map<string, string>
  >;
  const queries: Array<{ table: SyncTable; stmt: D1PreparedStatement }> = [];
  for (const t of SYNC_TABLES) {
    for (const chunk of chunkJson(ids[t] ?? [])) {
      const sql = `SELECT "id", "updated_at" FROM ${q(t)} WHERE "id" IN (SELECT value FROM json_each(?1))`;
      queries.push({ table: t, stmt: db.prepare(sql).bind(chunk.json) });
    }
  }
  if (queries.length === 0) return out;
  const results = await db.batch<{ id: string; updated_at: string }>(queries.map((x) => x.stmt));
  queries.forEach((x, i) => {
    for (const r of results[i]?.results ?? []) out[x.table].set(r.id, r.updated_at);
  });
  return out;
}

/** Live (not soft-deleted) ids per table that are not in `keep`. */
export async function readLiveIdsExcept(
  db: D1Database,
  keep: Record<SyncTable, string[]>,
): Promise<Record<SyncTable, string[]>> {
  const results = await db.batch<{ id: string }>(
    SYNC_TABLES.map((t) => db.prepare(`SELECT "id" FROM ${q(t)} WHERE "deleted_at" IS NULL`)),
  );
  return Object.fromEntries(
    SYNC_TABLES.map((t, i) => {
      const kept = new Set(keep[t]);
      return [t, (results[i]?.results ?? []).map((r) => r.id).filter((id) => !kept.has(id))];
    }),
  ) as Record<SyncTable, string[]>;
}

export interface WriteInput {
  /** Serialized rows per table. */
  rows: Partial<Record<SyncTable, DbRow[]>>;
  mode: "lww" | "force";
  /** Optional soft deletes (import replace). */
  softDelete?: { at: string; ids: Partial<Record<SyncTable, string[]>> };
}

export interface WriteResult {
  /** Rows actually inserted or updated per table (LWW losers excluded). */
  written: Record<SyncTable, number>;
  deleted: Record<SyncTable, number>;
}

/** One atomic batch: reserve revs, upsert rows, soft delete. All or nothing. */
export async function writeRows(db: D1Database, input: WriteInput): Promise<WriteResult> {
  const zero = () => Object.fromEntries(SYNC_TABLES.map((t) => [t, 0])) as Record<SyncTable, number>;
  const result: WriteResult = { written: zero(), deleted: zero() };

  const upserts = SYNC_TABLES.filter((t) => (input.rows[t]?.length ?? 0) > 0);
  const deletes = SYNC_TABLES.filter((t) => (input.softDelete?.ids[t]?.length ?? 0) > 0);
  const total =
    upserts.reduce((n, t) => n + input.rows[t]!.length, 0) +
    deletes.reduce((n, t) => n + input.softDelete!.ids[t]!.length, 0);
  if (total === 0) return result;

  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO sync_meta (key, value) VALUES ('rev', ?1) ON CONFLICT(key) DO UPDATE SET value = value + ?1`,
      )
      .bind(total),
  ];
  const plan: Array<{ table: SyncTable; kind: "written" | "deleted" }> = [];
  let offset = 0;
  for (const t of upserts) {
    const sql = upsertSql(t, input.mode);
    for (const chunk of chunkJson(input.rows[t]!)) {
      stmts.push(db.prepare(sql).bind(chunk.json, total, offset));
      plan.push({ table: t, kind: "written" });
      offset += chunk.count;
    }
  }
  for (const t of deletes) {
    const sql = softDeleteSql(t);
    for (const chunk of chunkJson(input.softDelete!.ids[t]!)) {
      stmts.push(db.prepare(sql).bind(input.softDelete!.at, chunk.json, total, offset));
      plan.push({ table: t, kind: "deleted" });
      offset += chunk.count;
    }
  }

  const results = await db.batch(stmts);
  plan.forEach((p, i) => {
    result[p.kind][p.table] += results[i + 1]?.meta.changes ?? 0;
  });
  return result;
}

export async function currentRev(db: D1Database): Promise<number> {
  const row = await db.prepare(`SELECT value FROM sync_meta WHERE key = 'rev'`).first<{ value: number }>();
  return row?.value ?? 0;
}

export interface PullResult {
  changes: TableRows;
  cursor: number;
  more: boolean;
  count: number;
}

/**
 * Rows with rev > cursor across all tables, in rev order, at most `limit`.
 * All reads run in one batch (one transaction) so the tables are read at the same point in time.
 */
export async function pullSince(db: D1Database, cursor: number, limit: number): Promise<PullResult> {
  const results = await db.batch<Record<string, unknown>>(
    SYNC_TABLES.map((t) =>
      db.prepare(`SELECT * FROM ${q(t)} WHERE "rev" > ?1 ORDER BY "rev" LIMIT ?2`).bind(cursor, limit + 1),
    ),
  );
  const merged: Array<{ table: SyncTable; rev: number; row: Record<string, unknown> }> = [];
  SYNC_TABLES.forEach((t, i) => {
    for (const r of results[i]?.results ?? []) merged.push({ table: t, rev: Number(r.rev), row: r });
  });
  merged.sort((a, b) => a.rev - b.rev);
  const page = merged.slice(0, limit);
  const changes = emptyTables();
  for (const m of page) changes[m.table].push(deserializeRow(m.table, m.row));
  return {
    changes,
    cursor: page.length > 0 ? page[page.length - 1]!.rev : cursor,
    more: merged.length > limit,
    count: page.length,
  };
}

/** Every row of every table, including soft-deleted ones, in rev order. */
export async function readAll(db: D1Database): Promise<TableRows> {
  const results = await db.batch<Record<string, unknown>>(
    SYNC_TABLES.map((t) => db.prepare(`SELECT * FROM ${q(t)} ORDER BY "rev"`)),
  );
  const out = emptyTables();
  SYNC_TABLES.forEach((t, i) => {
    out[t] = (results[i]?.results ?? []).map((r) => deserializeRow(t, r));
  });
  return out;
}
