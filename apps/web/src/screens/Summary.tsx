/** Session summary (SPEC 4.1.9): what changed for next time and why. */
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Card, Page, ShellTitle, Skeleton, SummaryView } from "../components";
import { useEngine, useSessionLogs, useSessionSummary } from "../data";
import { fmtKg } from "../lib/format";

const MODALITY: Record<string, string> = { bike: "Bike", rower: "Rower", run: "Run", walk: "Walk", other: "Cardio" };

export function SummaryScreen() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { ready, summary, error } = useSessionSummary(sessionId);
  const { state, ctx } = useEngine();
  const logs = useSessionLogs(sessionId);
  const done = () => navigate("/");
  useEffect(() => {
    // Block body: in newer browsers scrollTo returns a promise, which an effect must not return.
    window.scrollTo?.(0, 0);
  }, [sessionId]);

  let body;
  if (!ready) {
    body = (
      <>
        <Skeleton height={110} />
        <Skeleton height={64} />
        <Skeleton height={180} />
      </>
    );
  } else if (summary) {
    const cardio = summary.code === "CARDIO" ? (logs?.cardio ?? []) : [];
    const detail = cardio.length
      ? cardio.map((c) => (
          <p key={c.id} className="m-0">
            {MODALITY[c.modality] ?? "Cardio"} · {fmtKg(c.minutes)} min · {c.intensity === "hard" ? `hard${c.hard_minutes ? ` ${fmtKg(c.hard_minutes)} min` : ""}` : "easy"}
            {c.avg_hr ? ` · ${c.avg_hr} bpm` : ""}
          </p>
        ))
      : null;
    body = <SummaryView summary={summary} onDone={done} blockWeeks={state?.block.block_weeks} goals={ctx?.config.week} detail={detail} exercises={ctx?.exercises} />;
  } else {
    body = (
      <Card label="Summary">
        <p className="text-[15px] leading-snug text-paper">
          {error ? "The summary could not be built right now. Your sets are saved." : "This session is not on this phone."}
        </p>
        {error && <p className="mt-2 break-words text-[11px] text-paper-faint">{error.message}</p>}
        <Button variant="primary" size="lg" block className="mt-4" onClick={done}>
          Back to Today
        </Button>
      </Card>
    );
  }

  return (
    <>
      <ShellTitle>
        <span className="text-paper">Summary</span>
      </ShellTitle>
      <Page className="gap-4 pb-4">{body}</Page>
    </>
  );
}
