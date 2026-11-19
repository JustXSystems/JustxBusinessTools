"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import type { ToolsSaveHandle } from "@/components/admin/tools-actions";
import { usePlatformConfig } from "@/components/config/ConfigProvider";
import { api } from "@/lib/api";
import { supportsStandaloneApp } from "@/lib/tool-launch";

function clampWidthPct(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 90;
  return Math.min(100, Math.max(50, Math.round(n)));
}

export const ToolPlacementPane = forwardRef<
  ToolsSaveHandle,
  {
    toolId: string;
    groupName: string;
    available: boolean;
    openStandalone: boolean;
    businessProfileId: number | null;
    onGroupName: (v: string) => void;
    onAvailable: (v: boolean) => void;
    onOpenStandalone: (v: boolean) => void;
    onSaved: (msg: string) => void;
  }
>(function ToolPlacementPane(
  {
    toolId,
    groupName,
    available,
    openStandalone,
    businessProfileId,
    onGroupName,
    onAvailable,
    onOpenStandalone,
    onSaved,
  },
  ref,
) {
  const { refresh: refreshConfig } = usePlatformConfig();
  const [busy, setBusy] = useState(false);
  const [contentWidthPct, setContentWidthPct] = useState(90);
  const canStandalone = supportsStandaloneApp(toolId);
  const isIms = toolId === "imsdealer";

  useEffect(() => {
    if (!isIms) return;
    let cancelled = false;
    void api<{ imsLayout: { contentWidthPct: number } }>("/admin/config/ims-layout")
      .then((layout) => {
        if (!cancelled) setContentWidthPct(clampWidthPct(layout.imsLayout?.contentWidthPct));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isIms]);

  async function save() {
    if (businessProfileId == null) {
      onSaved("Select a Business Profile before saving org placement");
      throw new Error("Business Profile required");
    }
    setBusy(true);
    try {
      const width = clampWidthPct(contentWidthPct);
      await api(`/admin/catalog/${toolId}`, {
        method: "PUT",
        body: JSON.stringify({
          businessProfileId,
          groupName,
          available,
          ...(canStandalone ? { openStandalone } : {}),
        }),
      });
      if (isIms) {
        const layout = await api<{ imsLayout: { contentWidthPct: number } }>("/admin/config/ims-layout", {
          method: "PUT",
          body: JSON.stringify({ contentWidthPct: width }),
        });
        setContentWidthPct(clampWidthPct(layout.imsLayout.contentWidthPct));
        await refreshConfig().catch(() => undefined);
      }
      onSaved(
        canStandalone
          ? isIms
            ? `Placement saved · IMS content width ${width}%. Module ceilings live on Access Fabric.`
            : "Placement saved. Standalone apps open without the Justxsystems menu; refresh home to see the change."
          : "Placement saved. Live tools are added to branch home lists; refresh home to see them.",
      );
    } catch (err) {
      onSaved(err instanceof Error ? err.message : "Save failed");
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function hide() {
    if (businessProfileId == null) {
      onSaved("Select a Business Profile before changing org placement");
      return;
    }
    setBusy(true);
    try {
      await api(`/admin/catalog/${toolId}?businessProfileId=${businessProfileId}`, {
        method: "DELETE",
      });
      onSaved("Tool hidden from the operator home catalog.");
    } catch (err) {
      onSaved(err instanceof Error ? err.message : "Hide failed");
    } finally {
      setBusy(false);
    }
  }

  useImperativeHandle(
    ref,
    () => ({
      save,
      isBusy: () => busy,
      label: () => "Save placement",
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- latest props closed over on each render
    [busy, toolId, groupName, available, openStandalone, canStandalone, businessProfileId, contentWidthPct, isIms],
  );

  return (
    <section className="panel admin-card tm-pane">
      <h2>Placement</h2>
      <p className="muted">
        Org catalog visibility on the operator home screen for the Business Profile selected above.
        Setting Live also adds the tool to that org&apos;s branch home allowlists (when fixed).
        {!businessProfileId ? " Select a Business Profile to edit Live/Hidden." : ""}
        {isIms
          ? " Per-profile IMS left-nav modules are managed on Access Fabric → Tool capabilities."
          : ""}
      </p>
      <div className="admin-form-grid">
        <label className="field">
          <span>Home group</span>
          <input value={groupName} onChange={(e) => onGroupName(e.target.value)} />
        </label>
        <label className="field">
          <span>Visible on home</span>
          <select value={available ? "1" : "0"} onChange={(e) => onAvailable(e.target.value === "1")}>
            <option value="1">Live</option>
            <option value="0">Hidden</option>
          </select>
        </label>
        {canStandalone ? (
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span>Open as</span>
            <select
              value={openStandalone ? "standalone" : "embedded"}
              onChange={(e) => onOpenStandalone(e.target.value === "standalone")}
            >
              <option value="standalone">Standalone app in a new window (no Justxsystems menu)</option>
              <option value="embedded">Inside Justxsystems Business Tools</option>
            </select>
            <span className="muted small" style={{ display: "block", marginTop: 6 }}>
              Standalone opens {toolId === "imsdealer" ? "/ims" : "/bos"} in its own window with its own chrome —
              the Justxsystems sidebar and header stay on the home tab.
            </span>
          </label>
        ) : null}
        {isIms ? (
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span>Full-screen content width ({contentWidthPct}% of window)</span>
            <input
              type="range"
              min={50}
              max={100}
              step={1}
              value={contentWidthPct}
              disabled={busy}
              onChange={(e) => setContentWidthPct(clampWidthPct(e.target.value))}
              aria-label="IMS full-screen content width percent"
            />
            <span className="muted small" style={{ display: "block", marginTop: 6 }}>
              Org-wide chrome for `/ims` (not per profile). Default 90%.
            </span>
          </label>
        ) : null}
      </div>
      <div className="admin-form-row">
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void hide()}>
          Hide from home
        </button>
      </div>
    </section>
  );
});
