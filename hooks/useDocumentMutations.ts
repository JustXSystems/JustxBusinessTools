"use client";

import { useState } from "react";
import { createDocument, deleteDocument, updateDocument } from "@/lib/api";
import { enqueueOfflineMutation } from "@/lib/offline/queue-store";
import { isNetworkError } from "@/lib/offline/sync-engine";

export function useDocumentMutations(toolId: string) {
  const [queuedCount, setQueuedCount] = useState(0);

  async function save(
    recordId: string,
    payload: Record<string, unknown>,
    isNew: boolean,
  ): Promise<Record<string, unknown>> {
    try {
      if (isNew) {
        return (await createDocument(toolId, payload)) as Record<string, unknown>;
      }
      return (await updateDocument(toolId, recordId, payload)) as Record<string, unknown>;
    } catch (err) {
      if (isNetworkError(err)) {
        enqueueOfflineMutation({
          id: `offline_doc_${isNew ? "create" : "update"}_${recordId}_${Date.now()}`,
          kind: isNew ? "document.create" : "document.update",
          toolId,
          recordId,
          payload,
        });
        setQueuedCount((n) => n + 1);
        throw new Error(
          isNew
            ? "Saved offline — will sync when connection returns"
            : "Update queued offline — will sync when connection returns",
        );
      }
      throw err;
    }
  }

  async function remove(recordId: string): Promise<void> {
    try {
      await deleteDocument(toolId, recordId);
    } catch (err) {
      if (isNetworkError(err)) {
        enqueueOfflineMutation({
          id: `offline_doc_del_${recordId}_${Date.now()}`,
          kind: "document.delete",
          toolId,
          recordId,
          payload: {},
        });
        setQueuedCount((n) => n + 1);
        throw new Error("Delete queued offline — will sync when connection returns");
      }
      throw err;
    }
  }

  return { save, remove, queuedCount };
}
