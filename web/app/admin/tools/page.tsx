"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Grid,
  KpiCard,
  SearchInput,
  cx,
} from "@/components/bos";
import {
  AdminEmpty,
  AdminErrorState,
  AdminPage,
  AdminPageSkeleton,
  AdminSection,
  AdminTabs,
} from "@/components/admin/ui";
import { SelectField, TextField } from "@/components/admin/ui/AdminFields";
import { FeatureSwitchesPanel } from "@/components/admin/FeatureSwitchesPanel";
import { ToolPlacementPane } from "@/components/admin/ToolPlacementPane";
import {
  ToolPricingPane,
  type BundleState,
  type ProfileOption,
  type SkuState,
} from "@/components/admin/ToolPricingPane";
import { ToolSchemaPane } from "@/components/admin/ToolSchemaPane";
import type { ToolsSaveHandle } from "@/components/admin/tools-actions";
import { getToolDefinition, uniqueTools } from "@/config/tools.config";
import { api } from "@/lib/api";
import { adminDeepLink } from "@/lib/admin-deep-links";
import { withBasePath } from "@/lib/base-path";
import { groupItemsByKey } from "@/lib/group-items";
import { usePlatformConfig } from "@/components/config/ConfigProvider";
import { invalidateAdminData, useLiveRefresh } from "@/hooks/useLiveRefresh";
import { useRevealWhenStacked } from "@/hooks/useRevealWhenStacked";

type CatalogRow = {
  id: string;
  groupName: string;
  sortOrder: number;
  available: boolean;
  openStandalone?: boolean;
  toolType: string;
};

type License = {
  toolId: string;
  name: string;
  status: string;
  periodEnd: string | null;
  recordLimitOverride?: number | null;
  businessProfileId?: number;
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
  recordLimitOverride: number | null;
  seatCount: number;
  definition: Record<string, unknown> | null;
};

function tabFromSearch(raw: string | null): Tab {
  if (raw === "pricing" || raw === "skus" || raw === "licenses") return "pricing";
  if (raw === "schema" || raw === "config" || raw === "fields") return "schema";
  return "placement";
}

function syncUrl(toolId: string, tab: Tab, profileId?: number | null) {
  const params = new URLSearchParams();
  params.set("tool", toolId);
  if (tab !== "placement") params.set("tab", tab);
  if (profileId != null && profileId > 0) params.set("profile", String(profileId));
  window.history.replaceState(null, "", withBasePath(`/admin/tools?${params.toString()}`));
}

export default function AdminToolsPage() {
  const { config, refresh: refreshConfig } = usePlatformConfig();
  const groupTools = config?.toolGrouping?.enabled !== false;
  const [groupingBusy, setGroupingBusy] = useState(false);
  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [needsOrganization, setNeedsOrganization] = useState(false);
  const [skus, setSkus] = useState<SkuState[]>([]);
  const [licenses, setLicenses] = useState<License[]>([]);
  const [entitlements, setEntitlements] = useState<License[]>([]);
  const [orgLicenses, setOrgLicenses] = useState<License[]>([]);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [businessProfileId, setBusinessProfileId] = useState<number | null>(null);
  const [bundles, setBundles] = useState<BundleState[]>([]);
  const [defs, setDefs] = useState<ToolDef[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const { ref: detailRef, reveal: revealDetail } = useRevealWhenStacked<HTMLDivElement>();
  const [tab, setTab] = useState<Tab>("placement");
  const [dirFilter, setDirFilter] = useState<DirFilter>("all");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [available, setAvailable] = useState(true);
  const [openStandalone, setOpenStandalone] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newGroup, setNewGroup] = useState("Custom Tools");
  const [newTemplate, setNewTemplate] = useState<"blank" | "line_items">("blank");

  const placementRef = useRef<ToolsSaveHandle>(null);
  const pricingRef = useRef<ToolsSaveHandle>(null);
  const schemaRef = useRef<ToolsSaveHandle>(null);
  const createFormRef = useRef<HTMLFormElement>(null);

  function say(text: string, tone: "success" | "error" = "success") {
    setMessageTone(tone);
    setMessage(text);
  }

  function changeProfile(next: number | null) {
    setBusinessProfileId(next);
    if (selectedId) syncUrl(selectedId, tab, next);
  }

  async function setToolGrouping(enabled: boolean) {
    setGroupingBusy(true);
    setMessage("");
    try {
      await api("/admin/config/tool-grouping", {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      });
      await refreshConfig();
      say(enabled ? "Tools/Products grouping is on." : "Tools/Products grouping is off — lists are flat everywhere.");
      invalidateAdminData("admin-tools");
    } catch (err) {
      say(err instanceof Error ? err.message : "Could not update grouping", "error");
    } finally {
      setGroupingBusy(false);
    }
  }

  const reload = useCallback(async () => {
    const qs =
      businessProfileId != null ? `?businessProfileId=${businessProfileId}` : "";
    const [c, s, d] = await Promise.all([
      api<{ tools: CatalogRow[]; needsOrganization?: boolean }>(`/admin/catalog${qs}`),
      api<{
        skus: SkuState[];
        licenses: License[];
        entitlements?: License[];
        orgLicenses?: License[];
        bundles?: BundleState[];
        profiles?: ProfileOption[];
        businessProfileId?: number | null;
      }>(`/admin/skus${qs}`),
      api<{ tools: ToolDef[] }>("/admin/config/tools"),
    ]);
    setCatalog(c.tools);
    setNeedsOrganization(Boolean(c.needsOrganization) || businessProfileId == null);
    setSkus(s.skus);
    setLicenses(s.licenses);
    setEntitlements(s.entitlements ?? []);
    setOrgLicenses(s.orgLicenses ?? []);
    setBundles(s.bundles ?? []);
    setProfiles(s.profiles ?? []);
    setDefs(d.tools);
    return s.profiles ?? [];
  }, [businessProfileId]);

  const directory = useMemo<DirectoryItem[]>(() => {
    const catMap = new Map(catalog.map((t) => [t.id, t]));
    const skuMap = new Map(skus.map((t) => [t.toolId, t]));
    const licMap = new Map(licenses.map((t) => [t.toolId, t]));
    const entMap = new Map(entitlements.map((t) => [t.toolId, t]));
    const seatMap = new Map<string, number>();
    for (const lic of orgLicenses) {
      seatMap.set(lic.toolId, (seatMap.get(lic.toolId) ?? 0) + 1);
    }
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
      const lic = licMap.get(id);
      const ent = entMap.get(id);
      return {
        id,
        name: sku?.name || builtin?.name || id,
        groupName: cat?.groupName || sku?.category || builtin?.category || "General",
        toolType: def?.toolType || builtin?.type || cat?.toolType || "utility",
        catalog: cat,
        sku,
        licensed: Boolean(lic && (lic.status == null || lic.status === "active")),
        periodEnd: lic?.periodEnd ?? null,
        recordLimitOverride: ent?.recordLimitOverride ?? lic?.recordLimitOverride ?? null,
        seatCount: seatMap.get(id) ?? 0,
        definition: def?.definition ?? null,
      };
    });
  }, [catalog, skus, licenses, entitlements, orgLicenses, defs]);

  const stats = useMemo(() => {
    if (needsOrganization) {
      const paid = directory.filter((t) => t.sku && !t.sku.includedFree).length;
      return { total: directory.length, live: 0, hidden: 0, paid, licensed: 0 };
    }
    const live = directory.filter((t) => t.catalog?.available !== false).length;
    const hidden = directory.filter((t) => t.catalog?.available === false).length;
    const paid = directory.filter((t) => t.sku && !t.sku.includedFree).length;
    const licensed = directory.filter((t) => t.licensed).length;
    return { total: directory.length, live, hidden, paid, licensed };
  }, [directory, needsOrganization]);

  // Live / Hidden / Licensed are per-Business-Profile views — without a profile they cannot be evaluated.
  const profileRequiredForFilter =
    needsOrganization && (dirFilter === "live" || dirFilter === "hidden" || dirFilter === "licensed");

  const filtered = useMemo(() => {
    if (profileRequiredForFilter) return [];
    const q = query.trim().toLowerCase();
    return directory.filter((t) => {
      if (dirFilter === "live" && t.catalog?.available === false) return false;
      if (dirFilter === "hidden" && t.catalog?.available !== false) return false;
      if (dirFilter === "licensed" && !t.licensed) return false;
      if (dirFilter === "paid" && !(t.sku && !t.sku.includedFree)) return false;
      if (!q) return true;
      return (
        t.id.includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.groupName.toLowerCase().includes(q) ||
        t.toolType.toLowerCase().includes(q)
      );
    });
  }, [directory, query, dirFilter, profileRequiredForFilter]);

  const selected = directory.find((t) => t.id === selectedId) ?? filtered[0] ?? directory[0] ?? null;

  const didBootTools = useRef(false);
  const loadAll = async () => {
    try {
      const loadedProfiles = await reload();
      setLoaded(true);
      setLoadError("");
      if (!didBootTools.current) {
        didBootTools.current = true;
        const params = new URLSearchParams(window.location.search);
        const fromUrl = params.get("tool") || "";
        if (fromUrl) setSelectedId(fromUrl);
        const profileRaw = Number(params.get("profile") || params.get("businessProfileId"));
        if (Number.isInteger(profileRaw) && profileRaw > 0) {
          setBusinessProfileId(profileRaw);
        } else {
          const preferred = loadedProfiles.find((p) => p.isDefault) ?? loadedProfiles[0];
          // Prefer default Business Profile so Live/Hidden KPIs are meaningful on first load.
          if (preferred) setBusinessProfileId(preferred.id);
        }
        // Modules moved to Access Fabric (profile-first tool capabilities).
        if (params.get("tab") === "modules") {
          const href = adminDeepLink.toolCapabilities(
            Number.isInteger(profileRaw) && profileRaw > 0 ? profileRaw : undefined,
            fromUrl || "imsdealer",
          );
          window.location.replace(withBasePath(href));
          return;
        }
        setTab(tabFromSearch(params.get("tab")));
      }
    } catch (e) {
      const text = e instanceof Error ? e.message : "Failed to load tools";
      if (loaded) say(text, "error");
      else setLoadError(text);
    }
  };
  useLiveRefresh(loadAll, { intervalMs: 60_000, deps: [businessProfileId] });

  const placementKeyRef = useRef("");
  const placementSavedRef = useRef({ groupName: "", available: true, openStandalone: true });
  const placementLiveRef = useRef({ groupName, available, openStandalone });
  placementLiveRef.current = { groupName, available, openStandalone };

  useEffect(() => {
    if (!selected) return;
    if (!selectedId) setSelectedId(selected.id);
    const nextGroup = selected.catalog?.groupName || selected.groupName;
    const nextAvailable = selected.catalog?.available ?? true;
    const nextStandalone =
      selected.catalog?.openStandalone ??
      (selected.id === "bos" || selected.id === "imsdealer");
    const key = `${selected.id}:${businessProfileId ?? ""}`;
    const keyChanged = placementKeyRef.current !== key;
    const saved = placementSavedRef.current;
    const live = placementLiveRef.current;
    const isDirty =
      placementKeyRef.current !== "" &&
      (live.groupName !== saved.groupName ||
        live.available !== saved.available ||
        live.openStandalone !== saved.openStandalone);
    if (!keyChanged && isDirty) return;
    placementKeyRef.current = key;
    placementSavedRef.current = {
      groupName: nextGroup,
      available: nextAvailable,
      openStandalone: nextStandalone,
    };
    setGroupName(nextGroup);
    setAvailable(nextAvailable);
    setOpenStandalone(nextStandalone);
  }, [selected, selectedId, businessProfileId]);

  // "New tool" (toolbar or directory) opens the create form — bring it into view and focus the first field.
  const focusCreateForm = useCallback(() => {
    const form = createFormRef.current;
    if (!form) return;
    form.scrollIntoView({ behavior: "smooth", block: "nearest" });
    form.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (creating) focusCreateForm();
  }, [creating, focusCreateForm]);

  function startCreate() {
    if (creating) focusCreateForm();
    else setCreating(true);
  }

  function select(id: string, nextTab = tab) {
    setSelectedId(id);
    setTab(nextTab);
    setMessage("");
    syncUrl(id, nextTab, businessProfileId);
  }

  function goTab(next: Tab) {
    if (!selected) return;
    setTab(next);
    syncUrl(selected.id, next, businessProfileId);
  }

  async function saveActive() {
    const handle =
      tab === "placement"
        ? placementRef.current
        : tab === "pricing"
          ? pricingRef.current
          : schemaRef.current;
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
    if (businessProfileId == null) {
      say("Select a Business Profile before reordering org placement", "error");
      return;
    }
    try {
      await api("/admin/catalog/reorder", {
        method: "POST",
        body: JSON.stringify({
          businessProfileId,
          items: next.map((t, i) => ({ id: t.id, sortOrder: i, groupName: t.groupName })),
        }),
      });
      await reload();
      invalidateAdminData("admin-tools");
    } catch (err) {
      say(err instanceof Error ? err.message : "Reorder failed", "error");
    }
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
    if (businessProfileId == null) {
      say("Select a Business Profile before creating a tool in an org catalog", "error");
      return;
    }
    try {
      await api("/admin/catalog", {
        method: "POST",
        body: JSON.stringify({ id, title, groupName: group, businessProfileId }),
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
      say(`Created ${title}. Configure fields (including formulas), then pricing if needed.`);
    } catch (err) {
      say(err instanceof Error ? err.message : "Create failed", "error");
    }
  }

  const groups = useMemo(
    () => groupItemsByKey(filtered, (t) => t.groupName || "General", groupTools, "All tools"),
    [filtered, groupTools],
  );

  if (!loaded) {
    if (loadError) {
      return (
        <AdminPage title="Catalog" section="Product" sub="Tools · placement · pricing · schema">
          <AdminErrorState message={loadError} onRetry={() => void loadAll()} />
        </AdminPage>
      );
    }
    return <AdminPageSkeleton cards={5} />;
  }

  const dirOptions: ReadonlyArray<{ value: DirFilter; label: string }> = [
    { value: "all", label: "All" },
    { value: "live", label: "Live" },
    { value: "hidden", label: "Hidden" },
    { value: "paid", label: "Paid" },
    { value: "licensed", label: "Licensed" },
  ];

  const tabOptions: ReadonlyArray<{ value: Tab; label: string }> = [
    { value: "placement", label: "Placement" },
    { value: "pricing", label: "Product" },
    { value: "schema", label: "Schema" },
  ];

  const kpiButton = (
    key: DirFilter,
    label: string,
    value: string | number,
    chip: { color: "blue" | "amber" | "mint" | "lavender" | "rose" | "sage"; glyph: string },
    orgOnly = false,
  ) => {
    const disabled = orgOnly && needsOrganization;
    return (
      <button
        type="button"
        className={cx("admin-cc-kpi-btn", dirFilter === key && "is-selected")}
        aria-pressed={dirFilter === key}
        disabled={disabled}
        title={disabled ? "Select a Business Profile" : undefined}
        style={disabled ? { opacity: 0.55, cursor: "not-allowed" } : undefined}
        onClick={() => setDirFilter(key)}
      >
        <KpiCard
          label={label}
          value={value}
          chip={chip}
          delta={disabled ? "Needs a Business Profile" : "Filter directory"}
          deltaTone="muted"
          interactive={!disabled}
        />
      </button>
    );
  };

  return (
    <AdminPage
      title="Catalog"
      section="Product"
      entity={selected?.name}
      sub="Tools · placement · pricing · schema"
      toolbar={
        <>
          <Badge auto tone={needsOrganization ? "amber" : "emerald"}>
            {needsOrganization ? "Platform view" : "Org placement"}
          </Badge>
          <Button variant="primary" size="sm" icon="plus" onClick={startCreate}>
            New tool
          </Button>
          <Link href={adminDeepLink.toolCapabilities(businessProfileId ?? undefined, selectedId || undefined)}>
            <Button variant="ghost" size="sm">
              Access Fabric
            </Button>
          </Link>
          <Link href={adminDeepLink.subscriptions()}>
            <Button variant="secondary" size="sm">
              Plans
            </Button>
          </Link>
          <Link href={adminDeepLink.analytics()}>
            <Button variant="secondary" size="sm">
              Usage analytics
            </Button>
          </Link>
          <Button variant="ghost" size="sm" icon="refresh" onClick={() => void loadAll()}>
            Refresh
          </Button>
        </>
      }
    >
      <Alert tone="blue" title="Catalog workspace">
        Create and configure tools, set Live/Hidden placement, publish product pricing, and grant subscriptions for a
        Business Profile. Packs &amp; platform modes live under{" "}
        <Link className="admin-cc-link" href={adminDeepLink.subscriptions()}>
          Plans &amp; entitlements
        </Link>
        ; module ceilings live on Access Fabric.
      </Alert>

      <AdminSection title="Scope" description="Choose the Business Profile for org placement and licenses.">
        <div className="admin-cc-inline">
          <SelectField
            label="Business Profile (for org placement / licenses)"
            value={businessProfileId ?? ""}
            aria-label="Business Profile for catalog placement"
            onChange={(e) => {
              const v = Number(e.target.value);
              changeProfile(Number.isInteger(v) && v > 0 ? v : null);
            }}
          >
            <option value="">{profiles.length === 0 ? "No profiles" : "Select a Business Profile…"}</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.organizationName ? `${p.organizationName} — ` : ""}
                {p.businessName}
                {p.isDefault ? " (default)" : ""}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Tools / Products grouping"
            value={groupTools ? "on" : "off"}
            disabled={groupingBusy}
            aria-label="Tools and products grouping"
            onChange={(e) => void setToolGrouping(e.target.value === "on")}
          >
            <option value="on">Grouped by category</option>
            <option value="off">Flat list (no groups)</option>
          </SelectField>
        </div>
        {needsOrganization ? (
          <p className="admin-cc-note-text" style={{ marginTop: 10 }}>
            Select a Business Profile to see Live/Hidden placement and licensed counts for that org. Product SKUs and
            schemas are still editable platform-wide.
          </p>
        ) : null}
      </AdminSection>

      <Grid cols={5} min={140} gap={12}>
        {kpiButton("all", "Tools", stats.total, { color: "blue", glyph: "▣" })}
        {kpiButton("live", "Live on home", needsOrganization ? "—" : stats.live, { color: "mint", glyph: "✓" }, true)}
        {kpiButton("hidden", "Hidden", needsOrganization ? "—" : stats.hidden, { color: "lavender", glyph: "◌" }, true)}
        {kpiButton("paid", "Paid products", stats.paid, { color: "amber", glyph: "₹" })}
        {kpiButton("licensed", "Licensed here", needsOrganization ? "—" : stats.licensed, { color: "rose", glyph: "◈" }, true)}
      </Grid>

      {message ? <Alert tone={messageTone === "error" ? "coral" : "emerald"} title={message} /> : null}

      <div className="admin-cc-split">
        <AdminSection
          title="Directory"
          description={
            profileRequiredForFilter
              ? "Needs a Business Profile"
              : `${filtered.length} of ${directory.length} tools shown`
          }
        >
          <div className="admin-cc-stack">
            <SearchInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tools…"
              aria-label="Search tools"
            />
            <AdminTabs aria-label="Directory filter" options={dirOptions} value={dirFilter} onChange={setDirFilter} />
          </div>

          <div className="admin-cc-dir-list">
            {profileRequiredForFilter ? (
              <AdminEmpty
                title="Choose a Business Profile first"
                icon="layers"
                actions={
                  profiles.length > 0 ? (
                    <>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => changeProfile((profiles.find((p) => p.isDefault) ?? profiles[0]).id)}
                      >
                        Use {(profiles.find((p) => p.isDefault) ?? profiles[0]).businessName}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setDirFilter("all")}>
                        Show all tools
                      </Button>
                    </>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => setDirFilter("all")}>
                      Show all tools
                    </Button>
                  )
                }
              >
                {dirFilter === "licensed" ? "Licensed" : dirFilter === "live" ? "Live" : "Hidden"} is evaluated per
                Business Profile. Pick one in Scope above to see which tools are{" "}
                {dirFilter === "licensed" ? "licensed" : dirFilter === "live" ? "live on its home" : "hidden from it"}.
              </AdminEmpty>
            ) : groups.length === 0 ? (
              <AdminEmpty title="No tools match" icon="search">
                No tools match this filter.
              </AdminEmpty>
            ) : (
              groups.map(([group, rows]) => (
                <div key={group} className="admin-cc-stack">
                  {groupTools ? <div className="bos-block-label">{group}</div> : null}
                  {rows.map((t) => {
                    const active = selected?.id === t.id;
                    return (
                      <button
                        type="button"
                        key={t.id}
                        className={cx("admin-cc-row", active && "is-selected")}
                        aria-pressed={active}
                        onClick={() => {
                          select(t.id);
                          revealDetail();
                        }}
                      >
                        <div className="admin-cc-row-main">
                          <div className="admin-cc-cell-title">{t.name}</div>
                          <div className="admin-cc-cell-sub">{t.id}</div>
                        </div>
                        <div className="admin-cc-row-badges">
                          <Badge
                            auto
                            tone={needsOrganization ? "neutral" : t.catalog?.available === false ? "neutral" : "emerald"}
                          >
                            {needsOrganization ? "Platform" : t.catalog?.available === false ? "Hidden" : "Live"}
                          </Badge>
                          {t.sku?.includedFree ? (
                            <Badge auto tone="neutral">
                              Incl.
                            </Badge>
                          ) : t.licensed ? (
                            <Badge auto tone="emerald">
                              Lic.
                            </Badge>
                          ) : t.sku?.accessPolicy === "hard_lock" ? (
                            <Badge auto tone="coral">
                              Lock
                            </Badge>
                          ) : t.sku ? (
                            <Badge auto tone="amber">
                              Paid
                            </Badge>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {creating ? (
            <form
              ref={createFormRef}
              className="admin-cc-form"
              style={{ marginTop: 14 }}
              onSubmit={(e) => void createTool(e)}
            >
              <div className="bos-block-label">Create tool</div>
              <TextField
                label="Tool id"
                value={newId}
                onChange={(e) => setNewId(e.target.value)}
                placeholder="id e.g. leadtracker"
                required
                pattern="[a-z][a-z0-9_]*"
              />
              <TextField label="Title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Title" required />
              <TextField
                label="Description"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Short description"
              />
              <TextField
                label="Group"
                value={newGroup}
                onChange={(e) => setNewGroup(e.target.value)}
                placeholder="Group e.g. Sales"
                required
              />
              <SelectField
                label="Starter schema"
                value={newTemplate}
                onChange={(e) => setNewTemplate(e.target.value as "blank" | "line_items")}
              >
                <option value="blank">Blank (name + notes)</option>
                <option value="line_items">Line items + amount formula</option>
              </SelectField>
              <div className="admin-cc-actions" style={{ justifyContent: "flex-start" }}>
                <Button type="submit" variant="primary" size="sm">
                  Create
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div style={{ marginTop: 14 }}>
              <Button variant="secondary" size="sm" icon="plus" onClick={startCreate}>
                New tool
              </Button>
            </div>
          )}
        </AdminSection>

        <div ref={detailRef} className="admin-cc-split-stack">
          {selected ? (
            <>
              <section className="bos-widget admin-cc-section">
                <div className="admin-cc-detail-head">
                  <div>
                    <div style={{ marginBottom: 6 }}>
                      <Badge auto tone="blue">
                        {selected.toolType}
                      </Badge>
                    </div>
                    <h3 className="admin-cc-detail-title">{selected.name}</h3>
                    <p className="admin-cc-detail-sub">{selected.id}</p>
                  </div>
                  <div className="admin-cc-actions">
                    <Link href={adminDeepLink.analyticsTool(selected.id)}>
                      <Button variant="secondary" size="sm">
                        Analytics
                      </Button>
                    </Link>
                    <Button variant="ghost" size="sm" onClick={() => void move(selected.id, -1)}>
                      Move up
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void move(selected.id, 1)}>
                      Move down
                    </Button>
                  </div>
                </div>

                <div className="admin-cc-tabs-bar" style={{ marginBottom: 0 }}>
                  <AdminTabs aria-label="Tool section" options={tabOptions} value={tab} onChange={goTab} />
                  <div className="admin-cc-actions">
                    <Link href={adminDeepLink.toolCapabilities(businessProfileId ?? undefined, selected.id)}>
                      <Button variant="ghost">Capabilities</Button>
                    </Link>
                    <Button variant="primary" disabled={saving} onClick={() => void saveActive()}>
                      {saving ? "Saving…" : saveLabel}
                    </Button>
                  </div>
                </div>
              </section>

              <div hidden={tab !== "placement"}>
                <div className="admin-cc-split-stack">
                <ToolPlacementPane
                  ref={placementRef}
                  toolId={selected.id}
                  groupName={groupName}
                  available={available}
                  openStandalone={openStandalone}
                  businessProfileId={businessProfileId}
                  onGroupName={setGroupName}
                  onAvailable={setAvailable}
                  onOpenStandalone={setOpenStandalone}
                  onSaved={async (msg, tone) => {
                    if (tone !== "error") {
                      placementSavedRef.current = { groupName, available, openStandalone };
                    }
                    say(msg, tone ?? "success");
                    await reload();
                    invalidateAdminData("admin-tools");
                  }}
                />
                <FeatureSwitchesPanel
                  toolId={selected.id}
                  toolName={selected.name}
                  toolLive={selected.catalog?.available === true}
                  businessProfileId={businessProfileId}
                />
                </div>
              </div>

              <div hidden={tab !== "pricing"}>
                <ToolPricingPane
                  ref={pricingRef}
                  toolId={selected.id}
                  toolName={selected.name}
                  toolCategory={selected.groupName}
                  sku={selected.sku}
                  licensed={selected.licensed}
                  periodEnd={selected.periodEnd}
                  recordLimitOverride={selected.recordLimitOverride}
                  profiles={profiles}
                  businessProfileId={businessProfileId}
                  onBusinessProfileChange={changeProfile}
                  seatCount={selected.seatCount}
                  bundles={bundles}
                  onReload={async () => {
                    await reload();
                    invalidateAdminData("admin-tools");
                  }}
                  onMessage={(msg, tone) => say(msg, tone ?? "success")}
                />
              </div>

              <div hidden={tab !== "schema"}>
                <ToolSchemaPane
                  ref={schemaRef}
                  toolId={selected.id}
                  toolType={selected.toolType}
                  definition={selected.definition}
                  onPublished={async (msg, tone) => {
                    say(msg, tone ?? "success");
                    await reload();
                    invalidateAdminData("admin-tools");
                  }}
                />
              </div>
            </>
          ) : (
            <AdminSection title="Tool detail">
              <AdminEmpty title="No tool selected" icon="search">
                Pick a tool from the directory.
              </AdminEmpty>
            </AdminSection>
          )}
        </div>
      </div>
    </AdminPage>
  );
}
