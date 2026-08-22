"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ConfirmModal, Modal } from "@/components/common/Modal";
import { useToast } from "@/components/common/ToastProvider";
import { useAuth } from "@/components/auth/AuthProvider";
import { DocumentEditor } from "@/components/documents/DocumentEditor";
import { DocumentPreview } from "@/components/documents/DocumentPreview";
import { DocumentSavedList } from "@/components/documents/DocumentSavedList";
import { ExportActions } from "@/components/export/ExportActions";
import {
  ToolUsageCounter,
  UsageLimitBanner,
} from "@/components/subscription/UsageLimitBanner";
import {
  DOCUMENT_CONFIGS,
  type DocumentToolId,
  type ToolDefinition,
} from "@/config/tools.config";
import { usePlatformConfig } from "@/components/config/ConfigProvider";
import { mergeDocumentConfig } from "@/lib/merge-tool-config";
import { useUsageLimit } from "@/hooks/useUsageLimit";
import { useCanWrite } from "@/hooks/useCanWrite";
import { useDocumentMutations } from "@/hooks/useDocumentMutations";
import { useSubscription } from "@/hooks/useSubscription";
import {
  ApiError,
  fetchDocument,
  fetchDocumentList,
  fetchNextDocNumber,
  fetchProfile,
} from "@/lib/api";
import {
  trackLimitBlocked,
  trackPrint,
  trackRecordCreate,
  trackRecordUpdate,
} from "@/lib/analytics";
import {
  blankDocumentState,
  documentFilename,
  docMissingFields,
  newDocumentClientId,
  parseDocumentFromApi,
} from "@/lib/document-math";
import { EMPTY_PROFILE, type BusinessProfile } from "@/lib/types/business-profile";
import type { DocumentListItem, DocumentState } from "@/lib/types/document";

type Props = { tool: ToolDefinition };

export function DocumentTool({ tool }: Props) {
  const { getToolDefinition } = usePlatformConfig();
  const { user } = useAuth();
  const baseConfig = DOCUMENT_CONFIGS[tool.id as DocumentToolId];
  const config = mergeDocumentConfig(baseConfig, getToolDefinition(tool.id));
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const { openUpgrade } = useSubscription();
  const canWrite = useCanWrite();
  const { usage, atLimit, nearLimit, canCreate, refresh: refreshUsage } = useUsageLimit(
    tool.id,
    tool.subscriptionExempt,
  );
  const { save: saveDocument, remove: removeDocument } = useDocumentMutations(tool.id);

  const viewList = searchParams.get("view") === "list";
  const editId = searchParams.get("id");

  const [profile, setProfile] = useState<BusinessProfile>(EMPTY_PROFILE);
  const [state, setState] = useState<DocumentState | null>(null);
  const [listItems, setListItems] = useState<DocumentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [missingOpen, setMissingOpen] = useState(false);
  const [missingLines, setMissingLines] = useState<string[]>([]);
  const [resetOpen, setResetOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const toolPath = `/tools/${tool.id}`;

  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      const items = await fetchDocumentList(tool.id);
      setListItems(items);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load list");
    } finally {
      setListLoading(false);
    }
  }, [tool.id, showToast]);

  const initNewDocument = useCallback(async () => {
    setLoading(true);
    try {
      const [prof, seq] = await Promise.all([
        fetchProfile(),
        fetchNextDocNumber(tool.id),
      ]);
      setProfile(prof);
      setState(blankDocumentState(seq.docNo));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to start new document");
    } finally {
      setLoading(false);
    }
  }, [tool.id, showToast]);

  const loadExisting = useCallback(
    async (id: string) => {
      setLoading(true);
      try {
        const [prof, doc] = await Promise.all([fetchProfile(), fetchDocument(tool.id, id)]);
        setProfile(prof);
        setState(parseDocumentFromApi(doc as Record<string, unknown>));
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Failed to load document");
        router.replace(toolPath);
      } finally {
        setLoading(false);
      }
    },
    [tool.id, toolPath, router, showToast],
  );

  useEffect(() => {
    if (viewList) {
      setLoading(false);
      loadList();
      return;
    }
    if (editId) {
      loadExisting(editId);
      return;
    }
    initNewDocument();
  }, [viewList, editId, loadList, loadExisting, initNewDocument, user?.businessProfileId]);

  function goList() {
    router.push(`${toolPath}?view=list`);
  }

  function goEditor(id?: string) {
    router.push(id ? `${toolPath}?id=${id}` : toolPath);
  }

  async function handleSave() {
    if (!state || !config) return;
    const missing = docMissingFields(state, profile, config);
    if (missing.length) {
      setMissingLines(missing);
      setMissingOpen(true);
      return;
    }

    const isNew = !state.id;
    if (isNew && !canCreate) {
      openUpgrade(tool.id);
      return;
    }

    const payload: DocumentState = {
      ...state,
      id: state.id ?? newDocumentClientId(tool.id),
      status: "saved",
    };

    setSaving(true);
    try {
      const recordId = payload.id!;
      const result = await saveDocument(
        recordId,
        payload as unknown as Record<string, unknown>,
        isNew,
      );
      setState(parseDocumentFromApi(result));
      if (isNew) {
        trackRecordCreate(tool.id);
        showToast(`✔ ${config.docLabel} saved`);
      } else {
        trackRecordUpdate(tool.id);
        showToast(`✔ ${config.docLabel} updated`);
      }
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

  function handlePrint() {
    if (!state || !config) return;
    const missing = docMissingFields(state, profile, config);
    if (missing.length) {
      setMissingLines(missing);
      setMissingOpen(true);
      return;
    }
    document.title = documentFilename(state);
    trackPrint(tool.id);
    window.print();
  }

  async function handleReset() {
    setResetOpen(false);
    try {
      const seq = await fetchNextDocNumber(tool.id);
      setState(blankDocumentState(seq.docNo));
      if (editId) {
        router.replace(toolPath);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Reset failed");
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await removeDocument(deleteId);
      showToast("Deleted");
      setDeleteId(null);
      await refreshUsage();
      await loadList();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Delete failed");
    }
  }

  if (!config) {
    return <div className="error-banner">Document configuration missing.</div>;
  }

  return (
    <div>
      <div className="tool-header">
        <Link href="/" className="back-btn" aria-label="Back">←</Link>
        <div className="tool-header-text">
          <div className="tool-header-title">{tool.icon} {tool.name}</div>
          <div className="tool-header-sub">{config.subtitle}</div>
        </div>
        <ToolUsageCounter usage={usage} />
        {viewList && listItems.length > 0 ? (
          <ExportActions
            toolId={tool.id}
            rows={[]}
            documentHeaders={["id", "docNo", "partyName", "docDate", "grandTotal", "status"]}
            documentRows={listItems.map((d) => ({
              id: d.id,
              docNo: d.docNo,
              partyName: d.partyName,
              docDate: d.docDate,
              grandTotal: d.grandTotal,
              status: d.status,
            }))}
          />
        ) : null}
        {viewList ? (
          canWrite ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => goEditor()}>
              + New
            </button>
          ) : null
        ) : (
          <button type="button" className="btn btn-secondary btn-sm" onClick={goList}>
            📁 Saved
          </button>
        )}
      </div>

      <UsageLimitBanner usage={usage} atLimit={atLimit} nearLimit={nearLimit} />

      {viewList ? (
        <DocumentSavedList
          config={config}
          items={listItems}
          loading={listLoading}
          onOpen={(id) => goEditor(id)}
          onDelete={(id) => setDeleteId(id)}
          onNew={() => goEditor()}
          readOnly={!canWrite}
        />
      ) : loading || !state ? (
        <div className="empty-state">
          <div className="es-icon">⏳</div>
          <div className="es-title">Loading…</div>
        </div>
      ) : (
        <div className="preview-workspace">
          <div className="preview-editor">
            <DocumentEditor config={config} state={state} onChange={setState} />
          </div>
          <aside className="preview-pane" aria-label="Live document preview">
            <div className="preview-pane-toolbar">
              <div>
                <span className="preview-pane-title">Live preview</span>
                <span className="preview-pane-sub">Updates as you edit</span>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={handlePrint}>
                Print / PDF
              </button>
            </div>
            <div className="preview-pane-scroll">
              <DocumentPreview config={config} state={state} profile={profile} />
            </div>
            <div className="preview-pane-actions no-print">
              {canWrite ? (
                <>
                  <button
                    type="button"
                    className="btn btn-primary btn-block"
                    onClick={handleSave}
                    disabled={saving}
                  >
                    💾 Save {config.docLabel}
                  </button>
                  <div className="btn-row mt-10">
                    <button
                      type="button"
                      className="btn btn-secondary flex-1"
                      onClick={() => setResetOpen(true)}
                    >
                      ↺ New / Reset
                    </button>
                  </div>
                </>
              ) : (
                <p className="muted">Read-only access — you can view and print but not save changes.</p>
              )}
            </div>
          </aside>
        </div>
      )}

      <Modal
        open={missingOpen}
        title="A few things are missing:"
        onClose={() => setMissingOpen(false)}
        footer={
          <div className="modal-btns">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setMissingOpen(false)}
            >
              OK
            </button>
          </div>
        }
      >
        <ul className="modal-lines">
          {missingLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Modal>

      <ConfirmModal
        open={resetOpen}
        title={`Start a new ${config.docLabel.toLowerCase()}?`}
        message="Unsaved changes will be lost."
        confirmText="Start New"
        cancelText="Cancel"
        onConfirm={handleReset}
        onClose={() => setResetOpen(false)}
      />

      <ConfirmModal
        open={Boolean(deleteId)}
        title="Delete this document?"
        message="This cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        danger
        onConfirm={handleDelete}
        onClose={() => setDeleteId(null)}
      />
    </div>
  );
}
