"use client";

import { forwardRef, useImperativeHandle, useState } from "react";
import type { ToolsSaveHandle } from "@/components/admin/tools-actions";
import { api } from "@/lib/api";
import { supportsStandaloneApp } from "@/lib/tool-launch";

export const ToolPlacementPane = forwardRef<
  ToolsSaveHandle,
  {
    toolId: string;
    groupName: string;
    available: boolean;
    openStandalone: boolean;
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
    onGroupName,
    onAvailable,
    onOpenStandalone,
    onSaved,
  },
  ref,
) {
  const [busy, setBusy] = useState(false);
  const canStandalone = supportsStandaloneApp(toolId);

  async function save() {
    setBusy(true);
    try {
      await api(`/admin/catalog/${toolId}`, {
        method: "PUT",
        body: JSON.stringify({
          groupName,
          available,
          ...(canStandalone ? { openStandalone } : {}),
        }),
      });
      onSaved(
        canStandalone
          ? "Placement saved. Standalone apps open without the Justxsystems menu; refresh home to see the change."
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
    setBusy(true);
    try {
      await api(`/admin/catalog/${toolId}`, { method: "DELETE" });
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
    [busy, toolId, groupName, available, openStandalone, canStandalone],
  );

  return (
    <section className="panel admin-card tm-pane">
      <h2>Placement</h2>
      <p className="muted">
        Org catalog visibility on the operator home screen. Setting Live also adds the tool to each
        branch&apos;s home allowlist (if that branch uses a fixed tool list).
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
      </div>
      <div className="admin-form-row">
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void hide()}>
          Hide from home
        </button>
      </div>
    </section>
  );
});
