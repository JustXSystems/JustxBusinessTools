"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import type { ToolsSaveHandle } from "@/components/admin/tools-actions";
import { QrGeneratorConfigDesigner } from "@/components/admin/QrGeneratorConfigDesigner";
import { TrackerSchemaDesigner } from "@/components/admin/SchemaDesigner";
import { TRACKER_CONFIGS } from "@/config/tools.config";
import { api } from "@/lib/api";
import { QR_TOOL_ID } from "@/lib/qr-generator/config";
import { Alert, Badge } from "@/components/bos";
import { AdminSection, AdminTabs } from "@/components/admin/ui";
import { TextareaField } from "@/components/admin/ui/AdminFields";
import { validateComputedFormulas, type TrackerFieldMeta } from "@jbt/shared";

type SchemaMode = "visual" | "json";

const MODE_OPTIONS: ReadonlyArray<{ value: SchemaMode; label: string }> = [
  { value: "visual", label: "Visual" },
  { value: "json", label: "JSON" },
];

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
  const isQr = toolId === QR_TOOL_ID;
  const isTracker = !isQr && (toolType === "tracker" || TRACKER_CONFIGS[toolId] != null);
  const hasVisual = isTracker || isQr;
  const [mode, setMode] = useState<SchemaMode>(hasVisual ? "visual" : "json");
  const [jsonText, setJsonText] = useState(() => hydrateJson(toolId, toolType, definition));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    setDirty(false);
    setLocalError("");
    setJsonText(hydrateJson(toolId, toolType, definition));
    setMode(toolId === QR_TOOL_ID || TRACKER_CONFIGS[toolId] != null || toolType === "tracker" ? "visual" : "json");
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
      if (isQr) parsed.type = "utility";
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
    [busy, dirty, jsonText, toolId, isTracker, isQr],
  );

  return (
    <AdminSection
      title={isQr ? "QR generator settings" : "Schema"}
      description={
        isQr
          ? "Brand kit, allowed QR types, company defaults, export formats and features for every operator in this organisation. Publish a revision to roll it out."
          : isTracker
            ? "Field-level layout for this tracker. Publish a revision when the operator form should change."
            : "Calculator and document tools use JSON config (rates, copy). Runtime math stays in product code."
      }
      actions={
        <>
          {dirty ? (
            <Badge auto tone="amber">
              Unsaved
            </Badge>
          ) : null}
          {hasVisual ? (
            <AdminTabs<SchemaMode>
              aria-label="Schema editor mode"
              options={MODE_OPTIONS}
              value={mode}
              onChange={setMode}
            />
          ) : null}
        </>
      }
    >
      <div className="admin-cc-form">
        {isTracker && mode === "visual" ? (
          <TrackerSchemaDesigner toolId={toolId} jsonText={jsonText} onChange={updateJson} />
        ) : null}
        {isQr && mode === "visual" ? <QrGeneratorConfigDesigner jsonText={jsonText} onChange={updateJson} /> : null}
        {mode === "json" || !hasVisual ? (
          <TextareaField
            full
            label="Definition JSON"
            className="admin-cc-json-area"
            rows={16}
            spellCheck={false}
            value={jsonText}
            onChange={(e) => updateJson(e.target.value)}
          />
        ) : null}

        {localError ? (
          <Alert tone="coral" title="Couldn’t publish schema">
            {localError}
          </Alert>
        ) : null}
      </div>
    </AdminSection>
  );
});
