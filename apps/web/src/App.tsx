import { lazy, Suspense, useEffect } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { SyncDot } from "./components/SyncDot";
import { bootData, useSettings, useSyncStatus } from "./data";
import { setSoundEnabled } from "./lib/sound";
import { TodayScreen } from "./screens/Today";

// Today is eager (cold open to first set in ≤ 5 s). The rest load on demand.
const PlanScreen = lazy(() => import("./screens/Plan").then((m) => ({ default: m.PlanScreen })));
const ProgressScreen = lazy(() => import("./screens/Progress").then((m) => ({ default: m.ProgressScreen })));
const SettingsScreen = lazy(() => import("./screens/Settings").then((m) => ({ default: m.SettingsScreen })));
const SummaryScreen = lazy(() => import("./screens/Summary").then((m) => ({ default: m.SummaryScreen })));
const KitScreen = lazy(() => import("./screens/Kit").then((m) => ({ default: m.KitScreen })));

/** Header sync indicator. Calm: only a missing sync key says anything, and it says it quietly. */
function HeaderSync() {
  const { state } = useSyncStatus();
  const navigate = useNavigate();
  const label = state === "auth_required" ? "Add your sync key" : undefined;
  return <SyncDot status={state} label={label} compact={state === "idle" || state === "syncing"} onClick={() => navigate("/settings")} />;
}

export function App() {
  // Data layer: persistent storage, settings row, background sync. Once per app start.
  useEffect(() => bootData(), []);

  // Mirror settings.sound into the beeps (rest timer, interval timer).
  const settings = useSettings();
  useEffect(() => {
    if (settings) setSoundEnabled(settings.sound);
  }, [settings]);

  return (
    <AppShell sync={<HeaderSync />}>
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
