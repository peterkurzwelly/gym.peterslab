/** Engine flags: stalls, deload, readiness trend, pain. Volume flags fold into one quiet line. */
import type { Flag } from "@gym/engine";
import { useState } from "react";
import { Card } from "../../components";
import { fmtLocalDate } from "../../lib/format";
import { FLAG_CAPTION, groupFlags, volumeLine } from "./model";

const SHOW = 6;

export function FlagsCard({ flags }: { flags: Flag[] }) {
  const { items, volume } = groupFlags(flags);
  const [all, setAll] = useState(false);
  const [volOpen, setVolOpen] = useState(false);
  const shown = all ? items : items.slice(0, SHOW);
  const vline = volumeLine(volume);

  return (
    <Card>
      {!items.length && !vline ? (
        <p className="m-0 text-[13px] leading-snug text-paper-dim">No flags. Nothing needs a change right now.</p>
      ) : (
        <ul className="m-0 list-none divide-y divide-line/70 p-0">
          {shown.map((f, i) => (
            <li key={`${f.rule_id}-${f.exercise_id ?? ""}-${f.date}-${i}`} className="py-2.5 first:pt-0">
              <div className="flex items-baseline justify-between gap-3 text-[10.5px] uppercase tracking-[0.12em] text-paper-faint">
                <span>{FLAG_CAPTION[f.kind]}</span>
                <span className="normal-case tracking-normal">{fmtLocalDate(f.date.slice(0, 10))}</span>
              </div>
              <p className="m-0 mt-1 text-[13.5px] leading-snug text-paper">{f.text}</p>
            </li>
          ))}
          {vline && (
            <li className="py-2.5 first:pt-0">
              <button type="button" onClick={() => setVolOpen((o) => !o)} aria-expanded={volOpen} className="flex min-h-11 w-full items-center text-left text-[13px] leading-snug text-paper-dim">
                {vline}
              </button>
              {volOpen && (
                <ul className="m-0 list-none p-0">
                  {volume.map((f, i) => (
                    <li key={`${f.rule_id}-${i}`} className="py-1 text-[12.5px] leading-snug text-paper-faint">
                      {f.text}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )}
        </ul>
      )}
      {items.length > SHOW && (
        <button type="button" onClick={() => setAll((a) => !a)} className="mt-1 min-h-11 text-[12px] uppercase tracking-[0.12em] text-paper-dim">
          {all ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </Card>
  );
}
