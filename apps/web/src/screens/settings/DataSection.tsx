/**
 * Data: export this phone, import a file (merge or replace, replace asks inline), server backup and
 * restore, persistent storage status. Every write goes through the data layer.
 */
import { useEffect, useRef, useState } from "react";
import type { ExportFile } from "@gym/schema";
import { Button, Card, SegmentedControl } from "../../components";
import {
  ApiError,
  ImportError,
  downloadExport,
  fetchRemoteExport,
  importLocal,
  pushRemoteImport,
  readExportFile,
  storageEstimate,
  type ImportMode,
  type StorageInfo,
} from "../../data";
import { Field, Note, Readout, Rule, Section } from "./fields";
import { exportRowCount, fmtBytes, saveJsonFile } from "./lib";

type Msg = { ok: boolean; text: string } | null;

const MODES = [
  { value: "merge", label: "Merge" },
  { value: "replace", label: "Replace" },
] as const;

function apiText(e: unknown, what: string): string {
  if (e instanceof ApiError) {
    if (e.kind === "offline") return `No connection. ${what} needs the server.`;
    if (e.kind === "auth_required") return "The server wants the sync key. Add it under Sync.";
    return `The server could not do it right now (${e.message}). Your data on this phone is untouched.`;
  }
  if (e instanceof ImportError) return e.message;
  return e instanceof Error ? e.message : String(e);
}

export function DataSection({ index }: { index: string }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [exportMsg, setExportMsg] = useState<Msg>(null);
  const [file, setFile] = useState<{ name: string; data: ExportFile } | null>(null);
  const [fileMsg, setFileMsg] = useState<Msg>(null);
  const [mode, setMode] = useState<ImportMode>("merge");
  const [confirm, setConfirm] = useState<"local" | "server" | null>(null);
  const [backupMsg, setBackupMsg] = useState<Msg>(null);
  const [storage, setStorage] = useState<StorageInfo | null>(null);

  useEffect(() => {
    let live = true;
    void storageEstimate().then((s) => live && setStorage(s));
    return () => {
      live = false;
    };
  }, [busy]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  const exportPhone = () =>
    run("export", async () => {
      try {
        const r = await downloadExport();
        setExportMsg(r === "cancelled" ? null : { ok: true, text: r === "shared" ? "Export handed to the share sheet." : "Export saved to Downloads." });
      } catch (e) {
        setExportMsg({ ok: false, text: apiText(e, "Export") });
      }
    });

  const pick = async (f: File | undefined) => {
    setFileMsg(null);
    setConfirm(null);
    if (!f) return;
    try {
      const data = await readExportFile(f);
      setFile({ name: f.name, data });
    } catch (e) {
      setFile(null);
      setFileMsg({ ok: false, text: apiText(e, "Import") });
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const importTo = (target: "local" | "server") => {
    if (!file) return;
    if (mode === "replace" && confirm !== target) {
      setConfirm(target);
      return;
    }
    setConfirm(null);
    void run(target === "local" ? "import" : "restore", async () => {
      try {
        if (target === "local") {
          const r = await importLocal(file.data, mode);
          const parts = [`${r.written} rows written`];
          if (r.skipped) parts.push(`${r.skipped} already up to date`);
          if (r.deleted) parts.push(`${r.deleted} removed`);
          setFileMsg({ ok: true, text: `${mode === "merge" ? "Merged" : "Replaced"} on this phone. ${parts.join(" · ")}.` });
        } else {
          await pushRemoteImport(file.data, mode);
          setFileMsg({ ok: true, text: `Server restored (${mode}). This phone syncs the result now.` });
        }
        setFile(null);
      } catch (e) {
        setFileMsg({ ok: false, text: apiText(e, "Restore") });
      }
    });
  };

  const downloadServer = () =>
    run("backup", async () => {
      try {
        const data = await fetchRemoteExport();
        const r = await saveJsonFile(`workout-os-server-${data.exported_at.slice(0, 10)}.json`, data);
        setBackupMsg(r === "cancelled" ? null : { ok: true, text: `Server backup saved · ${exportRowCount(data)} rows.` });
      } catch (e) {
        setBackupMsg({ ok: false, text: apiText(e, "The server backup") });
      }
    });

  const exportedAt = file ? file.data.exported_at.slice(0, 16).replace("T", " ") : "";

  return (
    <Section id="data" index={index} title="Data">
      <Card>
        <div className="flex flex-col gap-4">
          <Field label="Export" help="Everything on this phone as one JSON file. On iPhone pick Save to Files.">
            <Button variant="secondary" block onClick={exportPhone} disabled={busy !== null}>
              {busy === "export" ? "Exporting" : "Export this phone"}
            </Button>
            {exportMsg && <Note ok={exportMsg.ok}>{exportMsg.text}</Note>}
          </Field>

          <Rule />

          <Field label="Import" help="Load a Workout OS export into this phone, or restore the server from it.">
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              tabIndex={-1}
              aria-label="Export file"
              onChange={(e) => void pick(e.target.files?.[0])}
            />
            <Button variant="secondary" block onClick={() => fileInput.current?.click()} disabled={busy !== null}>
              {file ? "Pick another file" : "Pick a file"}
            </Button>

            {file && (
              <div className="flex flex-col gap-3 rounded-[3px] border border-line p-3">
                <div className="text-[13px] leading-snug">
                  <div className="truncate text-paper">{file.name}</div>
                  <div className="text-paper-faint">
                    Exported {exportedAt} UTC · {exportRowCount(file.data)} rows
                  </div>
                </div>
                <SegmentedControl
                  label="Import mode"
                  options={MODES}
                  value={mode}
                  onChange={(m) => {
                    setMode(m);
                    setConfirm(null);
                  }}
                />
                <p className="text-[12.5px] leading-snug text-paper-dim">
                  {mode === "merge"
                    ? "Merge keeps everything and takes the newer version of each row."
                    : "Replace makes the target match the file. Rows that are not in the file are removed (settings stay)."}
                </p>

                {confirm ? (
                  <div className="flex flex-col gap-2 rounded-[3px] border border-dashed border-paper-faint/70 p-3" role="group" aria-label="Confirm replace">
                    <p className="text-[13px] leading-snug text-paper">
                      {confirm === "local"
                        ? "Replace this phone with the file? Sessions not in the file are removed here and on the server at the next sync."
                        : "Replace the server with the file? Rows not in the file are removed on the server and then on this phone."}
                    </p>
                    <div className="flex gap-2">
                      <Button variant="ghost" onClick={() => setConfirm(null)}>
                        Cancel
                      </Button>
                      <Button variant="primary" className="ml-auto" onClick={() => importTo(confirm)}>
                        {confirm === "local" ? "Replace this phone" : "Replace server"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <Button variant="primary" block onClick={() => importTo("local")} disabled={busy !== null}>
                      {busy === "import" ? "Importing" : "Import to this phone"}
                    </Button>
                    <Button variant="secondary" block onClick={() => importTo("server")} disabled={busy !== null}>
                      {busy === "restore" ? "Restoring" : "Restore server from file"}
                    </Button>
                  </div>
                )}
              </div>
            )}
            {fileMsg && <Note ok={fileMsg.ok}>{fileMsg.text}</Note>}
          </Field>

          <Rule />

          <Field label="Server backup" help="A full copy of what the server holds, saved as a file.">
            <Button variant="secondary" block onClick={downloadServer} disabled={busy !== null}>
              {busy === "backup" ? "Downloading" : "Download server backup"}
            </Button>
            {backupMsg && <Note ok={backupMsg.ok}>{backupMsg.text}</Note>}
          </Field>

          <Rule />

          <Field label="Storage on this phone">
            <div>
              <Readout label="Persistent">
                {storage?.persisted == null ? "Unknown" : storage.persisted ? "Yes · Safari keeps the data" : "Not yet"}
              </Readout>
              <Readout label="Used">
                {fmtBytes(storage?.usage ?? null)}
                {storage?.quota != null ? ` of ${fmtBytes(storage.quota)}` : ""}
              </Readout>
            </div>
            {storage?.persisted === false && (
              <p className="text-[12.5px] leading-snug text-paper-dim">Open the app from the home screen icon. Safari keeps a home screen app's data. Export now and then to be safe.</p>
            )}
          </Field>
        </div>
      </Card>
    </Section>
  );
}
