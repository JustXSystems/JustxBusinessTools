/** File System Access API helpers + IndexedDB persistence for directory handles. */

const DB_NAME = "jbt-artifact-delivery";
const STORE = "handles";
const HANDLE_KEY = "download-folder";

export type FsaSupport = {
  supported: boolean;
  reason?: string;
};

export function getFsaSupport(): FsaSupport {
  if (typeof window === "undefined") return { supported: false, reason: "ssr" };
  if (!("showDirectoryPicker" in window)) {
    return { supported: false, reason: "Browser does not support File System Access API" };
  }
  return { supported: true };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

export async function saveDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to save folder handle"));
  });
  db.close();
}

export async function loadDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDb();
    const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(HANDLE_KEY);
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) ?? null);
      req.onerror = () => reject(req.error ?? new Error("Failed to load folder handle"));
    });
    db.close();
    return handle;
  } catch {
    return null;
  }
}

export async function clearDirectoryHandle(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Failed to clear folder handle"));
    });
    db.close();
  } catch {
    /* ignore */
  }
}

export async function pickDownloadFolder(): Promise<FileSystemDirectoryHandle> {
  const support = getFsaSupport();
  if (!support.supported) throw new Error(support.reason || "Not supported");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handle = await (window as any).showDirectoryPicker({ mode: "readwrite" });
  await saveDirectoryHandle(handle);
  return handle as FileSystemDirectoryHandle;
}

async function ensurePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const h = handle as any;
  if (typeof h.queryPermission === "function") {
    let state = await h.queryPermission({ mode: "readwrite" });
    if (state === "granted") return true;
    if (typeof h.requestPermission === "function") {
      state = await h.requestPermission({ mode: "readwrite" });
      return state === "granted";
    }
  }
  return true;
}

export async function probeFsaFolder(): Promise<{ ok: boolean; name?: string; error?: string }> {
  const handle = await loadDirectoryHandle();
  if (!handle) return { ok: false, error: "No folder linked in this browser" };
  try {
    const ok = await ensurePermission(handle);
    if (!ok) return { ok: false, error: "Permission denied for linked folder" };
    return { ok: true, name: handle.name };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Folder not accessible" };
  }
}

function conflictName(base: string, attempt: number): string {
  const i = base.lastIndexOf(".");
  if (i <= 0) return `${base} (${attempt})`;
  return `${base.slice(0, i)} (${attempt})${base.slice(i)}`;
}

export async function writeFileViaFsa(input: {
  filename: string;
  bytes: Uint8Array;
  mimeType: string;
  conflictPolicy: "rename" | "skip" | "overwrite";
}): Promise<{ pathLabel: string; skipped?: boolean }> {
  const handle = await loadDirectoryHandle();
  if (!handle) throw new Error("No Download Folder linked in this browser");
  const permitted = await ensurePermission(handle);
  if (!permitted) throw new Error("Permission denied for linked Download Folder");

  let name = input.filename;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dir = handle as any;

  if (input.conflictPolicy === "skip") {
    try {
      await dir.getFileHandle(name);
      return { pathLabel: `${handle.name}/${name}`, skipped: true };
    } catch {
      /* does not exist — continue */
    }
  }

  if (input.conflictPolicy === "rename") {
    for (let n = 0; n < 50; n++) {
      const candidate = n === 0 ? name : conflictName(input.filename, n);
      try {
        await dir.getFileHandle(candidate);
      } catch {
        name = candidate;
        break;
      }
    }
  }

  const fileHandle = await dir.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(input.bytes);
  await writable.close();
  return { pathLabel: `${handle.name}/${name}` };
}
