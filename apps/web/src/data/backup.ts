/**
 * Export and import. Local files are the escape hatch that works without the server;
 * remote export/import talk to GET /api/export and POST /api/import.
 */
import { ExportFile, SYNC_TABLES, type Changes, type RowOf, type SyncTable } from "@gym/schema";
import { db } from "./db";
import { nowIso } from "./clock";
import { ApiError, apiJson } from "./api";
import { _mergeRows, _writeDrafts } from "./repo";
import { syncClient } from "./sync";

export type ImportMode = "merge" | "replace";

export interface ImportResult {
  /** Rows written from the file. */
  written: number;
  /** Rows in the file that were older than (or equal to) the local copy (merge only). */
  skipped: number;
  /** Local rows soft deleted because they were not in the file (replace only). */
  deleted: number;
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

/** Every synced row, soft-deleted ones included, as an ExportFile. */
export async function exportLocal(): Promise<ExportFile> {
  const tables: Record<string, unknown[]> = {};
  await db.transaction(
    "r",
    SYNC_TABLES.map((t) => db.table(t)),
    async () => {
      for (const t of SYNC_TABLES) tables[t] = await db.table(t).toArray();
    },
  );
  return { format: "workout-os-export", version: 1, exported_at: nowIso(), tables: tables as Changes };
}

/** Validates an unknown value (parsed JSON) as an ExportFile, with a readable error. */
export function parseExportFile(value: unknown): ExportFile {
  const parsed = ExportFile.safeParse(value);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const where = issue?.path.length ? ` at ${issue.path.join(".")}` : "";
  throw new ImportError(`Not a Workout OS export${where}: ${issue?.message ?? "invalid file"}`);
}

/** Reads a picked file (input type=file) into a validated ExportFile. */
export async function readExportFile(file: Blob): Promise<ExportFile> {
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    throw new ImportError("Not a Workout OS export: the file is not JSON");
  }
  return parseExportFile(json);
}

const fileRows = (file: ExportFile) =>
  SYNC_TABLES.flatMap((table) => ((file.tables[table] ?? []) as RowOf<SyncTable>[]).map((row) => ({ table, row })));

/**
 * Imports an export into Dexie and queues everything written for sync.
 * merge: last write wins per row (file rows keep their updated_at).
 * replace: local rows missing from the file are soft deleted (settings kept), then every file row is
 * written with a fresh updated_at so it also wins on the server.
 */
export async function importLocal(input: unknown, mode: ImportMode): Promise<ImportResult> {
  const file = parseExportFile(input);
  const rows = fileRows(file);

  if (mode === "merge") {
    const written = await _mergeRows(rows);
    return { written, skipped: rows.length - written, deleted: 0 };
  }

  const inFile = new Set(rows.map(({ table, row }) => `${table}\u0000${row.id}`));
  const now = nowIso();
  const deletions: { table: SyncTable; row: RowOf<SyncTable> }[] = [];
  for (const table of SYNC_TABLES) {
    if (table === "settings") continue;
    const local = (await db.table(table).toArray()) as RowOf<SyncTable>[];
    for (const row of local) {
      if (!row.deleted_at && !inFile.has(`${table}\u0000${row.id}`)) deletions.push({ table, row: { ...row, deleted_at: now } });
    }
  }
  await _writeDrafts([...deletions, ...rows]);
  return { written: rows.length, skipped: 0, deleted: deletions.length };
}

const isIos = () =>
  typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

/**
 * Saves a local export as a JSON file. On iPhone the share sheet ("Save to Files") is used when available,
 * elsewhere a normal download. Call from a tap handler.
 */
export async function downloadExport(): Promise<"shared" | "downloaded" | "cancelled"> {
  const file = await exportLocal();
  const name = `workout-os-${file.exported_at.slice(0, 10)}.json`;
  const blob = new Blob([JSON.stringify(file, null, 1)], { type: "application/json" });

  if (isIos() && typeof File !== "undefined" && navigator.share && navigator.canShare) {
    const shared = new File([blob], name, { type: "application/json" });
    if (navigator.canShare({ files: [shared] })) {
      try {
        await navigator.share({ files: [shared], title: "Workout OS export" });
        return "shared";
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return "cancelled";
        // NotAllowedError and friends: fall back to a download.
      }
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}

/** Full export from the server (GET /api/export). Throws ApiError (kind auth_required | offline | error). */
export async function fetchRemoteExport(opts: { fetch?: typeof fetch } = {}): Promise<ExportFile> {
  const json = await apiJson("/api/export", { method: "GET" }, opts);
  const parsed = ExportFile.safeParse(json);
  if (!parsed.success) throw new ApiError("error", "The server export was not valid");
  return parsed.data;
}

/**
 * Restores an export on the server (POST /api/import?mode=merge|replace, body = ExportFile),
 * then syncs so this device pulls the result. Throws ApiError or ImportError.
 */
export async function pushRemoteImport(
  input: unknown,
  mode: ImportMode,
  opts: { fetch?: typeof fetch } = {},
): Promise<unknown> {
  const file = parseExportFile(input);
  const res = await apiJson(`/api/import?mode=${mode}`, { method: "POST", body: file }, opts);
  syncClient.requestSync();
  return res;
}
