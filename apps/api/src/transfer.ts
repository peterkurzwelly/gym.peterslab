/** GET /api/export and POST /api/import?mode=merge|replace. */
import { z } from "zod";
import { SYNC_TABLES, type ExportFile, type SyncTable } from "@gym/schema";
import { LooseTables, idsByTable, lwwWinners, serializeTables, validateTables, type Rejected } from "./rows";
import { readAll, readLiveIdsExcept, readUpdatedAt, writeRows } from "./store";

export async function buildExport(db: D1Database): Promise<ExportFile> {
  return {
    format: "workout-os-export",
    version: 1,
    exported_at: new Date().toISOString(),
    tables: (await readAll(db)) as ExportFile["tables"],
  };
}

/** ExportFile envelope; rows are validated one by one. */
export const ImportEnvelope = z.object({
  format: z.literal("workout-os-export"),
  version: z.literal(1),
  exported_at: z.string().optional(),
  tables: LooseTables,
});

export const ImportMode = z.enum(["merge", "replace"]);
export type ImportMode = z.infer<typeof ImportMode>;

export type TableCounts = { received: number; written: number; deleted: number };
export type ImportResult =
  | { ok: true; mode: ImportMode; counts: Record<SyncTable, TableCounts>; rejected: Rejected[] }
  | { ok: false; error: "invalid_rows"; rejected: Rejected[] };

/**
 * merge: last write wins, like a sync push.
 * replace: every live row whose id is not in the file is soft deleted (deleted_at = updated_at = now),
 * then every file row is written as is. Both get new revs, in one batch. Replace refuses a file with
 * invalid rows instead of half applying a destructive restore.
 */
export async function runImport(
  db: D1Database,
  file: z.infer<typeof ImportEnvelope>,
  mode: ImportMode,
): Promise<ImportResult> {
  const { valid, rejected } = validateTables(file.tables);
  if (mode === "replace" && rejected.length > 0) return { ok: false, error: "invalid_rows", rejected };

  let result;
  if (mode === "merge") {
    const stored = await readUpdatedAt(db, idsByTable(valid));
    result = await writeRows(db, { rows: serializeTables(lwwWinners(valid, stored)), mode: "lww" });
  } else {
    const toDelete = await readLiveIdsExcept(db, idsByTable(valid));
    result = await writeRows(db, {
      rows: serializeTables(valid),
      mode: "force",
      softDelete: { at: new Date().toISOString(), ids: toDelete },
    });
  }

  const counts = Object.fromEntries(
    SYNC_TABLES.map((t) => [
      t,
      { received: file.tables[t]?.length ?? 0, written: result.written[t], deleted: result.deleted[t] },
    ]),
  ) as Record<SyncTable, TableCounts>;
  return { ok: true, mode, counts, rejected };
}
