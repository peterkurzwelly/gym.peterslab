/** Ask the browser to keep IndexedDB (no eviction under storage pressure) and report usage. */

let persistRequest: Promise<boolean> | null = null;

/** Requests persistent storage once per page load. Resolves false when unsupported or denied. */
export function requestPersistentStorage(): Promise<boolean> {
  persistRequest ??= (async () => {
    try {
      const storage = typeof navigator !== "undefined" ? navigator.storage : undefined;
      if (!storage?.persist) return false;
      if (storage.persisted && (await storage.persisted())) return true;
      return await storage.persist();
    } catch {
      return false;
    }
  })();
  return persistRequest;
}

export interface StorageInfo {
  usage: number | null;
  quota: number | null;
  persisted: boolean | null;
}

/** Bytes used / available and whether storage is persistent. Fields are null when unknown. */
export async function storageEstimate(): Promise<StorageInfo> {
  const storage = typeof navigator !== "undefined" ? navigator.storage : undefined;
  const info: StorageInfo = { usage: null, quota: null, persisted: null };
  try {
    if (storage?.estimate) {
      const est = await storage.estimate();
      info.usage = est.usage ?? null;
      info.quota = est.quota ?? null;
    }
    if (storage?.persisted) info.persisted = await storage.persisted();
  } catch {
    /* unknown */
  }
  return info;
}
