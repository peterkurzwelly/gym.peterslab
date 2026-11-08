/** Loading and error states for Today and Summary. Calm, and always clear that the log is safe. */
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Button, Card, Page, Skeleton } from "../../components";
import { db, downloadExport } from "../../data";

export function TodaySkeleton() {
  return (
    <Page className="gap-3">
      <Skeleton height={196} />
      <Skeleton height={150} />
      <Skeleton height={56} />
      <Skeleton height={260} />
    </Page>
  );
}

/** Live count of logged sets and cardio logs on this phone. undefined while loading. */
function useLocalLogCount(): { sets: number; cardio: number } | undefined {
  return useLiveQuery(async () => {
    const [sets, cardio] = await Promise.all([
      db.set_log.filter((s) => !s.deleted_at).count(),
      db.cardio_log.filter((c) => !c.deleted_at).count(),
    ]);
    return { sets, cardio };
  }, []);
}

export function EngineError({ title = "Today could not be planned", detail }: { title?: string; detail?: string | null }) {
  const count = useLocalLogCount();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  return (
    <Page className="gap-3">
      <Card label="Today">
        <h1 className="m-0 font-display text-[34px] font-normal leading-[1.05] text-paper">{title}</h1>
        <p className="mt-3 text-[15px] leading-snug text-paper">
          Your log is safe on this phone
          {count ? (
            <span className="text-paper-dim">
              {" "}
              · {count.sets} {count.sets === 1 ? "set" : "sets"}
              {count.cardio > 0 ? ` and ${count.cardio} cardio ${count.cardio === 1 ? "log" : "logs"}` : ""} saved
            </span>
          ) : null}
          .
        </p>
        <p className="mt-2 text-[13px] leading-snug text-paper-dim">Nothing was lost. Reload to try again, or keep a backup first.</p>
        {detail && <p className="mt-2 break-words text-[11px] leading-snug text-paper-faint">{detail}</p>}
        <div className="mt-4 flex flex-col gap-2">
          <Button variant="primary" size="lg" block onClick={() => window.location.reload()}>
            Reload
          </Button>
          <Button
            variant="secondary"
            size="md"
            block
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await downloadExport();
                setSaved(true);
              } catch (e) {
                console.warn("[today] backup", e);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saved ? "Backup saved" : "Save a backup"}
          </Button>
        </div>
      </Card>
    </Page>
  );
}
