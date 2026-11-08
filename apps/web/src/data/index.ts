/** Offline-first data layer. UI imports from "../data" only. See README.md in this folder. */
export { db, WorkoutDb, DB_NAME, type OutboxEntry } from "./db";
export { nowIso, setClock, localDateOf } from "./clock";
export {
  ensureSettings,
  updateSettings,
  startSession,
  logSet,
  updateSet,
  deleteSet,
  setPain,
  swapExercise,
  updateSessionNotes,
  finishSession,
  discardSession,
  persistAutoFinished,
  startCardioSession,
  logCardio,
  logWalk,
  updateCardio,
  deleteCardio,
  saveCheckin,
  repairWeek,
  persistDecisions,
  saveCustomExercise,
  deleteCustomExercise,
  type SettingsPatch,
  type StartSessionInput,
  type LogSetInput,
  type SetPatch,
  type FinishResult,
  type LogCardioInput,
  type CheckinInput,
  type CustomExerciseInput,
} from "./repo";
export { getDefaults, loadContext, buildContext, readSnapshot, type DataSnapshot } from "./context";
export {
  useEngine,
  usePlan,
  useSessionSummary,
  useCardioPlan,
  useNow,
  useSettings,
  useSessionLogs,
  useCheckin,
  type EngineResult,
  type PlanResult,
  type SummaryResult,
  type CardioPlanResult,
  type SessionLogs,
} from "./hooks";
export {
  syncClient,
  SyncClient,
  useSyncStatus,
  startSync,
  syncNow,
  setSyncKey,
  getClientId,
  type SyncState,
  type SyncStatus,
  type SyncClientOptions,
} from "./sync";
export { ApiError, type ApiFailure } from "./api";
export {
  exportLocal,
  importLocal,
  readExportFile,
  parseExportFile,
  downloadExport,
  fetchRemoteExport,
  pushRemoteImport,
  ImportError,
  type ImportMode,
  type ImportResult,
} from "./backup";
export { requestPersistentStorage, storageEstimate, type StorageInfo } from "./storage";
export { bootData } from "./boot";
