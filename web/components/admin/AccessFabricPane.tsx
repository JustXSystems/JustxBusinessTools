"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  ProgressBar,
  SearchInput,
  Switch,
  cx,
  type BosBadgeTone,
} from "@/components/bos";
import {
  AdminEmpty,
  AdminErrorState,
  AdminGlossary,
  AdminSection,
  AdminTabs,
  useAdminConfirm,
} from "@/components/admin/ui";
import { TextField } from "@/components/admin/ui/AdminFields";
import {
  ToolCapabilityLattice,
  type ToolCapabilityLatticeHandle,
} from "@/components/admin/ToolCapabilityLattice";
import { uniqueTools } from "@/config/tools.config";
import { adminDeepLink } from "@/lib/admin-deep-links";
import { ensureToolsOnHome } from "@/lib/admin-home-tools";
import { api } from "@/lib/api";
import {
  computeAccessReadiness,
  signalFor,
  type AccessAction,
  type FabricCapabilityTool,
  type FabricPack,
  type FabricToolNode,
} from "@/lib/access-fabric";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";

type SkuRow = {
  toolId: string;
  name: string;
  category: string;
  priceInr: number;
  includedFree: boolean;
  available: boolean;
  trialDays?: number;
  accessPolicy?: "soft_cap" | "hard_lock";
  unlicensedRecordLimit?: number | null;
};

type LicenseRow = {
  toolId: string;
  name: string;
  status: string;
  periodEnd: string | null;
  recordLimitOverride?: number | null;
};

type BundleRow = {
  id: string;
  name: string;
  tagline: string | null;
  priceInr: number;
  listPriceInr: number;
  available: boolean;
  highlighted: boolean;
  toolIds: string[];
};

function inr(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

function ringTone(tone: "ok" | "warn" | "bad") {
  if (tone === "ok") return "var(--bos-emerald)";
  if (tone === "warn") return "var(--bos-amber)";
  return "var(--bos-coral)";
}

type FabricFilter = "all" | "dim" | "licensed" | "orphan" | "locked";

function signalTone(signal: string): BosBadgeTone {
  if (signal === "included") return "emerald";
  if (signal === "licensed") return "blue";
  if (signal === "locked") return "coral";
  if (signal === "orphan") return "amber";
  return "neutral";
}

const SIGNAL_LABEL: Record<string, string> = {
  included: "Included",
  licensed: "Licensed",
  locked: "Locked",
  orphan: "On home unlicensed",
  dim: "Gap",
};

export function AccessFabricPane({
  businessProfileId,
  profileName,
  identityCompleteness,
  approvalStatus,
  peopleGranted,
  peopleTotal,
  homeToolIds,
  focusToolId,
  onNavigate,
  onMutated,
  onHomeToolsChange,
  onSelectedToolIdChange,
}: {
  businessProfileId: number;
  profileName: string;
  identityCompleteness: number;
  approvalStatus: string;
  peopleGranted: number;
  peopleTotal: number;
  homeToolIds: string[];
  focusToolId?: string | null;
  onNavigate?: (target: "home" | "people" | "identity" | "lifecycle") => void;
  onMutated?: () => void | Promise<void>;
  onHomeToolsChange?: (ids: string[]) => void;
  onSelectedToolIdChange?: (toolId: string | null) => void;
}) {
  const [skus, setSkus] = useState<SkuRow[]>([]);
  const [licenses, setLicenses] = useState<LicenseRow[]>([]);
  const [entitlements, setEntitlements] = useState<LicenseRow[]>([]);
  const [bundles, setBundles] = useState<BundleRow[]>([]);
  const [capabilityTools, setCapabilityTools] = useState<FabricCapabilityTool[]>([]);
  const [selectedToolId, setSelectedToolIdState] = useState<string | null>(null);
  function setSelectedToolId(toolId: string | null) {
    setSelectedToolIdState(toolId);
    onSelectedToolIdChange?.(toolId);
  }
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FabricFilter>("all");
  const [days, setDays] = useState("30");
  const [syncHome, setSyncHome] = useState(true);
  const [profileLimit, setProfileLimit] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const { confirm, dialog: confirmDialog } = useAdminConfirm();
  const capabilitiesRef = useRef<ToolCapabilityLatticeHandle>(null);
  const didFocusRef = useRef<string | null>(null);

  const reload = useCallback(async () => {
    const data = await api<{
      skus: SkuRow[];
      licenses: LicenseRow[];
      entitlements?: LicenseRow[];
      bundles?: BundleRow[];
    }>(`/admin/skus?businessProfileId=${businessProfileId}`);
    setSkus(data.skus);
    setLicenses(data.licenses);
    setEntitlements(data.entitlements ?? []);
    setBundles(data.bundles ?? []);
  }, [businessProfileId]);

  useLiveRefresh(
    () =>
      reload().catch((e: Error) => {
        setError(e.message);
      }),
    { intervalMs: 60_000, deps: [businessProfileId] },
  );

  const tools = useMemo((): FabricToolNode[] => {
    const names = new Map(uniqueTools().map((t) => [t.id, t]));
    const skuById = new Map(skus.map((s) => [s.toolId, s]));
    const activeById = new Map(licenses.map((l) => [l.toolId, l]));
    const entById = new Map(entitlements.map((l) => [l.toolId, l]));
    const home = new Set(homeToolIds);
    const ids = new Set<string>([
      ...names.keys(),
      ...skuById.keys(),
      ...activeById.keys(),
      ...entById.keys(),
    ]);
    return Array.from(ids)
      .map((toolId) => {
        const fallback = names.get(toolId);
        const sku = skuById.get(toolId);
        const lic = activeById.get(toolId);
        const ent = entById.get(toolId);
        const includedFree = Boolean(sku?.includedFree);
        return {
          toolId,
          name: sku?.name || fallback?.name || toolId,
          category: sku?.category || fallback?.category || "General",
          includedFree,
          licensed: includedFree || Boolean(lic && lic.status === "active"),
          periodEnd: lic?.periodEnd ?? null,
          hardLock: sku?.accessPolicy === "hard_lock",
          onHome: home.has(toolId),
          hasSku: Boolean(sku),
          priceInr: sku?.priceInr ?? 0,
          trialDays: sku?.trialDays ?? 14,
          recordLimitOverride: ent?.recordLimitOverride ?? lic?.recordLimitOverride ?? null,
          unlicensedRecordLimit: sku?.unlicensedRecordLimit ?? null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [skus, licenses, entitlements, homeToolIds]);

  const packs = useMemo(
    (): FabricPack[] =>
      bundles.map((b) => ({
        id: b.id,
        name: b.name,
        tagline: b.tagline,
        toolIds: b.toolIds,
        priceInr: b.priceInr,
        listPriceInr: b.listPriceInr,
        available: b.available,
        highlighted: b.highlighted,
      })),
    [bundles],
  );

  const readiness = useMemo(
    () =>
      computeAccessReadiness({
        identityCompleteness,
        approvalStatus,
        peopleGranted,
        peopleTotal,
        homeToolIds,
        tools,
        packs,
        capabilityTools,
      }),
    [
      identityCompleteness,
      approvalStatus,
      peopleGranted,
      peopleTotal,
      homeToolIds,
      tools,
      packs,
      capabilityTools,
    ],
  );

  const capById = useMemo(
    () => new Map(capabilityTools.map((c) => [c.toolId, c])),
    [capabilityTools],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tools.filter((t) => {
      if (q && !`${t.name} ${t.toolId} ${t.category}`.toLowerCase().includes(q)) return false;
      const signal = signalFor(t);
      if (filter === "dim") return signal === "dim";
      if (filter === "licensed") return signal === "licensed" || signal === "included";
      if (filter === "orphan") return signal === "orphan";
      if (filter === "locked") return signal === "locked";
      return true;
    });
  }, [tools, query, filter]);

  // Prefer explicit focus, then gaps, then first visible — once per profile / focus change.
  // Wait until the focused tool exists before marking applied, then stop re-forcing selection.
  useEffect(() => {
    const focusKey = `${businessProfileId}:${focusToolId ?? ""}`;
    if (tools.length === 0) return;
    if (didFocusRef.current === focusKey) return;

    if (focusToolId) {
      if (!tools.some((t) => t.toolId === focusToolId)) return;
      setSelectedToolId(focusToolId);
      didFocusRef.current = focusKey;
      return;
    }

    const gap = tools.find((t) => signalFor(t) === "dim" || signalFor(t) === "orphan");
    const next = gap?.toolId ?? tools[0]?.toolId ?? null;
    setSelectedToolId(next);
    didFocusRef.current = focusKey;
  }, [businessProfileId, focusToolId, tools]);

  const selected = useMemo(
    () => tools.find((t) => t.toolId === selectedToolId) ?? null,
    [tools, selectedToolId],
  );

  const nextAction = readiness.actions[0] ?? null;

  async function run(key: string, label: string, fn: () => Promise<void>) {
    setBusyKey(key);
    setMessage("");
    setError("");
    try {
      await fn();
      setMessage(label);
      await reload();
      await onMutated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyKey(null);
    }
  }

  function grantDays() {
    return Math.max(1, Math.floor(Number(days) || 30));
  }

  async function syncToolsHome(toolIds: string[]) {
    if (!syncHome || toolIds.length === 0) return;
    const nextHome = await ensureToolsOnHome(businessProfileId, toolIds, homeToolIds);
    onHomeToolsChange?.(nextHome);
  }

  async function provisionPack(packId: string) {
    const match = readiness.packs.find((p) => p.pack.id === packId);
    await run(packId, `Provisioned ${match?.pack.name ?? packId}.`, async () => {
      const granted = await api<{ granted?: string[] }>("/admin/skus/grant", {
        method: "POST",
        body: JSON.stringify({
          bundleId: packId,
          days: grantDays(),
          businessProfileId,
        }),
      });
      const syncIds =
        (Array.isArray(granted.granted) && granted.granted.length > 0
          ? granted.granted
          : match?.resolvedToolIds.length
            ? match.resolvedToolIds
            : match?.missing) ?? [];
      await syncToolsHome(syncIds);
      await capabilitiesRef.current?.reload();
    });
  }

  function requestProvisionPack(packId: string) {
    const match = readiness.packs.find((p) => p.pack.id === packId);
    const names = new Map(tools.map((t) => [t.toolId, t.name]));
    const missing = match?.missing ?? [];
    const shown = missing.slice(0, 6).map((id) => names.get(id) ?? id);
    const more = missing.length - shown.length;
    const packName = match?.pack.name ?? packId;
    confirm({
      title: `Provision ${packName}?`,
      description: (
        <>
          Grants {missing.length > 0 ? <strong>{missing.length} tool license{missing.length === 1 ? "" : "s"}</strong> : "the pack's tool licenses"} to{" "}
          <strong>{profileName}</strong> for <strong>{grantDays()} days</strong>
          {missing.length > 0 ? `: ${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}` : ""}.
          {syncHome ? " Granted tools are also added to this profile's home." : ""}
        </>
      ),
      confirmLabel: "Provision pack",
      tone: "primary",
      onConfirm: () => provisionPack(packId),
    });
  }

  function requestRevoke(node: FabricToolNode) {
    confirm({
      title: `Revoke ${node.name}?`,
      description: (
        <>
          Removes the license for <strong>{node.name}</strong> from <strong>{profileName}</strong>. The profile loses
          access to this tool until it is licensed again
          {node.onHome ? "; it stays on the home list but shows as unlicensed" : ""}.
        </>
      ),
      confirmLabel: "Revoke license",
      onConfirm: () =>
        run(node.toolId, `Revoked ${node.name}.`, async () => {
          await api("/admin/skus/revoke", {
            method: "POST",
            body: JSON.stringify({
              toolIds: [node.toolId],
              businessProfileId,
            }),
          });
          await capabilitiesRef.current?.reload();
        }),
    });
  }

  function handleAction(action: AccessAction) {
    if (action.action === "grant-pack" && action.packId) {
      requestProvisionPack(action.packId);
      return;
    }
    if (action.action === "open-home") onNavigate?.("home");
    if (action.action === "open-people") onNavigate?.("people");
    if (action.action === "open-identity") onNavigate?.("identity");
    if (action.action === "open-lifecycle") onNavigate?.("lifecycle");
    if (action.action === "open-capabilities") {
      if (action.toolId) setSelectedToolId(action.toolId);
      capabilitiesRef.current?.focusTool(action.toolId);
    }
  }

  async function grantCapabilityTool(toolId: string) {
    const node = tools.find((t) => t.toolId === toolId);
    const name = node?.name ?? toolId;
    await run(toolId, `Licensed ${name}.`, async () => {
      await api("/admin/skus/grant", {
        method: "POST",
        body: JSON.stringify({
          toolIds: [toolId],
          days: grantDays(),
          businessProfileId,
        }),
      });
      await syncToolsHome([toolId]);
      setSelectedToolId(toolId);
      await capabilitiesRef.current?.reload();
    });
  }

  async function saveSelectedRecordLimit() {
    if (!selected) return;
    await run(selected.toolId, "Record-limit override saved.", async () => {
      const recordLimit =
        profileLimit.trim() === "" ? null : Math.max(0, Math.floor(Number(profileLimit)));
      if (recordLimit != null && Number.isNaN(recordLimit)) {
        throw new Error("Record limit must be a number or blank");
      }
      await api("/admin/skus/record-limit", {
        method: "POST",
        body: JSON.stringify({
          businessProfileId,
          toolId: selected.toolId,
          recordLimit,
        }),
      });
    });
  }

  const selectedSignal = selected ? signalFor(selected) : null;
  const selectedCap = selected ? capById.get(selected.toolId) : undefined;
  const busy = busyKey != null;

  useEffect(() => {
    if (!selected) {
      setProfileLimit("");
      return;
    }
    setProfileLimit(
      selected.recordLimitOverride == null ? "" : String(selected.recordLimitOverride),
    );
  }, [selected?.toolId, selected?.recordLimitOverride]);

  const grantSelected = (preferTrial: boolean) => {
    if (!selected) return;
    void run(
      selected.toolId,
      preferTrial ? `Trial for ${selected.name}.` : `Licensed ${selected.name}.`,
      async () => {
        await api("/admin/skus/grant", {
          method: "POST",
          body: JSON.stringify(
            preferTrial
              ? {
                  toolIds: [selected.toolId],
                  days: selected.trialDays || 14,
                  preferTrial: true,
                  businessProfileId,
                }
              : {
                  toolIds: [selected.toolId],
                  days: grantDays(),
                  businessProfileId,
                },
          ),
        });
        await syncToolsHome([selected.toolId]);
        await capabilitiesRef.current?.reload();
      },
    );
  };

  const filterOptions: ReadonlyArray<{ value: FabricFilter; label: string }> = [
    { value: "all", label: "All" },
    { value: "dim", label: "Gaps" },
    { value: "licensed", label: "Licensed" },
    { value: "locked", label: "Locked" },
    { value: "orphan", label: "On home unlicensed" },
  ];

  return (
    <div className="admin-cc-fab" id="ax-fabric">
      <AdminGlossary />
      <Card className="admin-cc-pad">
        <div className="admin-cc-fab-strip" aria-label="Access readiness">
          <div
            className="admin-cc-ring"
            style={
              {
                "--pct": readiness.score,
                "--ring": ringTone(readiness.tone),
              } as CSSProperties
            }
            role="img"
            aria-label={`Access readiness ${readiness.score} grade ${readiness.grade}`}
          >
            <div>
              <b>{readiness.score}</b>
              <small>{readiness.grade}</small>
            </div>
          </div>

          <div className="admin-cc-fab-main">
            <div className="admin-cc-subhead" style={{ margin: 0 }}>
              Access Fabric
            </div>
            <h3 className="admin-cc-fab-title">{profileName}</h3>
            <div className="admin-cc-layers" aria-label="Layer scores">
              {readiness.layers.map((layer) => (
                <div key={layer.id} title={`${layer.label}: ${layer.detail}`}>
                  <div className="admin-cc-layer-label">
                    <span>{layer.label}</span>
                    <strong>{layer.score}</strong>
                  </div>
                  <ProgressBar
                    value={layer.score}
                    tone={layer.score >= 80 ? "emerald" : layer.score >= 50 ? "amber" : "coral"}
                    label={`${layer.label} ${layer.score}`}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="admin-cc-fab-controls">
            <TextField
              label="Days"
              type="number"
              min={1}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              aria-label="Grant window days"
            />
            <label className="admin-cc-switch-row">
              <Switch checked={syncHome} onChange={setSyncHome} aria-label="Sync home" />
              <span>Sync home</span>
            </label>
            <Link href={adminDeepLink.tools(selectedToolId ?? undefined, "pricing", businessProfileId)}>
              <Button variant="ghost" size="sm">
                Catalog
              </Button>
            </Link>
            <Link href={adminDeepLink.subscriptions()}>
              <Button variant="ghost" size="sm">
                Packs
              </Button>
            </Link>
          </div>
        </div>
      </Card>

      {nextAction ? (
        <Alert
          tone="blue"
          title={nextAction.title}
          actions={
            nextAction.action || nextAction.packId ? (
              <Button variant="primary" size="sm" disabled={busy} onClick={() => handleAction(nextAction)}>
                {nextAction.action === "grant-pack" ? "Provision" : "Open"}
              </Button>
            ) : undefined
          }
        >
          {nextAction.detail}
        </Alert>
      ) : null}

      {readiness.packs.length > 0 ? (
        <div className="admin-cc-packs" aria-label="Packs">
          {readiness.packs.map((match) => (
            <button
              key={match.pack.id}
              type="button"
              className={cx("admin-cc-pack", match.recommended && "is-recommended")}
              disabled={busy || match.missing.length === 0}
              title={match.pack.tagline ?? match.pack.name}
              onClick={() => requestProvisionPack(match.pack.id)}
            >
              <strong>{match.pack.name}</strong>
              <span>
                {match.coveragePct}%
                {match.missing.length ? ` · +${match.missing.length}` : ""}
                {match.pack.priceInr ? ` · ${inr(match.pack.priceInr)}` : ""}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <AdminErrorState title="Action failed" message={error} />
      ) : message ? (
        <Alert tone="emerald" title={message} />
      ) : null}

      <div className="admin-cc-fab-work" id="ax-tool-lattice">
        <AdminSection title="Tools" description={`${visible.length} of ${tools.length} shown`}>
          <div className="admin-cc-stack">
            <SearchInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find tool…"
              aria-label="Search tools"
            />
            <AdminTabs aria-label="Tool filter" options={filterOptions} value={filter} onChange={setFilter} />
          </div>

          <ul className="admin-cc-roster-list" aria-label="Tools">
            {visible.map((node) => {
              const signal = signalFor(node);
              const cap = capById.get(node.toolId);
              const active = node.toolId === selectedToolId;
              return (
                <li key={node.toolId}>
                  <button
                    type="button"
                    className={cx("admin-cc-roster-row", active && "is-active")}
                    data-signal={signal}
                    aria-pressed={active}
                    onClick={() => setSelectedToolId(node.toolId)}
                  >
                    <span>
                      <span className="admin-cc-cell-title">{node.name}</span>
                      <span className="admin-cc-cell-sub" style={{ display: "block" }}>
                        {node.category}
                      </span>
                    </span>
                    <span className="admin-cc-roster-meta">
                      <Badge auto tone={signalTone(signal)}>
                        {SIGNAL_LABEL[signal] ?? signal}
                      </Badge>
                      {cap?.hasCeiling && cap.entitled && cap.coveragePct != null ? (
                        <Badge auto tone="neutral">
                          {cap.coveragePct}%
                        </Badge>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {visible.length === 0 ? (
            <AdminEmpty title="No tools match" icon="search">
              Try a different search or filter.
            </AdminEmpty>
          ) : null}
        </AdminSection>

        {!selected ? (
          <AdminSection title="Tool inspector">
            <AdminEmpty title="Select a tool" icon="sparkle">
              Pick a tool from the list to license it and tune module ceilings.
            </AdminEmpty>
          </AdminSection>
        ) : (
          <AdminSection
            title={selected.name}
            description={
              <>
                {selected.category} · <code className="admin-cc-code">{selected.toolId}</code>
                {selected.hasSku && !selected.includedFree ? ` · ${inr(selected.priceInr)}/mo` : ""}
                {selected.periodEnd ? ` · until ${selected.periodEnd.slice(0, 10)}` : ""}
                {selected.onHome ? " · on home" : ""}
                {selectedSignal ? ` · ${SIGNAL_LABEL[selectedSignal]}` : ""}
              </>
            }
            actions={
              <>
                {selected.includedFree ? (
                  <Badge auto tone="emerald">
                    Included free
                  </Badge>
                ) : selected.licensed ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void run(selected.toolId, `Extended ${selected.name}.`, async () => {
                          await api("/admin/skus/extend", {
                            method: "POST",
                            body: JSON.stringify({
                              toolIds: [selected.toolId],
                              days: grantDays(),
                              businessProfileId,
                            }),
                          });
                        })
                      }
                    >
                      Extend
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={busy}
                      onClick={() => requestRevoke(selected)}
                    >
                      Revoke
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="primary" size="sm" disabled={busy} onClick={() => grantSelected(false)}>
                      Grant
                    </Button>
                    <Button variant="secondary" size="sm" disabled={busy} onClick={() => grantSelected(true)}>
                      Trial
                    </Button>
                  </>
                )}
                <Link href={adminDeepLink.tools(selected.toolId, "pricing", businessProfileId)}>
                  <Button variant="ghost" size="sm">
                    Product
                  </Button>
                </Link>
              </>
            }
          >
            <div className="admin-cc-fab-body">
              <div className="admin-cc-inline">
                <TextField
                  label="Profile record-limit override"
                  type="number"
                  min={0}
                  step="1"
                  value={profileLimit}
                  disabled={busy}
                  placeholder={
                    selected.unlicensedRecordLimit != null
                      ? `SKU default ${selected.unlicensedRecordLimit}`
                      : "Platform default"
                  }
                  hint="Blank clears override"
                  onChange={(e) => setProfileLimit(e.target.value)}
                />
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => void saveSelectedRecordLimit()}>
                  Save override
                </Button>
                {selected.recordLimitOverride != null ? (
                  <Badge auto tone="blue">
                    Active {selected.recordLimitOverride}
                  </Badge>
                ) : null}
              </div>

              {selectedCap?.hasCeiling ? (
                <p className="admin-cc-note-text">
                  Module ceiling
                  {selectedCap.entitled
                    ? selectedCap.unrestricted
                      ? " · unrestricted"
                      : ` · curated ${selectedCap.coveragePct ?? 0}%`
                    : " · locked until licensed"}
                </p>
              ) : null}

              <ToolCapabilityLattice
                ref={capabilitiesRef}
                businessProfileId={businessProfileId}
                selectedToolId={selectedToolId}
                onSelectedToolIdChange={setSelectedToolId}
                onSummary={setCapabilityTools}
                onRequestGrant={(toolId) => grantCapabilityTool(toolId)}
              />
            </div>
          </AdminSection>
        )}
      </div>
      {confirmDialog}
    </div>
  );
}

