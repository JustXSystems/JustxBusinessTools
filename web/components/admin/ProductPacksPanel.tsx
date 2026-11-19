"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AdminEmpty, AdminSection } from "@/components/admin/ui";
import { SelectField, SwitchField, TextField, TextareaField } from "@/components/admin/ui/AdminFields";
import type { BundleState, SkuState } from "@/components/admin/ToolPricingPane";
import { Badge, Button, Checkbox, Dialog, Field, FormGrid, cx } from "@/components/bos";
import { adminDeepLink } from "@/lib/admin-deep-links";
import { api } from "@/lib/api";
import { bumpCommerceRevision } from "@/lib/commerce-revision";

function inr(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

export function ProductPacksPanel({
  onMessage,
  onError,
}: {
  onMessage: (msg: string) => void;
  /** Failure channel; falls back to `onMessage` when omitted. */
  onError?: (msg: string) => void;
}) {
  const fail = onError ?? onMessage;
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
  const [confirmDelete, setConfirmDelete] = useState(false);

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
      .catch((e) => fail(e instanceof Error ? e.message : "Failed to load packs"));
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
      fail(err instanceof Error ? err.message : "Pack save failed");
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
      fail(err instanceof Error ? err.message : "Delete failed");
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
  const canDelete = !creating && Boolean(editingId) && editingId !== "all_tools";
  const deleteName = bundles.find((b) => b.id === editingId)?.name ?? editingId ?? "this pack";

  return (
    <>
      <AdminSection
        title="Product packs"
        description="Marketing bundles that expand to per-tool licenses. All Tools Pack grants every paid SKU. Custom packs (e.g. Sales, Solar) select specific tools."
        actions={
          <>
            <Button variant="secondary" size="sm" icon="plus" onClick={startCreate}>
              New pack
            </Button>
            <Button type="submit" form="product-pack-form" variant="primary" size="sm" disabled={saving}>
              {saving ? "Saving…" : creating ? "Create pack" : "Save pack"}
            </Button>
          </>
        }
      >
        <div className="admin-cc-pack-layout">
          <div className="admin-cc-dir-list" style={{ marginTop: 0 }}>
            {bundles.length === 0 ? (
              <AdminEmpty title="No packs yet" icon="box">
                Create the first pack to bundle paid tools.
              </AdminEmpty>
            ) : null}
            {bundles.map((b) => {
              const active = editingId === b.id && !creating;
              return (
                <button
                  key={b.id}
                  type="button"
                  className={cx("admin-cc-row", active && "is-selected")}
                  aria-pressed={active}
                  onClick={() => startEdit(b)}
                >
                  <div className="admin-cc-row-main">
                    <div className="admin-cc-cell-title">{b.name}</div>
                    <div className="admin-cc-cell-sub">{b.id}</div>
                  </div>
                  <div className="admin-cc-row-badges">
                    <Badge auto tone="neutral">
                      {inr(b.priceInr)}
                    </Badge>
                    {b.highlighted ? (
                      <Badge auto tone="emerald">
                        Featured
                      </Badge>
                    ) : null}
                    {b.available === false ? (
                      <Badge auto tone="coral">
                        Hidden
                      </Badge>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>

          <form id="product-pack-form" className="admin-cc-form" onSubmit={(e) => void save(e)}>
            <FormGrid>
              {creating ? (
                <TextField
                  full
                  label="Pack id"
                  value={form.id}
                  onChange={(e) => setForm({ ...form, id: e.target.value })}
                  placeholder="e.g. sales_pack"
                  pattern="[a-z][a-z0-9_]*"
                  required
                />
              ) : null}
              <TextField
                label="Name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
              <TextField
                label="Tagline"
                value={form.tagline}
                onChange={(e) => setForm({ ...form, tagline: e.target.value })}
              />
              <TextField
                label="Discount %"
                type="number"
                min={0}
                max={100}
                value={form.discountPct}
                disabled={form.fixedPriceInr.trim() !== ""}
                onChange={(e) => setForm({ ...form, discountPct: e.target.value })}
              />
              <TextField
                label="Fixed price (optional)"
                type="number"
                min={0}
                value={form.fixedPriceInr}
                placeholder="Overrides sum − discount"
                onChange={(e) => setForm({ ...form, fixedPriceInr: e.target.value })}
              />
              <SelectField
                label="Available"
                value={form.available ? "1" : "0"}
                onChange={(e) => setForm({ ...form, available: e.target.value === "1" })}
              >
                <option value="1">Yes</option>
                <option value="0">No</option>
              </SelectField>
              <SwitchField
                label="Highlighted"
                checked={form.highlighted}
                onChange={(highlighted) => setForm({ ...form, highlighted })}
              />
              <TextareaField
                full
                label="Description"
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </FormGrid>

            {editingAllTools ? (
              <p className="admin-cc-note-text">
                All Tools Pack always expands to every paid SKU at grant time. Tool checklist is not required.
              </p>
            ) : (
              <Field label="Tools in pack">
                {() => (
                  <div className="admin-cc-checklist">
                    {skus.map((s) => (
                      <label key={s.toolId} className="admin-cc-check">
                        <Checkbox
                          checked={form.toolIds.includes(s.toolId)}
                          onChange={() => toggleTool(s.toolId)}
                          aria-label={s.name}
                        />
                        <span>
                          {s.name} <span className="admin-cc-cell-sub">{inr(s.priceInr)}</span>
                        </span>
                      </label>
                    ))}
                    {skus.length === 0 ? <span className="admin-cc-cell-sub">No paid SKUs available.</span> : null}
                  </div>
                )}
              </Field>
            )}

            <p className="admin-cc-note-text">
              Define pack membership here. Provision licenses to a Business Profile from{" "}
              <Link href={adminDeepLink.profileAccess(undefined, "fabric")}>Access Fabric</Link> (profile-first pack
              provisioner). Per-tool pricing lives under{" "}
              <Link href={adminDeepLink.toolsPricing()}>Catalog &amp; products</Link>.
            </p>

            <div className="admin-cc-form-actions">
              {!creating ? (
                <Link href={adminDeepLink.profileAccess(undefined, "fabric")}>
                  <Button variant="secondary" size="sm">
                    Open Access Fabric
                  </Button>
                </Link>
              ) : null}
              {!creating ? (
                <Link href={adminDeepLink.toolsPricing()}>
                  <Button variant="ghost" size="sm">
                    Tool products
                  </Button>
                </Link>
              ) : null}
              {canDelete ? (
                <Button variant="destructive" size="sm" disabled={saving} onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              ) : null}
            </div>
          </form>
        </div>
      </AdminSection>

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${deleteName}?`}
        description="This removes the pack from the catalog and cannot be undone."
        icon={{ tone: "coral" }}
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={saving}
              onClick={() => {
                setConfirmDelete(false);
                if (editingId) void remove(editingId);
              }}
            >
              Delete pack
            </Button>
          </>
        }
      />
    </>
  );
}
