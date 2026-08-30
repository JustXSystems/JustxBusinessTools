"use client";

import { api } from "@/lib/api";

export function ToolPlacementPane({
  toolId,
  groupName,
  available,
  onGroupName,
  onAvailable,
  onSaved,
}: {
  toolId: string;
  groupName: string;
  available: boolean;
  onGroupName: (v: string) => void;
  onAvailable: (v: boolean) => void;
  onSaved: (msg: string) => void;
}) {
  async function save() {
    await api(`/admin/catalog/${toolId}`, {
      method: "PUT",
      body: JSON.stringify({ groupName, available }),
    });
    onSaved("Placement saved. Live tools are added to branch home lists; refresh home to see them.");
  }

  async function hide() {
    await api(`/admin/catalog/${toolId}`, { method: "DELETE" });
    onSaved("Tool hidden from the operator home catalog.");
  }

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
        <button type="button" className="btn btn-primary" onClick={() => void save()}>
          Save placement
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => void hide()}>
          Hide from home
        </button>
      </div>
    </section>
  );
}
