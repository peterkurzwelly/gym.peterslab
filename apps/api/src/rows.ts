/** Per-row validation and LWW planning shared by /sync and /import. */
import { z } from "zod";
import { SYNC_TABLES, TableSchemas, type SyncTable } from "@gym/schema";
import { serializeRow, type DbRow } from "./columns";
import type { Row } from "./store";

export type Rejected = { table: string; id: string; reason: string };

/** Envelope shape for incoming table maps. Rows are validated one by one, not here. */
export const LooseTables = z.record(z.string(), z.array(z.unknown()));

const isSyncTable = (t: string): t is SyncTable => (SYNC_TABLES as readonly string[]).includes(t);

function idOf(raw: unknown): string {
  if (raw && typeof raw === "object" && "id" in raw) {
    const id = (raw as { id: unknown }).id;
    if (typeof id === "string" || typeof id === "number") return String(id).slice(0, 64);
  }
  return "";
}

function reasonOf(error: z.ZodError): string {
  const parts = error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "row"}: ${i.message}`);
  if (error.issues.length > 3) parts.push(`+${error.issues.length - 3} more`);
  return parts.join("; ").slice(0, 300);
}

/**
 * Validates every row with its Zod schema. Invalid rows and unknown tables go to `rejected`.
 * Duplicate ids in one payload collapse to the newest updated_at (first one wins a tie).
 */
export function validateTables(tables: Record<string, unknown[]>): {
  valid: Record<SyncTable, Row[]>;
  rejected: Rejected[];
  received: number;
} {
  const valid = Object.fromEntries(SYNC_TABLES.map((t) => [t, [] as Row[]])) as Record<SyncTable, Row[]>;
  const rejected: Rejected[] = [];
  let received = 0;
  for (const [table, rows] of Object.entries(tables)) {
    received += rows.length;
    if (!isSyncTable(table)) {
      for (const raw of rows) rejected.push({ table, id: idOf(raw), reason: "unknown_table" });
      continue;
    }
    const byId = new Map<string, Row>();
    for (const raw of rows) {
      const parsed = TableSchemas[table].safeParse(raw);
      if (!parsed.success) {
        rejected.push({ table, id: idOf(raw), reason: reasonOf(parsed.error) });
        continue;
      }
      const row = parsed.data as Row;
      const prev = byId.get(row.id as string);
      if (!prev || newer(row.updated_at as string, prev.updated_at as string)) byId.set(row.id as string, row);
    }
    valid[table] = [...byId.values()];
  }
  return { valid, rejected, received };
}

/** Strictly newer by instant (string compare is wrong for "…00Z" vs "…00.500Z"). */
export function newer(a: string, b: string): boolean {
  return Date.parse(a) > Date.parse(b);
}

export function idsByTable(rows: Record<SyncTable, Row[]>): Record<SyncTable, string[]> {
  return Object.fromEntries(SYNC_TABLES.map((t) => [t, rows[t].map((r) => r.id as string)])) as Record<
    SyncTable,
    string[]
  >;
}

/** Keeps rows that win LWW against the stored updated_at (no stored row also wins). */
export function lwwWinners(
  rows: Record<SyncTable, Row[]>,
  stored: Record<SyncTable, Map<string, string>>,
): Record<SyncTable, Row[]> {
  return Object.fromEntries(
    SYNC_TABLES.map((t) => [
      t,
      rows[t].filter((r) => {
        const cur = stored[t].get(r.id as string);
        return cur === undefined || newer(r.updated_at as string, cur);
      }),
    ]),
  ) as Record<SyncTable, Row[]>;
}

export function serializeTables(rows: Record<SyncTable, Row[]>): Record<SyncTable, DbRow[]> {
  return Object.fromEntries(SYNC_TABLES.map((t) => [t, rows[t].map((r) => serializeRow(t, r))])) as Record<
    SyncTable,
    DbRow[]
  >;
}
