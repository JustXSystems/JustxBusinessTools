"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
  if (tone === "ok") return "var(--success)";
  if (tone === "warn") return "var(--warning)";
  return "var(--danger)";
}

const SIGNAL_LABEL: Record<string, string> = {
  included: "Included",
  licensed: "Signal",
  locked: "Lock",
  orphan: "Orphan",
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
  const [filter, setFilter] = useState<"all" | "dim" | "licensed" | "orphan" | "locked">("all");
  const [days, setDays] = useState("30");
  const [syncHome, setSyncHome] = useState(true);
  const [profileLimit, setProfileLimit] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
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

  function handleAction(action: AccessAction) {
    if (action.action === "grant-pack" && action.packId) {
      void provisionPack(action.packId);
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

  return (
    <div className="ax-fabric ax-cockpit">
      <header className="ax-strip" aria-label="Access readiness">
        <div
          className="ax-readiness-ring ax-readiness-ring-sm"
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

        <div className="ax-strip-main">
          <div className="ax-strip-title">
            <p className="ax-eyebrow">Access Fabric</p>
            <h3>{profileName}</h3>
          </div>
          <div className="ax-layer-dots" aria-label="Layer scores">
            {readiness.layers.map((layer) => (
              <div key={layer.id} className="ax-layer-dot" title={`${layer.label}: ${layer.detail}`}>
                <span>{layer.label}</span>
                <strong>{layer.score}</strong>
                <i aria-hidden>
                  <b style={{ width: `${layer.score}%` }} />
                </i>
              </div>
            ))}
          </div>
        </div>

        <div className="ax-strip-controls">
          <label className="ax-inline-field">
            <span>Days</span>
            <input
              type="number"
              min={1}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              aria-label="Grant window days"
            />
          </label>
          <label className="ax-check ax-check-compact">
            <input
              type="checkbox"
              checked={syncHome}
              onChange={(e) => setSyncHome(e.target.checked)}
            />
            <span>Sync home</span>
          </label>
          <Link
            href={adminDeepLink.tools(selectedToolId ?? undefined, "pricing", businessProfileId)}
            className="btn btn-ghost btn-sm"
          >
            Catalog
          </Link>
          <Link href={adminDeepLink.subscriptions()} className="btn btn-ghost btn-sm">
            Packs
          </Link>
        </div>
      </header>

      {nextAction ? (
        <div className="ax-next-chip" role="status">
          <div>
            <strong>{nextAction.title}</strong>
            <span className="muted">{nextAction.detail}</span>
          </div>
          {nextAction.action || nextAction.packId ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={() => handleAction(nextAction)}
            >
              {nextAction.action === "grant-pack" ? "Provision" : "Open"}
            </button>
          ) : null}
        </div>
      ) : null}

      {readiness.packs.length > 0 ? (
        <div className="ax-pack-strip" aria-label="Packs">
          {readiness.packs.map((match) => (
            <button
              key={match.pack.id}
              type="button"
              className={`ax-pack-chip${match.recommended ? " is-recommended" : ""}`}
              disabled={busy || match.missing.length === 0}
              title={match.pack.tagline ?? match.pack.name}
              onClick={() => void provisionPack(match.pack.id)}
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

      {(message || error) && (
        <p className={error ? "field-error" : "muted ax-cap-flash"}>{error || message}</p>
      )}

      <div className="ax-workspace" id="ax-tool-lattice">
        <aside className="ax-roster" aria-label="Tools">
          <div className="ax-roster-toolbar">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find tool…"
              aria-label="Search tools"
            />
            <div className="admin-tabs ax-lattice-filters" role="tablist" aria-label="Filter">
              {(
                [
                  ["all", "All"],
                  ["dim", "Gaps"],
                  ["licensed", "On"],
                  ["locked", "Locks"],
                  ["orphan", "Home"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  className={filter === id ? "active" : ""}
                  onClick={() => setFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <ul className="ax-roster-list">
            {visible.map((node) => {
              const signal = signalFor(node);
              const cap = capById.get(node.toolId);
              const active = node.toolId === selectedToolId;
              return (
                <li key={node.toolId}>
                  <button
                    type="button"
                    className={`ax-roster-row${active ? " is-active" : ""}`}
                    data-signal={signal}
                    onClick={() => setSelectedToolId(node.toolId)}
                  >
                    <span className="ax-roster-name">
                      <strong>{node.name}</strong>
                      <em>{node.category}</em>
                    </span>
                    <span className="ax-roster-meta">
                      <span className="ax-node-signal">{SIGNAL_LABEL[signal] ?? signal}</span>
                      {cap?.hasCeiling && cap.entitled && cap.coveragePct != null ? (
                        <span className="ax-roster-cap">{cap.coveragePct}%</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
            {visible.length === 0 ? (
              <li className="ax-roster-empty muted">No tools match.</li>
            ) : null}
          </ul>
        </aside>

        <section className="ax-inspector" aria-label="Tool inspector">
          {!selected ? (
            <div className="ax-inspector-empty">
              <p className="muted">Select a tool from the list.</p>
            </div>
          ) : (
            <>
              <div className="ax-inspector-head">
                <div>
                  <p className="ax-eyebrow">{selected.category}</p>
                  <h4>{selected.name}</h4>
                  <p className="muted">
                    <code>{selected.toolId}</code>
                    {selected.hasSku && !selected.includedFree ? ` · ${inr(selected.priceInr)}/mo` : ""}
                    {selected.periodEnd ? ` · until ${selected.periodEnd.slice(0, 10)}` : ""}
                    {selected.onHome ? " · on home" : ""}
                    {selectedSignal ? ` · ${SIGNAL_LABEL[selectedSignal]}` : ""}
                  </p>
                </div>
                <div className="ax-inspector-actions">
                  {selected.includedFree ? (
                    <span className="pill">Included free</span>
                  ) : selected.licensed ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
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
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() =>
                          void run(selected.toolId, `Revoked ${selected.name}.`, async () => {
                            await api("/admin/skus/revoke", {
                              method: "POST",
                              body: JSON.stringify({
                                toolIds: [selected.toolId],
                                businessProfileId,
                              }),
                            });
                            await capabilitiesRef.current?.reload();
                          })
                        }
                      >
                        Revoke
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={busy}
                        onClick={() =>
                          void run(selected.toolId, `Licensed ${selected.name}.`, async () => {
                            await api("/admin/skus/grant", {
                              method: "POST",
                              body: JSON.stringify({
                                toolIds: [selected.toolId],
                                days: grantDays(),
                                businessProfileId,
                              }),
                            });
                            await syncToolsHome([selected.toolId]);
                            await capabilitiesRef.current?.reload();
                          })
                        }
                      >
                        Grant
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() =>
                          void run(selected.toolId, `Trial for ${selected.name}.`, async () => {
                            await api("/admin/skus/grant", {
                              method: "POST",
                              body: JSON.stringify({
                                toolIds: [selected.toolId],
                                days: selected.trialDays || 14,
                                preferTrial: true,
                                businessProfileId,
                              }),
                            });
                            await syncToolsHome([selected.toolId]);
                            await capabilitiesRef.current?.reload();
                          })
                        }
                      >
                        Trial
                      </button>
                    </>
                  )}
                  <Link
                    href={adminDeepLink.tools(selected.toolId, "pricing", businessProfileId)}
                    className="btn btn-ghost btn-sm"
                  >
                    Product
                  </Link>
                </div>
              </div>

              <div className="ax-inspector-body">
                <div className="admin-form-grid ax-record-limit">
                  <label className="field">
                    <span>Profile record-limit override</span>
                    <input
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
                      onChange={(e) => setProfileLimit(e.target.value)}
                    />
                  </label>
                  <div className="admin-form-row" style={{ alignItems: "end" }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busy}
                      onClick={() => void saveSelectedRecordLimit()}
                    >
                      Save override
                    </button>
                    {selected.recordLimitOverride != null ? (
                      <span className="pill">Active {selected.recordLimitOverride}</span>
                    ) : (
                      <span className="muted small">Blank clears override</span>
                    )}
                  </div>
                </div>

                {selectedCap?.hasCeiling ? (
                  <p className="ax-inspector-cap-hint muted">
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
            </>
          )}
        </section>
      </div>
    </div>
  );
}
