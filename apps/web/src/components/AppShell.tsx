import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

/** Placeholder shell. The UI kit step replaces this with the real tab bar + header. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <main className="flex-1 pb-24">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 flex justify-around border-t border-line bg-ink pb-[env(safe-area-inset-bottom)]">
        <NavLink to="/" className="p-4">Today</NavLink>
        <NavLink to="/plan" className="p-4">Plan</NavLink>
        <NavLink to="/progress" className="p-4">Progress</NavLink>
      </nav>
    </div>
  );
}
