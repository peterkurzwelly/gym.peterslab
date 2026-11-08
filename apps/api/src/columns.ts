/**
 * D1 column layout derived from the Zod row schemas in @gym/schema.
 * One table per sync table, one column per schema field (same name), plus `rev`.
 * Storage: arrays/objects/records as JSON TEXT, booleans as INTEGER 0/1, nullable as NULL.
 * The migration SQL is written out explicitly; test/schema.test.ts checks it matches this.
 */
import type { z } from "zod";
import { SYNC_TABLES, TableSchemas, type SyncTable } from "@gym/schema";

export type ColumnKind = "text" | "integer" | "real" | "boolean" | "json";
export interface Column {
  name: string;
  kind: ColumnKind;
  nullable: boolean;
}

/** The parts of a Zod 4 def we look at. */
type Def = { type: string; innerType?: z.ZodType; in?: z.ZodType; values?: unknown[] };

function describe(schema: z.ZodType): { kind: ColumnKind; nullable: boolean } {
  let s = schema;
  let nullable = false;
  for (;;) {
    const def = s._zod.def as unknown as Def;
    switch (def.type) {
      case "nullable":
      case "optional":
        nullable = true;
        s = def.innerType!;
        continue;
      case "default":
      case "prefault":
      case "readonly":
      case "catch":
        s = def.innerType!;
        continue;
      case "pipe":
        s = def.in!;
        continue;
      case "string":
      case "enum":
        return { kind: "text", nullable };
      case "literal":
        return { kind: typeof def.values?.[0] === "number" ? "real" : "text", nullable };
      case "number":
        return { kind: (s as unknown as { isInt?: boolean }).isInt ? "integer" : "real", nullable };
      case "boolean":
        return { kind: "boolean", nullable };
      case "array":
      case "tuple":
      case "object":
      case "record":
      case "unknown":
      case "any":
        return { kind: "json", nullable };
      default:
        throw new Error(`columns: unsupported zod type "${def.type}"`);
    }
  }
}

function columnsOf(table: SyncTable): Column[] {
  const shape = TableSchemas[table].shape as Record<string, z.ZodType>;
  return Object.entries(shape).map(([name, field]) => ({ name, ...describe(field) }));
}

export const TABLE_COLUMNS = Object.fromEntries(SYNC_TABLES.map((t) => [t, columnsOf(t)])) as Record<
  SyncTable,
  Column[]
>;

export const SQL_TYPE: Record<ColumnKind, "TEXT" | "INTEGER" | "REAL"> = {
  text: "TEXT",
  integer: "INTEGER",
  real: "REAL",
  boolean: "INTEGER",
  json: "TEXT",
};

export type DbValue = string | number | null;
export type DbRow = Record<string, DbValue>;

/** Validated row (Zod output) -> column values. */
export function serializeRow(table: SyncTable, row: Record<string, unknown>): DbRow {
  const out: DbRow = {};
  for (const col of TABLE_COLUMNS[table]) {
    const v = row[col.name];
    if (v === undefined || v === null) out[col.name] = null;
    else if (col.kind === "boolean") out[col.name] = v ? 1 : 0;
    else if (col.kind === "json") out[col.name] = JSON.stringify(v);
    else out[col.name] = v as string | number;
  }
  return out;
}

/** D1 result row -> schema shaped row (rev dropped). */
export function deserializeRow(table: SyncTable, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of TABLE_COLUMNS[table]) {
    const v = row[col.name];
    if (v === undefined || v === null) out[col.name] = null;
    else if (col.kind === "boolean") out[col.name] = v === 1 || v === true;
    else if (col.kind === "json") out[col.name] = JSON.parse(String(v));
    else out[col.name] = v;
  }
  return out;
}

/** CREATE TABLE text for a sync table. Used to author and check the migration, not at runtime. */
export function createTableSql(table: SyncTable): string {
  const lines = TABLE_COLUMNS[table].map((c) => {
    const nn = c.nullable ? "" : " NOT NULL";
    const pk = c.name === "id" ? " PRIMARY KEY" : "";
    return `  ${c.name} ${SQL_TYPE[c.kind]}${nn}${pk}`;
  });
  lines.push("  rev INTEGER NOT NULL");
  return `CREATE TABLE ${table} (\n${lines.join(",\n")}\n);\nCREATE UNIQUE INDEX ${table}_rev ON ${table} (rev);`;
}
