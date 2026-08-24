/**
 * One-time client cache purge. Bump CLIENT_CACHE_PURGE_VERSION to force
 * another wipe of SW / Cache Storage / jbt* local+session keys.
 */
export const CLIENT_CACHE_PURGE_VERSION = "2026-08-24-v16-square-pwa-icon";
export const CLIENT_CACHE_PURGE_FLAG = "jbt.client-cache-purge";

const STORAGE_PREFIXES = ["jbt.", "jbt:", "jbt-"];

let purgeInFlight: Promise<boolean> | null = null;

function shouldClearKey(key: string): boolean {
  if (key === CLIENT_CACHE_PURGE_FLAG) return false;
  return STORAGE_PREFIXES.some((p) => key.startsWith(p));
}

function clearMatchingStorage(store: Storage): number {
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key && shouldClearKey(key)) keys.push(key);
  }
  for (const key of keys) store.removeItem(key);
  return keys.length;
}

async function clearIndexedDb(): Promise<number> {
  if (typeof indexedDB === "undefined") return 0;
  const anyIdb = indexedDB as IDBFactory & {
    databases?: () => Promise<Array<{ name?: string }>>;
  };
  if (typeof anyIdb.databases !== "function") return 0;
  try {
    const dbs = await anyIdb.databases();
    const targets = dbs
      .map((d) => d.name)
      .filter((name): name is string => Boolean(name) && shouldClearKey(name));
    await Promise.all(
      targets.map(
        (name) =>
          new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(name);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
            req.onblocked = () => resolve();
          }),
      ),
    );
    return targets.length;
  } catch {
    return 0;
  }
}

/** Clears service workers, Cache Storage, and app local/session keys. */
export async function purgeClientCaches(): Promise<{
  localKeys: number;
  sessionKeys: number;
  caches: number;
  serviceWorkers: number;
  indexedDbs: number;
}> {
  let localKeys = 0;
  let sessionKeys = 0;
  let cacheCount = 0;
  let swCount = 0;

  try {
    localKeys = clearMatchingStorage(localStorage);
  } catch {
    /* ignore */
  }
  try {
    sessionKeys = clearMatchingStorage(sessionStorage);
  } catch {
    /* ignore */
  }

  if (typeof caches !== "undefined") {
    try {
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
      cacheCount = names.length;
    } catch {
      /* ignore */
    }
  }

  if ("serviceWorker" in navigator) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
      swCount = regs.length;
    } catch {
      /* ignore */
    }
  }

  const indexedDbs = await clearIndexedDb();

  return {
    localKeys,
    sessionKeys,
    caches: cacheCount,
    serviceWorkers: swCount,
    indexedDbs,
  };
}

/** Runs purge once per CLIENT_CACHE_PURGE_VERSION, then marks the flag. */
export async function purgeClientCachesOnce(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  if (purgeInFlight) return purgeInFlight;

  purgeInFlight = (async () => {
    try {
      if (localStorage.getItem(CLIENT_CACHE_PURGE_FLAG) === CLIENT_CACHE_PURGE_VERSION) {
        return false;
      }
    } catch {
      /* if storage blocked, still attempt purge */
    }

    await purgeClientCaches();

    try {
      localStorage.setItem(CLIENT_CACHE_PURGE_FLAG, CLIENT_CACHE_PURGE_VERSION);
    } catch {
      /* ignore */
    }
    return true;
  })().finally(() => {
    purgeInFlight = null;
  });

  return purgeInFlight;
}
