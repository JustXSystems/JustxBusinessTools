"use client";

import { useMemo, useState } from "react";
import { type ToolDefinition } from "@/config/tools.config";
import { usePlatformConfig } from "@/components/config/ConfigProvider";
import { resolveTrackerConfig } from "@/lib/dynamic-tools";
import { ConfirmModal, Modal } from "@/components/common/Modal";
import { ExportActions } from "@/components/export/ExportActions";
import { useToast } from "@/components/common/ToastProvider";
import { ToolLayout } from "@/components/tools/ToolLayout";
import { ToolRecordForm } from "@/components/tools/ToolRecordForm";
import { ToolRecordTable } from "@/components/tools/ToolRecordTable";
import { useToolRecords } from "@/hooks/useToolRecords";
import { useUsageLimit } from "@/hooks/useUsageLimit";
import { useCanWrite } from "@/hooks/useCanWrite";
import { useSubscription } from "@/hooks/useSubscription";
import { ApiError } from "@/lib/api";
import {
  trackLimitBlocked,
  trackRecordCreate,
  trackRecordDelete,
  trackRecordUpdate,
} from "@/lib/analytics";

type Props = { tool: ToolDefinition };

export function TrackerTool({ tool }: Props) {
  const { getToolDefinition } = usePlatformConfig();
  const config = resolveTrackerConfig(tool.id, getToolDefinition(tool.id));
  const { showToast } = useToast();
  const { openUpgrade } = useSubscription();
  const canWrite = useCanWrite();
  const { rows, loading, error, create, update, remove } = useToolRecords(tool.id);
  const { usage, atLimit, nearLimit, canCreate, refresh: refreshUsage } = useUsageLimit(
    tool.id,
    tool.subscriptionExempt,
  );

  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const editRow = useMemo(
    () => (editId ? rows.find((r) => r.id === editId) : undefined),
    [editId, rows],
  );

  function openAdd() {
    if (!canWrite) return;
    if (!canCreate) {
      openUpgrade(tool.id);
      return;
    }
    setEditId(null);
    setModalOpen(true);
  }

  function openEdit(id: string) {
    setEditId(id);
    setModalOpen(true);
  }

  async function handleSave(data: Record<string, unknown>) {
    setSaving(true);
    try {
      if (editId) {
        await update(editId, data);
        trackRecordUpdate(tool.id);
        showToast("✔ Updated");
      } else {
        await create(data);
        trackRecordCreate(tool.id);
        showToast("✔ Saved");
      }
      setModalOpen(false);
      setEditId(null);
      await refreshUsage();
    } catch (err) {
      if (err instanceof ApiError && err.code === "FREE_LIMIT_REACHED") {
        trackLimitBlocked(tool.id);
        openUpgrade(tool.id);
        await refreshUsage();
      } else {
        showToast(err instanceof Error ? err.message : "Save failed");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await remove(deleteId);
      trackRecordDelete(tool.id);
      showToast("Deleted");
      await refreshUsage();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Delete failed");
    }
    setDeleteId(null);
  }

  if (!config) {
    return <div className="error-banner">Tracker configuration missing.</div>;
  }

  return (
    <ToolLayout
      tool={tool}
      usage={usage}
      atLimit={atLimit}
      nearLimit={nearLimit}
      canCreate={canCreate && canWrite}
      onAdd={canWrite ? openAdd : undefined}
      addLabel={config.addLabel}
      headerActions={
        <ExportActions toolId={tool.id} config={config} rows={rows} />
      }
    >
      {error ? <div className="error-banner">{error}</div> : null}

      {loading ? (
        <div className="empty-state">
          <div className="es-icon">⏳</div>
          <div className="es-title">Loading…</div>
        </div>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <div className="es-icon">{config.icon}</div>
          <div className="es-title">Nothing here yet</div>
          <div className="es-sub">Click &quot;{config.addLabel}&quot; to add your first entry.</div>
        </div>
      ) : (
        <ToolRecordTable
          config={config}
          rows={rows}
          onEdit={openEdit}
          onDelete={(id) => setDeleteId(id)}
          readOnly={!canWrite}
        />
      )}

      <Modal
        open={modalOpen}
        title={`${editId ? "Edit" : "Add"} — ${config.title}`}
        onClose={() => {
          if (!saving) {
            setModalOpen(false);
            setEditId(null);
          }
        }}
      >
        <ToolRecordForm
          key={editId ?? "new"}
          config={config}
          initial={editRow}
          onSubmit={handleSave}
          onCancel={() => {
            setModalOpen(false);
            setEditId(null);
          }}
          saving={saving}
        />
      </Modal>

      <ConfirmModal
        open={Boolean(deleteId)}
        title="Delete this entry?"
        message="This cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        danger
        onConfirm={handleDelete}
        onClose={() => setDeleteId(null)}
      />
    </ToolLayout>
  );
}
