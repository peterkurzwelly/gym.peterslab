/**
 * App frame: a slim header (title slot, sync slot), content, a dock for floating bars, and the tab bar.
 * Focus routes (a running workout, cardio) hide the header and the tab bar and bring their own top bar.
 *
 * Screens fill the slots from anywhere below the shell with portals:
 *   <ShellTitle>Program</ShellTitle>   <ShellSync><SyncDot status="idle" /></ShellSync>
 *   <ShellDock><RestTimer … /><Button … /></ShellDock>
 * The `title`, `sync` and `dock` props do the same for callers that render the shell directly.
 */
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { NavLink, useLocation } from "react-router-dom";
import { cx } from "../lib/cx";
import { installAudioUnlock } from "../lib/sound";
import { BoltIcon, DumbbellIcon, ProgressIcon, UserIcon } from "./Icons";

/** Tab bar height without the safe area. */
export const TAB_BAR_HEIGHT = 58;

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
/** Float bars (rest timer, log button) above the tab bar. Content scrolls clear of them. */
export const ShellDock = ({ children }: { children: ReactNode }) => <SlotPortal name="dock">{children}</SlotPortal>;

export interface AppShellProps {
  children: ReactNode;
  title?: ReactNode;
  sync?: ReactNode;
  dock?: ReactNode;
}

const TABS = [
  { to: "/", label: "Today", Icon: BoltIcon, end: true },
  { to: "/program", label: "Program", Icon: DumbbellIcon, end: false },
  { to: "/progress", label: "Progress", Icon: ProgressIcon, end: false },
  { to: "/settings", label: "You", Icon: UserIcon, end: false },
] as const;

/** Routes that take the whole screen: no header, no tab bar. */
export function isFocusRoute(pathname: string): boolean {
  return pathname === "/workout" || pathname.startsWith("/workout/") || pathname === "/cardio";
}

export function AppShell({ children, title, sync, dock }: AppShellProps) {
  const [titleEl, setTitleEl] = useState<HTMLElement | null>(null);
  const [syncEl, setSyncEl] = useState<HTMLElement | null>(null);
  const [dockEl, setDockEl] = useState<HTMLElement | null>(null);
  const dockWrap = useRef<HTMLDivElement>(null);
  const [dockHeight, setDockHeight] = useState(0);

  // iOS only plays audio after a gesture: unlock on the first tap anywhere.
  useEffect(() => installAudioUnlock(), []);

  // A tab opens at its top, not at the previous tab's scroll offset.
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo?.(0, 0);
  }, [pathname]);
  const focus = isFocusRoute(pathname);

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
  const tabSpace = focus ? "env(safe-area-inset-bottom)" : `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom))`;
  // Space covered at the bottom by the tab bar and the dock. Used for padding and scroll margins.
  const shellBottom = `calc(${tabSpace} + ${dockHeight}px + 16px)`;

  return (
    <SlotsContext.Provider value={slots}>
      <div className="gym-shell min-h-full bg-night text-fg" style={{ ["--shell-bottom" as string]: shellBottom }}>
        <header className={cx("sticky top-0 z-30 bg-night/85 pt-[env(safe-area-inset-top)] backdrop-blur-xl", focus && "hidden")}>
          <div className="mx-auto flex h-12 max-w-[640px] items-center gap-2 pl-[max(20px,env(safe-area-inset-left))] pr-[max(12px,env(safe-area-inset-right))]">
            <div ref={setTitleEl} className="shell-title min-w-0 flex-1 truncate text-[13px] font-semibold uppercase tracking-[0.08em] text-fg-dim">
              {title ?? (
                <span className="shell-title-default">
                  <span className="text-fg">Workout OS</span>
                </span>
              )}
            </div>
            <div ref={setSyncEl} className="flex shrink-0 items-center">
              {sync}
            </div>
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

        <nav aria-label="Main" className={cx("fixed inset-x-0 bottom-0 z-40 border-t border-line/70 bg-night/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl", focus && "hidden")}>
          <div className="mx-auto flex max-w-[640px]" style={{ height: TAB_BAR_HEIGHT }}>
            {TABS.map(({ to, label, Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cx(
                    "gym-tab flex flex-1 flex-col items-center justify-center gap-[3px] text-[10.5px] font-semibold tracking-[0.02em] transition-colors duration-100 motion-reduce:transition-none",
                    isActive ? "text-volt" : "text-fg-faint active:text-fg-dim",
                  )
                }
              >
                <Icon size={24} strokeWidth={1.75} />
                <span>{label}</span>
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
  return <div className={cx("flex flex-col gap-4 px-4 pt-2", className)}>{children}</div>;
}

/** Big screen title in the display face, with an optional line above it. */
export function PageTitle({ eyebrow, children, right }: { eyebrow?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-end gap-3 px-1 pb-1 pt-1">
      <div className="min-w-0 flex-1">
        {eyebrow && <div className="gym-label mb-1.5">{eyebrow}</div>}
        <h1 className="m-0 font-display text-[44px] uppercase leading-[0.92] text-fg">{children}</h1>
      </div>
      {right}
    </div>
  );
}
