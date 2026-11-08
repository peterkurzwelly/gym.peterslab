/** Small layout pieces shared by the settings sections. Presentational only. */
import type { InputHTMLAttributes, ReactNode } from "react";
import { cx } from "../../lib/cx";
import { SectionHeader } from "../../components";

/** One settings section: drawing sheet header + a stack of blocks. */
export function Section({ id, index, title, right, children }: { id: string; index: string; title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-16 flex-col gap-3">
      <SectionHeader index={index} right={right}>
        <span id={`${id}-title`}>{title}</span>
      </SectionHeader>
      {children}
    </section>
  );
}

/** A labelled block inside a card: caption, optional help line, then the control. */
export function Field({ label, help, htmlFor, children, className }: { label: ReactNode; help?: ReactNode; htmlFor?: string; children?: ReactNode; className?: string }) {
  const Caption = htmlFor ? "label" : "div";
  return (
    <div className={cx("flex flex-col gap-2", className)}>
      <div>
        <Caption {...(htmlFor ? { htmlFor } : {})} className="block text-[11px] uppercase tracking-[0.14em] text-paper-faint">
          {label}
        </Caption>
        {help && <p className="mt-1 text-[12.5px] leading-snug text-paper-dim">{help}</p>}
      </div>
      {children}
    </div>
  );
}

/** Text input at 16 px (no iOS zoom). No autofocus anywhere: the keyboard only opens when tapped. */
export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        "h-12 w-full min-w-0 rounded-[3px] border border-line bg-ink px-3 font-mono text-[16px] text-paper outline-none placeholder:text-paper-faint focus:border-paper/60",
        className,
      )}
      {...rest}
    />
  );
}

/** Thin divider between blocks of one card. */
export const Rule = () => <div aria-hidden className="h-px bg-line/80" />;

/** Calm one line result under an action. ok = it worked; otherwise neutral. Never red, and green stays reserved for the week. */
export function Note({ children, ok, className }: { children: ReactNode; ok?: boolean; className?: string }) {
  return (
    <p role="status" className={cx("text-[13px] leading-snug", ok ? "text-paper" : "text-paper-dim", className)}>
      {ok && <span className="mr-1.5">✓</span>}
      {children}
    </p>
  );
}

/** Label / value line for status readouts. */
export function Readout({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-7 items-baseline justify-between gap-3 text-[13px]">
      <span className="shrink-0 text-paper-faint">{label}</span>
      <span className="min-w-0 text-right text-paper">{children}</span>
    </div>
  );
}
