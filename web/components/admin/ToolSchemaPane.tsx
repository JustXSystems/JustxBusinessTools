"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import type { ToolsSaveHandle } from "@/components/admin/tools-actions";
import { TrackerSchemaDesigner } from "@/components/admin/SchemaDesigner";
import { TRACKER_CONFIGS } from "@/config/tools.config";
import { api } from "@/lib/api";
import { validateComputedFormulas, type TrackerFieldMeta } from "@jbt/shared";

function hydrateJson(
  toolId: string,
  toolType: string,
  definition: Record<string, unknown> | null,
): string {
  const base = TRACKER_CONFIGS[toolId];
  const src = { ...(definition ?? {}) };
  const type = String(src.type ?? (base ? "tracker" : toolType || "utility"));
  const merged: Record<string, unknown> = { ...src, type, key: toolId };
  if (base) {
    const fields = merged.fields;
    if (!Array.isArray(fields) || fields.length === 0) {
      merged.fields = base.fields;
    }
    merged.title = merged.title ?? base.title;
    merged.subtitle = merged.subtitle ?? base.subtitle;
    merged.addLabel = merged.addLabel ?? base.addLabel;
    merged.titleField = merged.titleField ?? base.titleField;
    if (!Array.isArray(merged.subtitleFields)) merged.subtitleFields = base.subtitleFields;
    if (merged.statusField === undefined) merged.statusField = base.statusField;
  }
  return JSON.stringify(merged, null, 2);
}

export const ToolSchemaPane = forwardRef<
  ToolsSaveHandle,
  {
    toolId: string;
    toolType: string;
    definition: Record<string, unknown> | null;
    onPublished: (msg: string) => void;
  }
>(function ToolSchemaPane({ toolId, toolType, definition, onPublished }, ref) {
  const isTracker = toolType === "tracker" || TRACKER_CONFIGS[toolId] != null;
  const [mode, setMode] = useState<"visual" | "json">(isTracker ? "visual" : "json");
  const [jsonText, setJsonText] = useState(() => hydrateJson(toolId, toolType, definition));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    setDirty(false);
    setLocalError("");
    setJsonText(hydrateJson(toolId, toolType, definition));
    setMode(TRACKER_CONFIGS[toolId] != null || toolType === "tracker" ? "visual" : "json");
  }, [toolId]);

  useEffect(() => {
    if (dirty) return;
    setJsonText(hydrateJson(toolId, toolType, definition));
  }, [definition, toolId, toolType, dirty]);

  function updateJson(next: string) {
    setDirty(true);
    setJsonText(next);
  }

  async function publish() {
    setBusy(true);
    setLocalError("");
    try {
      const parsed = JSON.parse(jsonText) as Record<string, unknown>;
      if ((parsed.type === "tracker" || isTracker) && Array.isArray(parsed.fields) === false) {
        throw new Error("Tracker schema must include a fields array");
      }
      if (Array.isArray(parsed.fields)) {
        const formulaErrors = validateComputedFormulas(parsed.fields as TrackerFieldMeta[]);
        if (formulaErrors.length) throw new Error(formulaErrors.join("; "));
      }
      await api(`/admin/config/tools/${toolId}`, {
        method: "POST",
        body: JSON.stringify({ definition: parsed }),
      });
      setDirty(false);
      onPublished("Schema revision published. Operator picks this up on the next config refresh.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Publish failed";
      setLocalError(msg);
      onPublished(msg);
      throw err;
    } finally {
      setBusy(false);
    }
  }

  useImperativeHandle(
    ref,
    () => ({
      save: publish,
      isBusy: () => busy,
      isDirty: () => dirty,
      label: () => "Publish revision",
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, dirty, jsonText, toolId, isTracker],
  );

  return (
    <section className="panel admin-card tm-pane tm-schema-pane">
      <div className="analytics-toolbar tm-pane-toolbar">
        <div>
          <h2>Schema</h2>
          <p className="muted">
            {isTracker
              ? "Field-level layout for this tracker. Publish a revision when the operator form should change."
              : "Calculator and document tools use JSON config (rates, copy). Runtime math stays in product code."}
          </p>
        </div>
        <div className="admin-form-row">
          {dirty ? <span className="pill pill-warning">Unsaved</span> : null}
          {isTracker ? (
            <div className="admin-tabs">
              <button type="button" className={mode === "visual" ? "active" : ""} onClick={() => setMode("visual")}>
                Visual
              </button>
              <button type="button" className={mode === "json" ? "active" : ""} onClick={() => setMode("json")}>
                JSON
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="tm-pane-body">
        {isTracker && mode === "visual" ? (
          <TrackerSchemaDesigner toolId={toolId} jsonText={jsonText} onChange={updateJson} />
        ) : null}
        {mode === "json" || !isTracker ? (
          <label className="field">
            <span>Definition JSON</span>
            <textarea rows={16} value={jsonText} onChange={(e) => updateJson(e.target.value)} />
          </label>
        ) : null}
      </div>

      {localError ? (
        <div className="tm-pane-footer">
          <p className="field-error">{localError}</p>
        </div>
      ) : null}
    </section>
  );
});
