"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createToolRecord,
  deleteToolRecord,
  fetchToolRecords,
  updateToolRecord,
} from "@/lib/api";
import type { ToolRecord, TrackerRow } from "@/lib/types/tool-record";
import { flattenRecord } from "@/lib/types/tool-record";
import { enqueueOfflineMutation } from "@/lib/offline/queue-store";
import { isNetworkError } from "@/lib/offline/sync-engine";
import { OFFLINE_SYNCED_EVENT } from "@/lib/offline/types";

function newOfflineId(toolId: string): string {
  return `${toolId}_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
}

export function useToolRecords(toolId: string) {
  const [records, setRecords] = useState<ToolRecord[]>([]);
  const [rows, setRows] = useState<TrackerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [queuedCount, setQueuedCount] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const list = await fetchToolRecords(toolId);
      setRecords(list);
      setRows(list.map(flattenRecord));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load records");
    } finally {
      setLoading(false);
    }
  }, [toolId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onSynced = () => refresh();
    window.addEventListener(OFFLINE_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(OFFLINE_SYNCED_EVENT, onSynced);
  }, [refresh]);

  const create = async (data: Record<string, unknown>, id?: string) => {
    const recordId = id ?? newOfflineId(toolId);
    try {
      const record = await createToolRecord(toolId, data, recordId);
      await refresh();
      return record;
    } catch (err) {
      if (isNetworkError(err)) {
        enqueueOfflineMutation({
          id: `offline_${recordId}`,
          kind: "tracker.create",
          toolId,
          recordId,
          payload: data,
        });
        setQueuedCount((n) => n + 1);
        throw new Error("Saved offline — will sync when connection returns");
      }
      throw err;
    }
  };

  const update = async (recordId: string, data: Record<string, unknown>) => {
    try {
      const record = await updateToolRecord(toolId, recordId, data);
      await refresh();
      return record;
    } catch (err) {
      if (isNetworkError(err)) {
        enqueueOfflineMutation({
          id: `offline_up_${recordId}_${Date.now()}`,
          kind: "tracker.update",
          toolId,
          recordId,
          payload: data,
        });
        setQueuedCount((n) => n + 1);
        throw new Error("Update queued offline — will sync when connection returns");
      }
      throw err;
    }
  };

  const remove = async (recordId: string) => {
    try {
      await deleteToolRecord(toolId, recordId);
      await refresh();
    } catch (err) {
      if (isNetworkError(err)) {
        enqueueOfflineMutation({
          id: `offline_del_${recordId}_${Date.now()}`,
          kind: "tracker.delete",
          toolId,
          recordId,
          payload: {},
        });
        setQueuedCount((n) => n + 1);
        throw new Error("Delete queued offline — will sync when connection returns");
      }
      throw err;
    }
  };

  return { records, rows, loading, error, queuedCount, refresh, create, update, remove };
}
