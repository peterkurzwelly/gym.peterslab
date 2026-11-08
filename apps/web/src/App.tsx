import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { TodayScreen } from "./screens/Today";

// Today is eager (cold open to first set in ≤ 5 s). The rest load on demand.
const PlanScreen = lazy(() => import("./screens/Plan").then((m) => ({ default: m.PlanScreen })));
const ProgressScreen = lazy(() => import("./screens/Progress").then((m) => ({ default: m.ProgressScreen })));
const SettingsScreen = lazy(() => import("./screens/Settings").then((m) => ({ default: m.SettingsScreen })));
const SummaryScreen = lazy(() => import("./screens/Summary").then((m) => ({ default: m.SummaryScreen })));
const KitScreen = lazy(() => import("./screens/Kit").then((m) => ({ default: m.KitScreen })));

export function App() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<TodayScreen />} />
          <Route path="/plan" element={<PlanScreen />} />
          <Route path="/progress" element={<ProgressScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="/summary/:sessionId" element={<SummaryScreen />} />
          <Route path="/dev/kit" element={<KitScreen />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
