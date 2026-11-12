import { useEffect, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "../lib/cx";
import { CloseIcon } from "./Icons";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name and visible heading. */
  title: string;
  /** Small line above the title. */
  eyebrow?: ReactNode;
  children: ReactNode;
  /** Hide the visible heading (the content brings its own). */
  bare?: boolean;
  className?: string;
}

let locks = 0;
function lockScroll(): () => void {
  locks += 1;
  if (locks === 1) document.documentElement.style.overflow = "hidden";
  return () => {
    locks -= 1;
    if (locks === 0) document.documentElement.style.overflow = "";
  };
}

/** Bottom sheet. Opened by the user, closed by the backdrop, the close button or Escape. */
export function Sheet({ open, onClose, title, eyebrow, children, bare, className }: SheetProps) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const unlock = lockScroll();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      unlock();
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col justify-end">
      <button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} className="gym-sheet-backdrop absolute inset-0 cursor-default bg-black/70" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx(
          "gym-sheet relative mx-auto flex max-h-[92dvh] w-full max-w-[640px] flex-col overflow-hidden rounded-t-[28px] bg-card shadow-[0_-20px_60px_rgba(0,0,0,0.6)]",
          className,
        )}
      >
        <div className="flex shrink-0 items-start gap-3 px-5 pb-2 pt-4">
          <div className="min-w-0 flex-1">
            {eyebrow && <div className="gym-label mb-1">{eyebrow}</div>}
            <h2 id={titleId} className={cx("m-0 font-display text-[28px] uppercase text-fg", bare && "sr-only")}>
              {title}
            </h2>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="gym-press -mr-1 grid h-11 w-11 shrink-0 place-items-center rounded-full bg-raise text-fg-dim active:text-fg">
            <CloseIcon size={20} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(env(safe-area-inset-bottom)+20px)]">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
