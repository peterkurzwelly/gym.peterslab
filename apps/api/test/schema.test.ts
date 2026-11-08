import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { SYNC_TABLES, TableSchemas } from "@gym/schema";
import { SQL_TYPE, TABLE_COLUMNS } from "../src/columns";

type ColumnInfo = { name: string; type: string; notnull: number; pk: number };

async function tableInfo(table: string): Promise<Map<string, ColumnInfo>> {
  const { results } = await env.DB.prepare(`PRAGMA table_info("${table}")`).all<ColumnInfo>();
  return new Map(results.map((c) => [c.name, c]));
}

describe("D1 schema matches @gym/schema", () => {
  it.each(SYNC_TABLES)("%s: every Zod field has a column of the right type", async (table) => {
    const info = await tableInfo(table);
    expect(info.size, "table exists").toBeGreaterThan(0);

    const fields = Object.keys(TableSchemas[table].shape);
    for (const f of fields) expect(info.has(f), `${table}.${f} column`).toBe(true);
    expect([...info.keys()].sort()).toEqual([...fields, "rev"].sort());

    for (const col of TABLE_COLUMNS[table]) {
      const c = info.get(col.name)!;
      expect(c.type, `${table}.${col.name} type`).toBe(SQL_TYPE[col.kind]);
      expect(c.notnull === 1, `${table}.${col.name} not null`).toBe(!col.nullable);
    }
    expect(info.get("id")!.pk).toBe(1);
    expect(info.get("rev")).toMatchObject({ type: "INTEGER", notnull: 1 });
  });

  it.each(SYNC_TABLES)("%s: rev is indexed", async (table) => {
    const { results } = await env.DB.prepare(`PRAGMA index_list("${table}")`).all<{ name: string }>();
    const names = results.map((r) => r.name);
    expect(names).toContain(`${table}_rev`);
  });

  it("sync_meta holds the global rev", async () => {
    const info = await tableInfo("sync_meta");
    expect([...info.keys()].sort()).toEqual(["key", "value"]);
    const row = await env.DB.prepare(`SELECT value FROM sync_meta WHERE key = 'rev'`).first<{ value: number }>();
    expect(typeof row!.value).toBe("number");
  });

  it("column kinds follow the storage rules", () => {
    const kind = (t: (typeof SYNC_TABLES)[number], name: string) => TABLE_COLUMNS[t].find((c) => c.name === name);
    expect(kind("set_log", "is_warmup")).toMatchObject({ kind: "boolean", nullable: false });
    expect(kind("set_log", "target_reps")).toMatchObject({ kind: "integer", nullable: true });
    expect(kind("set_log", "weight")).toMatchObject({ kind: "real", nullable: false });
    expect(kind("settings", "remembered_weights")).toMatchObject({ kind: "json" });
    expect(kind("exercise", "instructions")).toMatchObject({ kind: "json" });
    expect(kind("exercise", "source_id")).toMatchObject({ kind: "text", nullable: true });
    expect(kind("decision", "inputs_snapshot")).toMatchObject({ kind: "json" });
    expect(kind("settings", "id")).toMatchObject({ kind: "text" });
  });
});
