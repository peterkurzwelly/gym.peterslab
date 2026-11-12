import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { GuideProvider } from "./components/GuideSheet";
import { SyncDot } from "./components/SyncDot";
import { bootData, useEngine, useSettings, useSyncStatus } from "./data";
import { setSoundEnabled } from "./lib/sound";
import { markSessionOpen } from "./lib/updatePolicy";
import { HomeScreen } from "./screens/Home";
import { RestChip, RestWatcher } from "./screens/today/RestAlert";

// Today is eager (cold open to the first tap in a couple of seconds). The rest load on demand.
const WorkoutScreen = lazy(() => import("./screens/Workout").then((m) => ({ default: m.WorkoutScreen })));
const CardioScreen = lazy(() => import("./screens/Cardio").then((m) => ({ default: m.CardioScreen })));
const ProgramScreen = lazy(() => import("./screens/Program").then((m) => ({ default: m.ProgramScreen })));
const ProgressScreen = lazy(() => import("./screens/Progress").then((m) => ({ default: m.ProgressScreen })));
const SettingsScreen = lazy(() => import("./screens/Settings").then((m) => ({ default: m.SettingsScreen })));
const SummaryScreen = lazy(() => import("./screens/Summary").then((m) => ({ default: m.SummaryScreen })));

/** Header sync indicator. Calm: only a missing sync key says anything, and it says it quietly. */
function HeaderSync() {
  const { state } = useSyncStatus();
  const navigate = useNavigate();
  const label = state === "auth_required" ? "Add your sync key" : undefined;
  return <SyncDot status={state} label={label} compact={state === "idle" || state === "syncing"} onClick={() => navigate("/settings")} />;
}

/** Tells the service worker update code that a session is open: no reload onto a new version mid workout. */
function SessionGuard() {
  const { state } = useEngine();
  const activeId = state?.active?.session.id ?? null;
  useEffect(() => markSessionOpen(activeId), [activeId]);
  return null;
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
    <GuideProvider>
      <AppShell
        sync={
          <>
            <RestChip />
            <HeaderSync />
          </>
        }
      >
        <SessionGuard />
        {/* The end of a rest beeps on every screen, not only in the workout player. */}
        <RestWatcher sound={settings?.sound ?? true} />
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<HomeScreen />} />
            <Route path="/workout" element={<WorkoutScreen />} />
            <Route path="/cardio" element={<CardioScreen />} />
            <Route path="/program" element={<ProgramScreen />} />
            <Route path="/plan" element={<Navigate to="/program" replace />} />
            <Route path="/progress" element={<ProgressScreen />} />
            <Route path="/settings" element={<SettingsScreen />} />
            <Route path="/summary/:sessionId" element={<SummaryScreen />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </AppShell>
    </GuideProvider>
  );
}
