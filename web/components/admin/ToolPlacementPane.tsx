"use client";

import { forwardRef, useImperativeHandle, useState } from "react";
import type { ToolsSaveHandle } from "@/components/admin/tools-actions";
import { api } from "@/lib/api";

export const ToolPlacementPane = forwardRef<
  ToolsSaveHandle,
  {
    toolId: string;
    groupName: string;
    available: boolean;
    onGroupName: (v: string) => void;
    onAvailable: (v: boolean) => void;
    onSaved: (msg: string) => void;
  }
>(function ToolPlacementPane(
  { toolId, groupName, available, onGroupName, onAvailable, onSaved },
  ref,
) {
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api(`/admin/catalog/${toolId}`, {
        method: "PUT",
        body: JSON.stringify({ groupName, available }),
      });
      onSaved("Placement saved. Live tools are added to branch home lists; refresh home to see them.");
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
    [busy, toolId, groupName, available],
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
      </div>
      <div className="admin-form-row">
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void hide()}>
          Hide from home
        </button>
      </div>
    </section>
  );
});
