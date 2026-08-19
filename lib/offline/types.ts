export type OfflineMutationKind =
  | "tracker.create"
  | "tracker.update"
  | "tracker.delete"
  | "document.create"
  | "document.update"
  | "document.delete";

export type OfflineMutation = {
  id: string;
  kind: OfflineMutationKind;
  toolId: string;
  recordId?: string;
  payload: Record<string, unknown>;
  createdAt: number;
  retries: number;
  lastError?: string;
};

export const OFFLINE_QUEUE_KEY = "jbt:offline-queue:v1";

/** Dispatched on `window` after queued mutations are flushed successfully. */
export const OFFLINE_SYNCED_EVENT = "jbt:offline-synced";
