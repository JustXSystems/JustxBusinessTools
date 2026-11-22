"use client";

import { Button, WidgetCard } from "@/components/bos";
import { imsSystem, saveBlob, type AuditDocCategory, type AuditDocument, type AuditEntityType } from "@/lib/ims/system";
import { useImsAction, useImsData } from "../core";

/**
 * Generic attachments card backed by `ims_documents` / `/audit/documents`.
 * Used on invoices and bills (and reusable elsewhere).
 */
export function EntityAttachments({
  entityType,
  entityId,
  entityLabel,
  category,
  canWrite,
  emptyHint,
}: {
  entityType: AuditEntityType;
  entityId: string;
  entityLabel: string;
  category: AuditDocCategory;
  canWrite: boolean;
  emptyHint?: string;
}) {
  const { run, busy } = useImsAction();
  const state = useImsData(() => imsSystem.documents({ entityType, entityId }), [entityType, entityId]);
  const docs = state.data?.documents ?? [];
  const maxBytes = state.data?.maxBytes ?? 2_097_152;

  const onFile = async (file: File | null) => {
    if (!file || !canWrite) return;
    if (file.size > maxBytes) {
      await run("attach", async () => {
        throw new Error(`Files up to ${Math.round(maxBytes / (1024 * 1024))} MB can be attached`);
      });
      return;
    }
    const content = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Could not read the file"));
      reader.readAsDataURL(file);
    });
    await run(
      "attach",
      () =>
        imsSystem.addDocument({
          title: file.name.replace(/\.[^.]+$/, "") || file.name,
          category,
          content,
          fileName: file.name,
          entityType,
          entityId,
          entityLabel,
        }),
      { success: "Attachment added" },
    );
    state.reload();
  };

  return (
    <WidgetCard title="Attachments" note={docs.length ? String(docs.length) : undefined}>
      {docs.length ? (
        <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
          {docs.map((d: AuditDocument) => (
            <div key={d.id} className="ims-row" style={{ justifyContent: "space-between", gap: 8 }}>
              <span className="ims-cell-stack" style={{ minWidth: 0 }}>
                <span className="ims-strong" style={{ fontSize: 13 }}>
                  {d.title}
                </span>
                <small>
                  {d.fileName || d.url || "Link"}
                  {d.sizeBytes ? ` · ${Math.round(d.sizeBytes / 1024)} KB` : ""}
                </small>
              </span>
              <span className="ims-row" style={{ gap: 4, flexShrink: 0 }}>
                {d.hasFile ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === `dl-${d.id}`}
                    onClick={() =>
                      void run(
                        `dl-${d.id}`,
                        async () => {
                          const file = await imsSystem.documentFile(d.id, d.fileName || d.title);
                          saveBlob(file);
                          return file;
                        },
                        { success: "Downloaded", refresh: false },
                      )
                    }
                  >
                    Download
                  </Button>
                ) : d.url ? (
                  <a className="bos-btn bos-btn-ghost bos-btn-sm" href={d.url} target="_blank" rel="noreferrer">
                    Open
                  </a>
                ) : null}
                {canWrite ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === `del-${d.id}`}
                    onClick={() =>
                      void run(`del-${d.id}`, () => imsSystem.deleteDocument(d.id), { success: "Attachment removed" }).then(() => state.reload())
                    }
                  >
                    Remove
                  </Button>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="fin-note" style={{ marginBottom: 8 }}>
          {emptyHint ?? `Supporting files — up to ${Math.round(maxBytes / (1024 * 1024))} MB.`}
        </p>
      )}
      {canWrite ? (
        <label className="bos-btn bos-btn-ghost bos-btn-sm" style={{ cursor: busy === "attach" ? "wait" : "pointer" }}>
          {busy === "attach" ? "Uploading…" : "Add file"}
          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.csv,.txt,.xlsx,.xls,.doc,.docx,.zip,.xml"
            hidden
            disabled={busy === "attach"}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              e.target.value = "";
              void onFile(f);
            }}
          />
        </label>
      ) : null}
    </WidgetCard>
  );
}
