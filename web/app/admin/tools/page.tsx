"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ToolPlacementPane } from "@/components/admin/ToolPlacementPane";
import { ToolPricingPane, type BundleState, type SkuState } from "@/components/admin/ToolPricingPane";
import { ToolSchemaPane } from "@/components/admin/ToolSchemaPane";
import type { ToolsSaveHandle } from "@/components/admin/tools-actions";
import { getToolDefinition, uniqueTools } from "@/config/tools.config";
import { api } from "@/lib/api";
import { withBasePath } from "@/lib/base-path";
import { groupItemsByKey } from "@/lib/group-items";
import { usePlatformConfig } from "@/components/config/ConfigProvider";
import { invalidateAdminData, useLiveRefresh } from "@/hooks/useLiveRefresh";

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
type DirFilter = "all" | "live" | "hidden" | "paid" | "licensed";

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
  window.history.replaceState(null, "", withBasePath(`/admin/tools?${params.toString()}`));
}

export default function AdminToolsPage() {
  const { config, refresh: refreshConfig } = usePlatformConfig();
  const groupTools = config?.toolGrouping?.enabled !== false;
  const [groupingBusy, setGroupingBusy] = useState(false);
  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [skus, setSkus] = useState<SkuState[]>([]);
  const [licenses, setLicenses] = useState<License[]>([]);
  const [bundles, setBundles] = useState<BundleState[]>([]);
  const [defs, setDefs] = useState<ToolDef[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [tab, setTab] = useState<Tab>("placement");
  const [dirFilter, setDirFilter] = useState<DirFilter>("all");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [available, setAvailable] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newGroup, setNewGroup] = useState("Custom Tools");
  const [newTemplate, setNewTemplate] = useState<"blank" | "line_items">("blank");

  const placementRef = useRef<ToolsSaveHandle>(null);
  const pricingRef = useRef<ToolsSaveHandle>(null);
  const schemaRef = useRef<ToolsSaveHandle>(null);

  async function setToolGrouping(enabled: boolean) {
    setGroupingBusy(true);
    setMessage("");
    try {
      await api("/admin/config/tool-grouping", {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      });
      await refreshConfig();
      setMessage(enabled ? "Tools/Products grouping is on." : "Tools/Products grouping is off — lists are flat everywhere.");
      invalidateAdminData("admin-tools");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not update grouping");
    } finally {
      setGroupingBusy(false);
    }
  }

  const reload = useCallback(async () => {
    const [c, s, d] = await Promise.all([
      api<{ tools: CatalogRow[] }>("/admin/catalog"),
      api<{ skus: SkuState[]; licenses: License[]; bundles?: BundleState[] }>("/admin/skus"),
      api<{ tools: ToolDef[] }>("/admin/config/tools"),
    ]);
    setCatalog(c.tools);
    setSkus(s.skus);
    setLicenses(s.licenses);
    setBundles(s.bundles ?? []);
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

  const stats = useMemo(() => {
    const live = directory.filter((t) => t.catalog?.available !== false).length;
    const hidden = directory.filter((t) => t.catalog?.available === false).length;
    const paid = directory.filter((t) => t.sku && !t.sku.includedFree).length;
    const licensed = directory.filter((t) => t.licensed).length;
    return { total: directory.length, live, hidden, paid, licensed };
  }, [directory]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return directory.filter((t) => {
      if (dirFilter === "live" && t.catalog?.available === false) return false;
      if (dirFilter === "hidden" && t.catalog?.available !== false) return false;
      if (dirFilter === "paid" && !(t.sku && !t.sku.includedFree)) return false;
      if (dirFilter === "licensed" && !t.licensed) return false;
      if (!q) return true;
      return (
        t.id.includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.groupName.toLowerCase().includes(q) ||
        t.toolType.toLowerCase().includes(q)
      );
    });
  }, [directory, query, dirFilter]);

  const selected = directory.find((t) => t.id === selectedId) ?? filtered[0] ?? directory[0] ?? null;

  const didBootTools = useRef(false);
  useLiveRefresh(
    async () => {
      try {
        await reload();
        if (!didBootTools.current) {
          didBootTools.current = true;
          const params = new URLSearchParams(window.location.search);
          setTab(tabFromSearch(params.get("tab")));
          const fromUrl = params.get("tool");
          if (fromUrl) setSelectedId(fromUrl);
        }
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "Failed to load tools");
      }
    },
    { intervalMs: 60_000 },
  );

  useEffect(() => {
    if (!selected) return;
    if (!selectedId) setSelectedId(selected.id);
    setGroupName(selected.catalog?.groupName || selected.groupName);
    setAvailable(selected.catalog?.available ?? true);
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

  async function saveActive() {
    const handle =
      tab === "placement" ? placementRef.current : tab === "pricing" ? pricingRef.current : schemaRef.current;
    if (!handle) return;
    setSaving(true);
    try {
      await handle.save();
    } catch {
      /* pane surfaces message */
    } finally {
      setSaving(false);
    }
  }

  const saveLabel =
    tab === "placement"
      ? "Save placement"
      : tab === "pricing"
        ? selected?.sku
          ? "Save product"
          : "Publish product"
        : "Publish revision";

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
    invalidateAdminData("admin-tools");
  }

  async function createTool(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    const id = newId.trim();
    const title = newTitle.trim();
    const group = newGroup.trim() || "Custom Tools";
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
      category: group,
      addLabel: "+ Add Entry",
      fields,
      titleField: newTemplate === "line_items" ? "item" : "name",
      subtitleFields: newTemplate === "line_items" ? ["amount"] : ["notes"],
      statusField: null,
    };
    await api("/admin/catalog", {
      method: "POST",
      body: JSON.stringify({ id, title, groupName: group }),
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
    invalidateAdminData("admin-tools");
    select(id, "schema");
    setMessage(`Created ${title}. Configure fields (including formulas), then pricing if needed.`);
  }

  const groups = useMemo(
    () => groupItemsByKey(filtered, (t) => t.groupName || "General", groupTools, "All tools"),
    [filtered, groupTools],
  );

  return (
    <div className="admin-page tm-page">
      <section className="panel admin-card admin-page-head">
        <div className="analytics-toolbar">
          <div>
            <h2>Tool management</h2>
            <p className="muted">
              Place tools on home, publish commercial offers, and revise field schemas — one tool at a time.
            </p>
          </div>
          <div className="admin-form-row">
            <label className="field" style={{ margin: 0, minWidth: 220 }}>
              <span>Tools / Products grouping</span>
              <select
                value={groupTools ? "on" : "off"}
                disabled={groupingBusy}
                onChange={(e) => void setToolGrouping(e.target.value === "on")}
                aria-label="Tools and products grouping"
              >
                <option value="on">Grouped by category</option>
                <option value="off">Flat list (no groups)</option>
              </select>
            </label>
            <Link href="/admin/subscriptions" className="btn btn-ghost btn-sm">
              Packs & access
            </Link>
            <Link href="/admin/analytics" className="btn btn-ghost btn-sm">
              Usage analytics
            </Link>
          </div>
        </div>
        <div className="analytics-kpis tm-kpis">
          <button type="button" className={`result-card${dirFilter === "all" ? " is-selected" : ""}`} onClick={() => setDirFilter("all")}>
            <span>Tools</span>
            <strong>{stats.total}</strong>
          </button>
          <button type="button" className={`result-card${dirFilter === "live" ? " is-selected" : ""}`} onClick={() => setDirFilter("live")}>
            <span>Live on home</span>
            <strong>{stats.live}</strong>
          </button>
          <button type="button" className={`result-card${dirFilter === "hidden" ? " is-selected" : ""}`} onClick={() => setDirFilter("hidden")}>
            <span>Hidden</span>
            <strong>{stats.hidden}</strong>
          </button>
          <button type="button" className={`result-card${dirFilter === "paid" ? " is-selected" : ""}`} onClick={() => setDirFilter("paid")}>
            <span>Paid products</span>
            <strong>{stats.paid}</strong>
          </button>
          <button
            type="button"
            className={`result-card${dirFilter === "licensed" ? " is-selected" : ""}`}
            onClick={() => setDirFilter("licensed")}
          >
            <span>Licensed here</span>
            <strong>{stats.licensed}</strong>
          </button>
        </div>
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
          <div className="admin-tabs tm-dir-filters" role="tablist" aria-label="Directory filter">
            {(
              [
                ["all", "All"],
                ["live", "Live"],
                ["hidden", "Hidden"],
                ["paid", "Paid"],
                ["licensed", "Licensed"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                className={dirFilter === id ? "active" : ""}
                onClick={() => setDirFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="tm-directory-body">
            {groups.length === 0 ? (
              <p className="muted">No tools match this filter.</p>
            ) : (
              groups.map(([group, rows]) => (
                <div key={group} className="admin-tool-group">
                  {groupTools ? <h3>{group}</h3> : null}
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
                        ) : t.sku?.accessPolicy === "hard_lock" ? (
                          <span className="pill pill-danger">Lock</span>
                        ) : t.sku ? (
                          <span className="pill pill-warning">Paid</span>
                        ) : null}
                      </span>
                    </button>
                  ))}
                </div>
              ))
            )}
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
                  <Link href={`/admin/analytics/tools/${selected.id}`} className="btn btn-ghost btn-sm">
                    Analytics
                  </Link>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void move(selected.id, -1)}>
                    Move up
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void move(selected.id, 1)}>
                    Move down
                  </button>
                </div>
              </section>

              <div className="admin-tabs-bar">
                <div className="admin-tabs tm-detail-tabs" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    className={tab === "placement" ? "active" : ""}
                    onClick={() => goTab("placement")}
                  >
                    Placement
                  </button>
                  <button
                    type="button"
                    role="tab"
                    className={tab === "pricing" ? "active" : ""}
                    onClick={() => goTab("pricing")}
                  >
                    Product
                  </button>
                  <button
                    type="button"
                    role="tab"
                    className={tab === "schema" ? "active" : ""}
                    onClick={() => goTab("schema")}
                  >
                    Schema
                  </button>
                </div>
                <div className="admin-tabs-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={saving}
                    onClick={() => void saveActive()}
                  >
                    {saving ? "Saving…" : saveLabel}
                  </button>
                </div>
              </div>

              {message ? <p className="muted tm-flash">{message}</p> : null}

              <div hidden={tab !== "placement"} className={tab === "placement" ? undefined : "payments-tab-park"}>
                <ToolPlacementPane
                  ref={placementRef}
                  toolId={selected.id}
                  groupName={groupName}
                  available={available}
                  onGroupName={setGroupName}
                  onAvailable={setAvailable}
                  onSaved={async (msg) => {
                    setMessage(msg);
                    await reload();
                    invalidateAdminData("admin-tools");
                  }}
                />
              </div>

              <div hidden={tab !== "pricing"} className={tab === "pricing" ? undefined : "payments-tab-park"}>
                <ToolPricingPane
                  ref={pricingRef}
                  toolId={selected.id}
                  toolName={selected.name}
                  toolCategory={selected.groupName}
                  sku={selected.sku}
                  licensed={selected.licensed}
                  periodEnd={selected.periodEnd}
                  bundles={bundles}
                  onReload={async () => {
                    await reload();
                    invalidateAdminData("admin-tools");
                  }}
                  onMessage={setMessage}
                />
              </div>

              <div hidden={tab !== "schema"} className={tab === "schema" ? undefined : "payments-tab-park"}>
                <ToolSchemaPane
                  ref={schemaRef}
                  toolId={selected.id}
                  toolType={selected.toolType}
                  definition={selected.definition}
                  onPublished={async (msg) => {
                    setMessage(msg);
                    await reload();
                    invalidateAdminData("admin-tools");
                  }}
                />
              </div>
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
