/** Sync: the key (stored on this device only), a live test against /api/auth/check, status and Sync now. */
import { useEffect, useId, useState } from "react";
import { Button, Card, SyncDot } from "../../components";
import { setSyncKey, syncClient, syncNow, useSyncStatus } from "../../data";
import { useNow } from "../../lib/timers";
import { Field, Note, Readout, Rule, Section, TextInput } from "./fields";
import { fmtAgo, pendingText, syncStateText, testSyncKey, type KeyTestResult } from "./lib";

export function SyncSection({ index }: { index: string }) {
  const status = useSyncStatus();
  const now = useNow(true, 15_000);
  const inputId = useId();
  const [draft, setDraft] = useState("");
  const [show, setShow] = useState(false);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [test, setTest] = useState<KeyTestResult | null>(null);
  const [busy, setBusy] = useState<"test" | "save" | "sync" | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void syncClient
      .hasSyncKey()
      .then((v) => live && setHasKey(v))
      .catch(() => live && setHasKey(false));
    return () => {
      live = false;
    };
  }, []);

  const typed = draft.trim();

  const runTest = async () => {
    setBusy("test");
    setTest(null);
    try {
      setTest(await testSyncKey(typed || null));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!typed) return;
    setBusy("save");
    try {
      await setSyncKey(typed);
      setHasKey(true);
      setDraft("");
      setShow(false);
      setSaved("Key saved on this phone. Syncing.");
      setTest(null);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("save");
    try {
      await setSyncKey(null);
      setHasKey(false);
      setSaved("Key removed from this phone. Logging still works offline.");
      setTest(null);
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    setBusy("sync");
    try {
      await syncNow();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section id="sync" index={index} title="Sync" right={<SyncDot status={status.state} />}>
      <Card>
        <div className="flex flex-col gap-4">
          <p className="text-[13px] leading-snug text-fg-dim">Logging works offline. The key stays on this phone and only goes to your own server.</p>

          <Field
            label="Sync key"
            htmlFor={inputId}
            help={hasKey ? "A key is saved on this phone. Paste a new one to replace it." : hasKey === false ? "Paste the key once on each device." : undefined}
          >
            <div className="flex gap-2">
              <TextInput
                id={inputId}
                type={show ? "text" : "password"}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setTest(null);
                  setSaved(null);
                }}
                placeholder={hasKey ? "••••••••  saved" : "Paste sync key"}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="done"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && typed) void save();
                }}
              />
              <Button variant="ghost" className="shrink-0 px-3" onClick={() => setShow((s) => !s)} aria-pressed={show} aria-label={show ? "Hide key" : "Show key"}>
                {show ? "Hide" : "Show"}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={save} disabled={!typed || busy !== null}>
                Save key
              </Button>
              <Button variant="secondary" onClick={runTest} disabled={busy !== null || (!typed && !hasKey)}>
                {busy === "test" ? "Testing" : "Test"}
              </Button>
              {hasKey && !typed && (
                <Button variant="ghost" onClick={remove} disabled={busy !== null}>
                  Remove
                </Button>
              )}
            </div>
            {test && (
              <Note ok={test.ok}>
                {typed && test.ok ? `${test.text} Save it to use it.` : test.text}
              </Note>
            )}
            {saved && !test && <Note ok>{saved}</Note>}
          </Field>

          <Rule />

          <div>
            <Readout label="State">{syncStateText(status)}</Readout>
            <Readout label="Last sync">{fmtAgo(status.lastSyncAt, now)}</Readout>
            <Readout label="On this phone">{pendingText(status.pending)}</Readout>
            {status.lastError && status.state !== "offline" && status.state !== "syncing" && (
              <p className="mt-1 text-[12px] leading-snug text-fg-faint">{status.lastError}</p>
            )}
          </div>

          <Button variant="secondary" block onClick={sync} disabled={busy === "sync" || status.state === "syncing"}>
            {busy === "sync" || status.state === "syncing" ? "Syncing" : "Sync now"}
          </Button>
        </div>
      </Card>
    </Section>
  );
}
