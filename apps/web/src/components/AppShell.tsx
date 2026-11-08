/**
 * App frame: header (title slot, sync slot, gear), content, a dock for floating bars, and the tab bar.
 *
 * Screens fill the slots from anywhere below the shell with portals:
 *   <ShellTitle>Session A</ShellTitle>   <ShellSync><SyncDot status="idle" /></ShellSync>
 *   <ShellDock><RestTimer … /><FinishBar … /></ShellDock>
 * The `title`, `sync` and `dock` props do the same for callers that render the shell directly.
 */
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { NavLink, useLocation } from "react-router-dom";
import { cx } from "../lib/cx";
import { installAudioUnlock } from "../lib/sound";
import { GearIcon, PlanIcon, ProgressIcon, TodayIcon } from "./Icons";

/** Tab bar height without the safe area. */
export const TAB_BAR_HEIGHT = 56;

type SlotName = "title" | "sync" | "dock";
type Slots = Record<SlotName, HTMLElement | null>;
const SlotsContext = createContext<Slots>({ title: null, sync: null, dock: null });

function SlotPortal({ name, children }: { name: SlotName; children: ReactNode }) {
  const el = useContext(SlotsContext)[name];
  return el ? createPortal(children, el) : null;
}

/** Replace the header title while mounted. */
export const ShellTitle = ({ children }: { children: ReactNode }) => <SlotPortal name="title">{children}</SlotPortal>;
/** Put a sync indicator in the header. */
export const ShellSync = ({ children }: { children: ReactNode }) => <SlotPortal name="sync">{children}</SlotPortal>;
/** Float bars (rest timer, finish bar) above the tab bar. Content scrolls clear of them. */
export const ShellDock = ({ children }: { children: ReactNode }) => <SlotPortal name="dock">{children}</SlotPortal>;

export interface AppShellProps {
  children: ReactNode;
  title?: ReactNode;
  sync?: ReactNode;
  dock?: ReactNode;
}

const TABS = [
  { to: "/", label: "Today", Icon: TodayIcon, end: true },
  { to: "/plan", label: "Plan", Icon: PlanIcon, end: false },
  { to: "/progress", label: "Progress", Icon: ProgressIcon, end: false },
] as const;

export function AppShell({ children, title, sync, dock }: AppShellProps) {
  const [titleEl, setTitleEl] = useState<HTMLElement | null>(null);
  const [syncEl, setSyncEl] = useState<HTMLElement | null>(null);
  const [dockEl, setDockEl] = useState<HTMLElement | null>(null);
  const dockWrap = useRef<HTMLDivElement>(null);
  const [dockHeight, setDockHeight] = useState(0);

  // iOS only plays audio after a gesture: unlock on the first tap anywhere.
  useEffect(() => installAudioUnlock(), []);

  // A tab opens at its top, not at the previous tab's scroll offset. Child effects run first, so a running
  // session on Today still lands on its next set (it scrolls after a short delay).
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo?.(0, 0);
  }, [pathname]);

  // Keep content scrollable past the dock, whatever is in it.
  useLayoutEffect(() => {
    const el = dockWrap.current;
    if (!el) return;
    const measure = () => setDockHeight(el.offsetHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const slots: Slots = { title: titleEl, sync: syncEl, dock: dockEl };
  const tabSpace = `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom))`;
  // Space covered at the bottom by the tab bar and the dock. Used for padding and scroll margins.
  const shellBottom = `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom) + ${dockHeight}px + 16px)`;

  return (
    <SlotsContext.Provider value={slots}>
      <div className="gym-shell min-h-full bg-ink text-paper" style={{ ["--shell-bottom" as string]: shellBottom }}>
        <header className="sticky top-0 z-30 border-b border-line bg-ink/92 pt-[env(safe-area-inset-top)] backdrop-blur-md">
          <div className="mx-auto flex h-12 max-w-[640px] items-center gap-2 pl-[max(16px,env(safe-area-inset-left))] pr-[max(4px,env(safe-area-inset-right))]">
            <div ref={setTitleEl} className="shell-title min-w-0 flex-1 truncate text-[12px] uppercase tracking-[0.16em] text-paper-dim">
              {title ?? (
                <span className="shell-title-default">
                  <span className="text-paper">Workout OS</span>
                  <span className="text-paper-faint"> · gym</span>
                </span>
              )}
            </div>
            <div ref={setSyncEl} className="flex shrink-0 items-center">
              {sync}
            </div>
            <NavLink
              to="/settings"
              aria-label="Settings"
              className={({ isActive }) =>
                cx("grid h-11 w-11 shrink-0 place-items-center rounded-[3px] active:bg-ink-3", isActive ? "text-paper" : "text-paper-dim")
              }
            >
              <GearIcon size={22} />
            </NavLink>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[640px]" style={{ paddingBottom: "calc(var(--shell-bottom) + 8px)" }}>
          {children}
        </main>

        <div className="pointer-events-none fixed inset-x-0 z-30" style={{ bottom: `calc(${tabSpace} + 8px)` }}>
          <div ref={dockWrap} className="mx-auto flex max-w-[640px] flex-col gap-2 px-3 [&>*]:pointer-events-auto">
            {dock}
            <div ref={setDockEl} className="contents" />
          </div>
        </div>

        <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-ink pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto flex max-w-[640px]" style={{ height: TAB_BAR_HEIGHT }}>
            {TABS.map(({ to, label, Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cx(
                    "gym-tab relative flex flex-1 flex-col items-center justify-center gap-1 text-[10.5px] uppercase tracking-[0.14em] transition-colors duration-100 motion-reduce:transition-none",
                    isActive ? "text-paper" : "text-paper-faint active:text-paper-dim",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span aria-hidden className={cx("absolute inset-x-6 top-0 h-[2px]", isActive ? "bg-paper" : "bg-transparent")} />
                    <Icon size={22} />
                    <span>{label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>
      </div>
    </SlotsContext.Provider>
  );
}

/** Standard screen padding and rhythm. Optional: screens may lay themselves out. */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("flex flex-col gap-4 px-4 pt-4", className)}>{children}</div>;
}
