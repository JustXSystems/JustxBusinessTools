"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ToolPlacementPane } from "@/components/admin/ToolPlacementPane";
import { ToolPricingPane, type SkuState } from "@/components/admin/ToolPricingPane";
import { ToolSchemaPane } from "@/components/admin/ToolSchemaPane";
import { getToolDefinition, uniqueTools } from "@/config/tools.config";
import { api } from "@/lib/api";

type CatalogRow = {
  id: string;
  groupName: string;
  sortOrder: number;
  available: boolean;
  toolType: string;
};

type License = {
  toolId: string;
  name: string;
  status: string;
  periodEnd: string | null;
};

type ToolDef = { id: string; toolType: string; definition: Record<string, unknown> };

type Tab = "placement" | "pricing" | "schema";

type DirectoryItem = {
  id: string;
  name: string;
  groupName: string;
  toolType: string;
  catalog: CatalogRow | null;
  sku: SkuState | null;
  licensed: boolean;
  periodEnd: string | null;
  definition: Record<string, unknown> | null;
};

function tabFromSearch(raw: string | null): Tab {
  if (raw === "pricing" || raw === "skus" || raw === "licenses") return "pricing";
  if (raw === "schema" || raw === "config" || raw === "fields") return "schema";
  return "placement";
}

function syncUrl(toolId: string, tab: Tab) {
  const params = new URLSearchParams();
  params.set("tool", toolId);
  if (tab !== "placement") params.set("tab", tab);
  window.history.replaceState(null, "", `/admin/tools?${params.toString()}`);
}

export default function AdminToolsPage() {
  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [skus, setSkus] = useState<SkuState[]>([]);
  const [licenses, setLicenses] = useState<License[]>([]);
  const [defs, setDefs] = useState<ToolDef[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [tab, setTab] = useState<Tab>("placement");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [groupName, setGroupName] = useState("");
  const [available, setAvailable] = useState(true);
  const [priceDraft, setPriceDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newGroup, setNewGroup] = useState("Custom Tools");
  const [newTemplate, setNewTemplate] = useState<"blank" | "line_items">("blank");

  const reload = useCallback(async () => {
    const [c, s, d] = await Promise.all([
      api<{ tools: CatalogRow[] }>("/admin/catalog"),
      api<{ skus: SkuState[]; licenses: License[] }>("/admin/skus"),
      api<{ tools: ToolDef[] }>("/admin/config/tools"),
    ]);
    setCatalog(c.tools);
    setSkus(s.skus);
    setLicenses(s.licenses);
    setDefs(d.tools);
  }, []);

  const directory = useMemo<DirectoryItem[]>(() => {
    const catMap = new Map(catalog.map((t) => [t.id, t]));
    const skuMap = new Map(skus.map((t) => [t.toolId, t]));
    const licMap = new Map(licenses.map((t) => [t.toolId, t]));
    const defMap = new Map(defs.map((t) => [t.id, t]));
    const ids = new Set<string>([
      ...catalog.map((t) => t.id),
      ...skus.map((t) => t.toolId),
      ...defs.map((t) => t.id),
      ...uniqueTools().map((t) => t.id),
    ]);
    const ordered = catalog.map((t) => t.id);
    const rest = [...ids].filter((id) => !ordered.includes(id)).sort();
    return [...ordered, ...rest].map((id) => {
      const cat = catMap.get(id) ?? null;
      const sku = skuMap.get(id) ?? null;
      const builtin = getToolDefinition(id);
      const def = defMap.get(id);
      return {
        id,
        name: sku?.name || builtin?.name || id,
        groupName: cat?.groupName || sku?.category || builtin?.category || "General",
        toolType: def?.toolType || builtin?.type || cat?.toolType || "utility",
        catalog: cat,
        sku,
        licensed: Boolean(licMap.get(id)),
        periodEnd: licMap.get(id)?.periodEnd ?? null,
        definition: def?.definition ?? null,
      };
    });
  }, [catalog, skus, licenses, defs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return directory;
    return directory.filter(
      (t) =>
        t.id.includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.groupName.toLowerCase().includes(q) ||
        t.toolType.toLowerCase().includes(q),
    );
  }, [directory, query]);

  const selected = directory.find((t) => t.id === selectedId) ?? filtered[0] ?? directory[0] ?? null;

  useEffect(() => {
    reload()
      .then(() => {
        const params = new URLSearchParams(window.location.search);
        setTab(tabFromSearch(params.get("tab")));
        const fromUrl = params.get("tool");
        if (fromUrl) setSelectedId(fromUrl);
      })
      .catch((e: Error) => setMessage(e.message));
  }, [reload]);

  useEffect(() => {
    if (!selected) return;
    if (!selectedId) setSelectedId(selected.id);
    setGroupName(selected.catalog?.groupName || selected.groupName);
    setAvailable(selected.catalog?.available ?? true);
    setPriceDraft(selected.sku ? String(selected.sku.priceInr) : "0");
  }, [selected, selectedId]);

  function select(id: string, nextTab = tab) {
    setSelectedId(id);
    setTab(nextTab);
    setMessage("");
    syncUrl(id, nextTab);
  }

  function goTab(next: Tab) {
    if (!selected) return;
    setTab(next);
    syncUrl(selected.id, next);
  }

  async function move(id: string, dir: -1 | 1) {
    const idx = catalog.findIndex((t) => t.id === id);
    const swap = idx + dir;
    if (swap < 0 || swap >= catalog.length) return;
    const next = [...catalog];
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

  async function createTool(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    const id = newId.trim();
    const title = newTitle.trim();
    const groupName = newGroup.trim() || "Custom Tools";
    const fields =
      newTemplate === "line_items"
        ? [
            { key: "item", label: "Item", type: "text", required: true },
            { key: "qty", label: "Qty", type: "number", required: true },
            { key: "rate", label: "Rate", type: "number", required: true },
            { key: "gst", label: "GST %", type: "number", required: true },
            {
              key: "amount",
              label: "Amount",
              type: "computed",
              formula: "qty * rate * (1 + gst / 100)",
            },
            { key: "notes", label: "Notes", type: "textarea" },
          ]
        : [
            { key: "name", label: "Name", type: "text", required: true },
            { key: "notes", label: "Notes", type: "textarea" },
          ];
    const definition = {
      type: "tracker",
      key: id,
      title,
      icon: "📋",
      subtitle: newDesc,
      category: groupName,
      addLabel: "+ Add Entry",
      fields,
      titleField: newTemplate === "line_items" ? "item" : "name",
      subtitleFields: newTemplate === "line_items" ? ["amount"] : ["notes"],
      statusField: null,
    };
    await api("/admin/catalog", {
      method: "POST",
      body: JSON.stringify({ id, title, groupName }),
    });
    await api(`/admin/config/tools/${id}`, {
      method: "POST",
      body: JSON.stringify({ definition }),
    });
    setNewId("");
    setNewTitle("");
    setNewDesc("");
    setNewGroup("Custom Tools");
    setNewTemplate("blank");
    setCreating(false);
    await reload();
    select(id, "schema");
    setMessage(`Created ${title}. Configure fields (including formulas), then pricing if needed.`);
  }

  const groups = useMemo(() => {
    const map = new Map<string, DirectoryItem[]>();
    for (const t of filtered) {
      const list = map.get(t.groupName) ?? [];
      list.push(t);
      map.set(t.groupName, list);
    }
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <div className="admin-page tm-page">
      <section className="panel admin-card admin-page-head">
        <h2>Tool management</h2>
        <p className="muted">
          Select a tool, then configure placement, commercial terms, and field schema in one workspace.
        </p>
      </section>

      <div className="tm-workspace">
        <aside className="panel admin-card tm-directory">
          <div className="tm-directory-head">
            <h2>Directory</h2>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tools…"
              aria-label="Search tools"
            />
          </div>
          <div className="tm-directory-body">
            {groups.map(([group, rows]) => (
              <div key={group} className="admin-tool-group">
                <h3>{group}</h3>
                {rows.map((t) => (
                  <button
                    type="button"
                    key={t.id}
                    className={`tm-dir-item${selected?.id === t.id ? " is-selected" : ""}`}
                    onClick={() => select(t.id)}
                  >
                    <span className="tm-dir-name">
                      <strong>{t.name}</strong>
                      <em>{t.id}</em>
                    </span>
                    <span className="tm-dir-meta">
                      <span className={t.catalog?.available === false ? "pill" : "pill pill-success"}>
                        {t.catalog?.available === false ? "Hidden" : "Live"}
                      </span>
                      {t.sku?.includedFree ? (
                        <span className="pill">Incl.</span>
                      ) : t.licensed ? (
                        <span className="pill pill-success">Lic.</span>
                      ) : t.sku ? (
                        <span className="pill pill-warning">Paid</span>
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>

          {creating ? (
            <form className="tm-create" onSubmit={(e) => void createTool(e)}>
              <h3>Create tool</h3>
              <input
                value={newId}
                onChange={(e) => setNewId(e.target.value)}
                placeholder="id e.g. leadtracker"
                required
                pattern="[a-z][a-z0-9_]*"
              />
              <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Title" required />
              <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="Short description" />
              <input
                value={newGroup}
                onChange={(e) => setNewGroup(e.target.value)}
                placeholder="Group e.g. Sales"
                required
              />
              <label className="field">
                <span>Starter schema</span>
                <select
                  value={newTemplate}
                  onChange={(e) => setNewTemplate(e.target.value as "blank" | "line_items")}
                >
                  <option value="blank">Blank (name + notes)</option>
                  <option value="line_items">Line items + amount formula</option>
                </select>
              </label>
              <div className="admin-form-row">
                <button type="submit" className="btn btn-primary btn-sm">
                  Create
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreating(false)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button type="button" className="btn btn-secondary btn-sm tm-create-btn" onClick={() => setCreating(true)}>
              + New tool
            </button>
          )}
        </aside>

        <div className="tm-detail">
          {selected ? (
            <>
              <section className="panel admin-card tm-detail-head">
                <div>
                  <p className="card-label">{selected.toolType}</p>
                  <h2>{selected.name}</h2>
                  <p className="muted">{selected.id}</p>
                </div>
                <div className="tm-order-btns">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void move(selected.id, -1)}>
                    Move up
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void move(selected.id, 1)}>
                    Move down
                  </button>
                </div>
                <div className="admin-tabs tm-detail-tabs">
                  <button type="button" className={tab === "placement" ? "active" : ""} onClick={() => goTab("placement")}>
                    Placement
                  </button>
                  <button type="button" className={tab === "pricing" ? "active" : ""} onClick={() => goTab("pricing")}>
                    Pricing
                  </button>
                  <button type="button" className={tab === "schema" ? "active" : ""} onClick={() => goTab("schema")}>
                    Schema
                  </button>
                </div>
              </section>

              {message ? <p className="muted tm-flash">{message}</p> : null}

              {tab === "placement" ? (
                <ToolPlacementPane
                  toolId={selected.id}
                  groupName={groupName}
                  available={available}
                  onGroupName={setGroupName}
                  onAvailable={setAvailable}
                  onSaved={async (msg) => {
                    setMessage(msg);
                    await reload();
                  }}
                />
              ) : null}

              {tab === "pricing" ? (
                <ToolPricingPane
                  sku={selected.sku}
                  licensed={selected.licensed}
                  periodEnd={selected.periodEnd}
                  priceDraft={priceDraft}
                  onPriceDraft={setPriceDraft}
                  onReload={reload}
                  onMessage={setMessage}
                />
              ) : null}

              {tab === "schema" ? (
                <ToolSchemaPane
                  toolId={selected.id}
                  toolType={selected.toolType}
                  definition={selected.definition}
                  onPublished={async (msg) => {
                    setMessage(msg);
                    await reload();
                  }}
                />
              ) : null}
            </>
          ) : (
            <section className="panel admin-card">
              <p className="muted">Loading tools…</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
