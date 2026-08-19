import {
  createDocument,
  createToolRecord,
  deleteDocument,
  deleteToolRecord,
  updateDocument,
  updateToolRecord,
} from "@/lib/api";
import {
  listOfflineMutations,
  markOfflineMutationFailed,
  removeOfflineMutation,
} from "./queue-store";
import type { OfflineMutation } from "./types";

const MAX_RETRIES = 5;

let activeFlush: Promise<SyncResult> | null = null;

async function executeMutation(mutation: OfflineMutation): Promise<void> {
  switch (mutation.kind) {
    case "tracker.create": {
      const recordId = mutation.recordId ?? String(mutation.payload.id ?? "");
      await createToolRecord(mutation.toolId, mutation.payload, recordId || undefined);
      break;
    }
    case "tracker.update":
      if (!mutation.recordId) throw new Error("Missing recordId");
      await updateToolRecord(mutation.toolId, mutation.recordId, mutation.payload);
      break;
    case "tracker.delete":
      if (!mutation.recordId) throw new Error("Missing recordId");
      await deleteToolRecord(mutation.toolId, mutation.recordId);
      break;
    case "document.create":
      await createDocument(mutation.toolId, mutation.payload);
      break;
    case "document.update":
      if (!mutation.recordId) throw new Error("Missing recordId");
      await updateDocument(mutation.toolId, mutation.recordId, mutation.payload);
      break;
    case "document.delete":
      if (!mutation.recordId) throw new Error("Missing recordId");
      await deleteDocument(mutation.toolId, mutation.recordId);
      break;
    default:
      throw new Error(`Unsupported mutation: ${mutation.kind}`);
  }
}

export type SyncResult = {
  processed: number;
  failed: number;
  remaining: number;
};

async function runFlush(): Promise<SyncResult> {
  const pending = listOfflineMutations();
  let processed = 0;
  let failed = 0;

  for (const mutation of pending) {
    if (mutation.retries >= MAX_RETRIES) {
      failed += 1;
      continue;
    }
    try {
      await executeMutation(mutation);
      removeOfflineMutation(mutation.id);
      processed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sync failed";
      markOfflineMutationFailed(mutation.id, message);
      failed += 1;
    }
  }

  return {
    processed,
    failed,
    remaining: listOfflineMutations().length,
  };
}

/** Flush queued mutations when online. Server enforces limits — no client bypass. */
export async function flushOfflineQueue(): Promise<SyncResult> {
  if (activeFlush) {
    return activeFlush;
  }

  activeFlush = runFlush().finally(() => {
    activeFlush = null;
  });

  return activeFlush;
}

export function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError && err.message.includes("fetch")) return true;
  if (err instanceof Error && /network|failed to fetch|load failed/i.test(err.message)) {
    return true;
  }
  return false;
}
