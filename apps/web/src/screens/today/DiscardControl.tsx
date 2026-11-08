import { useState } from "react";
import { Button } from "../../components";

/** Small "Discard session" with an inline confirm. No modal, nothing alarming. */
export function DiscardControl({ setsLogged, onDiscard }: { setsLogged: number; onDiscard: () => void | Promise<void> }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!asking) {
    return (
      <div className="flex justify-center">
        <Button variant="ghost" size="sm" onClick={() => setAsking(true)}>
          Discard session
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-[3px] border border-line bg-ink-2/50 px-4 py-3" role="group" aria-label="Discard session">
      <p className="text-[14px] leading-snug text-paper">
        Discard this session?{" "}
        <span className="text-paper-dim">
          {setsLogged === 0 ? "Nothing is logged yet." : `The ${setsLogged} logged ${setsLogged === 1 ? "set goes" : "sets go"} with it.`}
        </span>
      </p>
      <div className="mt-3 flex gap-2">
        <Button
          variant="secondary"
          size="md"
          className="flex-1"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onDiscard();
            } finally {
              setBusy(false);
              setAsking(false);
            }
          }}
        >
          Discard
        </Button>
        <Button variant="ghost" size="md" className="flex-1" onClick={() => setAsking(false)}>
          Keep it
        </Button>
      </div>
    </div>
  );
}
