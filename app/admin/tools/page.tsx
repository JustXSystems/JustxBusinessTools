"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

type ToolRow = {
  id: string;
  groupName: string;
  sortOrder: number;
  available: boolean;
  formula: string | null;
  toolType: string;
};

export default function AdminToolsPage() {
  const [tools, setTools] = useState<ToolRow[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [groupName, setGroupName] = useState("");
  const [formula, setFormula] = useState("");
  const [available, setAvailable] = useState(true);
  const [message, setMessage] = useState("");
  const [newId, setNewId] = useState("");
  const [newTitle, setNewTitle] = useState("");

  async function reload() {
    const data = await api<{ tools: ToolRow[] }>("/admin/catalog");
    setTools(data.tools);
    if (!selected && data.tools[0]) select(data.tools[0]);
  }

  function select(t: ToolRow) {
    setSelected(t.id);
    setGroupName(t.groupName);
    setFormula(t.formula ?? "");
    setAvailable(t.available);
  }

  useEffect(() => {
    reload().catch((e) => setMessage(e.message));
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, ToolRow[]>();
    for (const t of tools) {
      const list = map.get(t.groupName) ?? [];
      list.push(t);
      map.set(t.groupName, list);
    }
    return Array.from(map.entries());
  }, [tools]);

  async function saveMeta() {
    setMessage("");
    await api(`/admin/catalog/${selected}`, {
      method: "PUT",
      body: JSON.stringify({ groupName, formula, available }),
    });
    setMessage("Tool settings saved.");
    await reload();
  }

  async function move(id: string, dir: -1 | 1) {
    const idx = tools.findIndex((t) => t.id === id);
    const swap = idx + dir;
    if (swap < 0 || swap >= tools.length) return;
    const next = [...tools];
    const a = next[idx];
    next[idx] = next[swap];
    next[swap] = a;
    await api("/admin/catalog/reorder", {
      method: "POST",
      body: JSON.stringify({
        items: next.map((t, i) => ({ id: t.id, sortOrder: i, groupName: t.groupName })),
      }),
    });
    await reload();
  }

  return (
    <div className="admin-page">
      <section className="panel admin-card admin-page-head">
        <h2>Tools catalog</h2>
        <p className="muted">
          Group, reorder, enable/disable tools. Monthly subscription prices are on{" "}
          <Link href="/admin/skus">SKU pricing</Link>. Field-level schema lives in{" "}
          <Link href="/admin/config">Schema designer</Link>.
        </p>
      </section>

      <div className="admin-split">
      <section className="panel admin-card">
        {groups.map(([group, rows]) => (
          <div key={group} className="admin-tool-group">
            <h3>{group}</h3>
            <div className="tracker-list">
              {rows.map((t) => (
                <div key={t.id} className={`tracker-row ${selected === t.id ? "is-selected" : ""}`}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => select(t)}>
                    <strong>{t.id}</strong>
                    <span className="muted">{t.toolType}</span>
                  </button>
                  <div className="admin-form-row">
                    <span className="pill">{t.available ? "live" : "hidden"}</span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => move(t.id, -1)}>↑</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => move(t.id, 1)}>↓</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      <div className="admin-pane-stack">
      {selected ? (
        <section className="panel admin-card">
          <h2>Customize — {selected}</h2>
          <div className="admin-form-grid">
            <label className="field">
              <span>Group</span>
              <input value={groupName} onChange={(e) => setGroupName(e.target.value)} />
            </label>
            <label className="field">
              <span>Available on home</span>
              <select value={available ? "1" : "0"} onChange={(e) => setAvailable(e.target.value === "1")}>
                <option value="1">Yes</option>
                <option value="0">No</option>
              </select>
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>Formula (calculators)</span>
              <textarea rows={4} value={formula} onChange={(e) => setFormula(e.target.value)} placeholder="e.g. gst = amount * rate / 100" />
            </label>
          </div>
          <div className="admin-form-row">
            <button type="button" className="btn btn-primary" onClick={saveMeta}>Save</button>
            <button type="button" className="btn btn-secondary" onClick={async () => {
              await api(`/admin/catalog/${selected}`, { method: "DELETE" });
              await reload();
            }}>Hide tool</button>
            <Link className="btn btn-ghost btn-sm" href="/admin/config">Open schema designer</Link>
          </div>
          {message ? <p className="muted">{message}</p> : null}
        </section>
      ) : null}

      <section className="panel admin-card">
        <h2>Create custom tool</h2>
        <form
          className="admin-form-row"
          onSubmit={async (e) => {
            e.preventDefault();
            await api("/admin/catalog", {
              method: "POST",
              body: JSON.stringify({ id: newId, title: newTitle, groupName: "Custom Tools" }),
            });
            setNewId("");
            setNewTitle("");
            await reload();
          }}
        >
          <input value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="id e.g. leadtracker" required pattern="[a-z][a-z0-9_]*" />
          <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Title" required />
          <button type="submit" className="btn btn-primary">Create</button>
        </form>
      </section>
      </div>
      </div>
    </div>
  );
}
