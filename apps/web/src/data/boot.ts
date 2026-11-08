/** One call at app start: persistent storage, settings row, background sync. */
import { ensureSettings } from "./repo";
import { requestPersistentStorage } from "./storage";
import { syncClient } from "./sync";

/** Starts the data layer. Returns a stop function (sync listeners and timers). Safe to call twice. */
export function bootData(): () => void {
  void requestPersistentStorage();
  void ensureSettings().catch((e) => console.warn("[data] could not create settings", e));
  return syncClient.start();
}
