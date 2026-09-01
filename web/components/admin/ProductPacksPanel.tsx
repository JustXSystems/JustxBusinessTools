"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { bumpCommerceRevision } from "@/lib/commerce-revision";
import type { BundleState, SkuState } from "@/components/admin/ToolPricingPane";

function inr(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

export function ProductPacksPanel({
  onMessage,
}: {
  onMessage: (msg: string) => void;
}) {
  const [bundles, setBundles] = useState<BundleState[]>([]);
  const [skus, setSkus] = useState<SkuState[]>([]);
  const [editingId, setEditingId] = useState<string | null>("all_tools");
  const [form, setForm] = useState({
    id: "",
    name: "",
    tagline: "",
    description: "",
    discountPct: "0",
    fixedPriceInr: "",
    available: true,
    highlighted: false,
    toolIds: [] as string[],
  });
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  async function reload() {
    const data = await api<{ skus: SkuState[]; bundles?: BundleState[] }>("/admin/skus");
    setSkus(data.skus.filter((s) => !s.includedFree && s.priceInr > 0));
    setBundles(data.bundles ?? []);
    return data.bundles ?? [];
  }

  useEffect(() => {
    void reload()
      .then((list) => {
        const first = list.find((b) => b.id === "all_tools") ?? list[0];
        if (first) startEdit(first);
      })
      .catch((e) => onMessage(e instanceof Error ? e.message : "Failed to load packs"));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot once
  }, []);

  function startEdit(b: BundleState) {
    setCreating(false);
    setEditingId(b.id);
    setForm({
      id: b.id,
      name: b.name,
      tagline: b.tagline ?? "",
      description: b.description ?? "",
      discountPct: String(b.discountPct ?? 0),
      fixedPriceInr: b.fixedPriceInr == null ? "" : String(b.fixedPriceInr),
      available: b.available !== false,
      highlighted: Boolean(b.highlighted),
      toolIds: b.id === "all_tools" ? [] : [...b.toolIds],
    });
  }

  function startCreate() {
    setCreating(true);
    setEditingId(null);
    setForm({
      id: "",
      name: "",
      tagline: "",
      description: "",
      discountPct: "10",
      fixedPriceInr: "",
      available: true,
      highlighted: false,
      toolIds: [],
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        tagline: form.tagline.trim() || null,
        description: form.description.trim() || null,
        discountPct: Number(form.discountPct) || 0,
        fixedPriceInr: form.fixedPriceInr.trim() === "" ? null : Number(form.fixedPriceInr),
        available: form.available,
        highlighted: form.highlighted,
        toolIds: form.id === "all_tools" || editingId === "all_tools" ? [] : form.toolIds,
      };
      if (creating) {
        const id = form.id.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
        await api("/admin/skus/bundles", {
          method: "POST",
          body: JSON.stringify({ id, ...payload }),
        });
        onMessage(`Pack ${payload.name} created.`);
      } else if (editingId) {
        await api(`/admin/skus/bundles/${editingId}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        onMessage(`Pack ${payload.name} saved.`);
      }
      bumpCommerceRevision();
      const list = await reload();
      const keep = list.find((b) => b.id === (creating ? form.id : editingId));
      if (keep) startEdit(keep);
      setCreating(false);
    } catch (err) {
      onMessage(err instanceof Error ? err.message : "Pack save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (id === "all_tools") return;
    setSaving(true);
    try {
      await api(`/admin/skus/bundles/${id}`, { method: "DELETE" });
      onMessage("Pack deleted.");
      bumpCommerceRevision();
      const list = await reload();
      const first = list[0];
      if (first) startEdit(first);
      else startCreate();
    } catch (err) {
      onMessage(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  }

  async function grantPack(id: string) {
    setSaving(true);
    try {
      const r = await api<{ granted: string[] }>("/admin/skus/grant", {
        method: "POST",
        body: JSON.stringify({ bundleId: id, days: 365 }),
      });
      onMessage(`Granted ${r.granted.length} tool license(s) from pack.`);
    } catch (err) {
      onMessage(err instanceof Error ? err.message : "Grant failed");
    } finally {
      setSaving(false);
    }
  }

  function toggleTool(id: string) {
    setForm((f) => ({
      ...f,
      toolIds: f.toolIds.includes(id) ? f.toolIds.filter((t) => t !== id) : [...f.toolIds, id],
    }));
  }

  const editingAllTools = !creating && (editingId === "all_tools" || form.id === "all_tools");

  return (
    <section className="panel admin-card">
      <div className="analytics-toolbar">
        <div>
          <h2>Product packs</h2>
          <p className="muted">
            Marketing bundles that expand to per-tool licenses. All Tools Pack grants every paid SKU.
            Custom packs (e.g. Sales, Solar) select specific tools.
          </p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={startCreate}>
          + New pack
        </button>
      </div>

      <div className="tm-packs-layout">
        <div className="tm-packs-list">
          {bundles.map((b) => (
            <button
              key={b.id}
              type="button"
              className={`tm-dir-item${editingId === b.id && !creating ? " is-selected" : ""}`}
              onClick={() => startEdit(b)}
            >
              <span className="tm-dir-name">
                <strong>{b.name}</strong>
                <em>{b.id}</em>
              </span>
              <span className="tm-dir-meta">
                <span className="pill">{inr(b.priceInr)}</span>
                {b.highlighted ? <span className="pill pill-success">Featured</span> : null}
              </span>
            </button>
          ))}
        </div>

        <form className="tm-packs-editor" onSubmit={(e) => void save(e)}>
          {creating ? (
            <label className="field">
              <span>Pack id</span>
              <input
                value={form.id}
                onChange={(e) => setForm({ ...form, id: e.target.value })}
                placeholder="e.g. sales_pack"
                pattern="[a-z][a-z0-9_]*"
                required
              />
            </label>
          ) : null}
          <div className="admin-form-grid">
            <label className="field">
              <span>Name</span>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </label>
            <label className="field">
              <span>Tagline</span>
              <input
                value={form.tagline}
                onChange={(e) => setForm({ ...form, tagline: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Discount %</span>
              <input
                type="number"
                min={0}
                max={100}
                value={form.discountPct}
                disabled={form.fixedPriceInr.trim() !== ""}
                onChange={(e) => setForm({ ...form, discountPct: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Fixed price (optional)</span>
              <input
                type="number"
                min={0}
                value={form.fixedPriceInr}
                placeholder="Overrides sum − discount"
                onChange={(e) => setForm({ ...form, fixedPriceInr: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Available</span>
              <select
                value={form.available ? "1" : "0"}
                onChange={(e) => setForm({ ...form, available: e.target.value === "1" })}
              >
                <option value="1">Yes</option>
                <option value="0">No</option>
              </select>
            </label>
            <label className="field">
              <span>Highlighted</span>
              <select
                value={form.highlighted ? "1" : "0"}
                onChange={(e) => setForm({ ...form, highlighted: e.target.value === "1" })}
              >
                <option value="0">No</option>
                <option value="1">Yes</option>
              </select>
            </label>
            <label className="field field-span-2">
              <span>Description</span>
              <textarea
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </label>
          </div>

          {editingAllTools ? (
            <p className="muted">
              All Tools Pack always expands to every paid SKU at grant time. Tool checklist is not required.
            </p>
          ) : (
            <div className="tm-pack-tools">
              <span className="field-label">Tools in pack</span>
              <div className="tm-pack-tool-grid">
                {skus.map((s) => (
                  <label key={s.toolId} className="tm-pack-tool">
                    <input
                      type="checkbox"
                      checked={form.toolIds.includes(s.toolId)}
                      onChange={() => toggleTool(s.toolId)}
                    />
                    <span>
                      {s.name} <em>{inr(s.priceInr)}</em>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="admin-form-row">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : creating ? "Create pack" : "Save pack"}
            </button>
            {!creating && editingId ? (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={saving}
                onClick={() => void grantPack(editingId)}
              >
                Grant to operator (365d)
              </button>
            ) : null}
            {!creating && editingId && editingId !== "all_tools" ? (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={saving}
                onClick={() => void remove(editingId)}
              >
                Delete
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </section>
  );
}
