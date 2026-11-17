"use client";

import Link from "next/link";
import { useCallback, useMemo, useState, type CSSProperties } from "react";
import { uniqueTools } from "@/config/tools.config";
import { api } from "@/lib/api";
import {
  computeAccessReadiness,
  groupToolsByCategory,
  signalFor,
  type AccessAction,
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
};

type LicenseRow = {
  toolId: string;
  name: string;
  status: string;
  periodEnd: string | null;
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
  locked: "Hard lock",
  orphan: "Orphan home",
  dim: "Unlicensed",
  live: "Live",
  trial: "Trial",
};

export function AccessFabricPane({
  businessProfileId,
  profileName,
  identityCompleteness,
  approvalStatus,
  peopleGranted,
  peopleTotal,
  homeToolIds,
  onNavigate,
  onMutated,
}: {
  businessProfileId: number;
  profileName: string;
  identityCompleteness: number;
  approvalStatus: string;
  peopleGranted: number;
  peopleTotal: number;
  homeToolIds: string[];
  onNavigate?: (target: "home" | "people" | "identity" | "lifecycle") => void;
  onMutated?: () => void | Promise<void>;
}) {
  const [skus, setSkus] = useState<SkuRow[]>([]);
  const [licenses, setLicenses] = useState<LicenseRow[]>([]);
  const [entitlements, setEntitlements] = useState<LicenseRow[]>([]);
  const [bundles, setBundles] = useState<BundleRow[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "dim" | "licensed" | "orphan" | "locked">("all");
  const [days, setDays] = useState("30");
  const [syncHome, setSyncHome] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

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
    const licById = new Map([...licenses, ...entitlements].map((l) => [l.toolId, l]));
    const home = new Set(homeToolIds);
    const ids = new Set<string>([...names.keys(), ...skuById.keys(), ...licById.keys()]);
    return Array.from(ids)
      .map((toolId) => {
        const fallback = names.get(toolId);
        const sku = skuById.get(toolId);
        const lic = licById.get(toolId);
        const includedFree = Boolean(sku?.includedFree);
        return {
          toolId,
          name: sku?.name || fallback?.name || toolId,
          category: sku?.category || fallback?.category || "General",
          includedFree,
          licensed: includedFree || Boolean(lic && lic.status !== "revoked"),
          periodEnd: lic?.periodEnd ?? null,
          hardLock: sku?.accessPolicy === "hard_lock",
          onHome: home.has(toolId),
          hasSku: Boolean(sku),
          priceInr: sku?.priceInr ?? 0,
          trialDays: sku?.trialDays ?? 14,
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
      }),
    [
      identityCompleteness,
      approvalStatus,
      peopleGranted,
      peopleTotal,
      homeToolIds,
      tools,
      packs,
    ],
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

  const groups = useMemo(() => groupToolsByCategory(visible), [visible]);

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

  async function provisionPack(packId: string) {
    const match = readiness.packs.find((p) => p.pack.id === packId);
    await run(packId, `Provisioned ${match?.pack.name ?? packId}.`, async () => {
      await api("/admin/skus/grant", {
        method: "POST",
        body: JSON.stringify({
          bundleId: packId,
          days: grantDays(),
          businessProfileId,
        }),
      });
      if (syncHome && match) {
        const nextHome = Array.from(new Set([...homeToolIds, ...match.pack.toolIds]));
        await api(`/admin/profiles/${businessProfileId}`, {
          method: "PUT",
          body: JSON.stringify({ homeToolIds: nextHome }),
        });
      }
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
  }

  return (
    <div className="ax-fabric">
      <header className="ax-fabric-hero">
        <div
          className="ax-readiness-ring"
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
            <small>Grade {readiness.grade}</small>
          </div>
        </div>
        <div className="ax-fabric-hero-copy">
          <p className="ax-eyebrow">Access Fabric · {profileName}</p>
          <h3>Readiness command</h3>
          <p className="muted">
            Five layers: identity → entitlements → home surface → people reach → catalog pressure.
            Provision packs to close gaps; align home so operators only see usable tools.
          </p>
          <div className="ax-layer-rail" aria-label="Layer scores">
            {readiness.layers.map((layer) => (
              <div key={layer.id} className="ax-layer-chip">
                <span className="ax-layer-chip-label">{layer.label}</span>
                <strong>{layer.score}</strong>
                <div className="ax-layer-meter" aria-hidden>
                  <span style={{ width: `${layer.score}%` }} />
                </div>
                <em>{layer.detail}</em>
              </div>
            ))}
          </div>
        </div>
        <div className="ax-fabric-controls">
          <label className="field">
            <span>Grant window (days)</span>
            <input
              type="number"
              min={1}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </label>
          <label className="ax-check">
            <input
              type="checkbox"
              checked={syncHome}
              onChange={(e) => setSyncHome(e.target.checked)}
            />
            <span>Sync pack tools onto home surface</span>
          </label>
          <Link href="/admin/tools" className="btn btn-ghost btn-sm">
            Catalog placement
          </Link>
        </div>
      </header>

      {readiness.actions.length > 0 ? (
        <section className="ax-actions" aria-label="Next actions">
          <h4>Next signals</h4>
          <ul>
            {readiness.actions.map((action) => (
              <li key={action.id}>
                <div>
                  <strong>{action.title}</strong>
                  <p className="muted">{action.detail}</p>
                </div>
                {action.action || action.packId ? (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={busyKey != null}
                    onClick={() => handleAction(action)}
                  >
                    {action.action === "grant-pack" ? "Provision" : "Open"}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="ax-packs" aria-label="Pack provisioner">
        <div className="ax-section-head">
          <h4>Pack provisioner</h4>
          <p className="muted">Apply commercial packs to this profile in one shot.</p>
        </div>
        <div className="ax-pack-rail">
          {readiness.packs.map((match) => (
            <article
              key={match.pack.id}
              className={`ax-pack-card${match.recommended ? " is-recommended" : ""}`}
            >
              <div className="ax-pack-card-top">
                <div>
                  <strong>{match.pack.name}</strong>
                  {match.pack.tagline ? <p className="muted">{match.pack.tagline}</p> : null}
                </div>
                {match.recommended ? <span className="pill pill-warning">Recommended</span> : null}
              </div>
              <div
                className="ax-pack-ring"
                style={{ "--pct": match.coveragePct } as CSSProperties}
                aria-label={`${match.coveragePct}% pack coverage`}
              >
                <span>{match.coveragePct}%</span>
              </div>
              <p className="muted ax-pack-meta">
                {match.covered}/{match.total} covered
                {match.missing.length ? ` · ${match.missing.length} missing` : " · complete"}
                {match.pack.priceInr ? ` · ${inr(match.pack.priceInr)}` : ""}
              </p>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busyKey != null || match.missing.length === 0}
                onClick={() => void provisionPack(match.pack.id)}
              >
                {busyKey === match.pack.id
                  ? "Provisioning…"
                  : match.missing.length
                    ? `Grant ${match.missing.length} tool(s)`
                    : "Fully covered"}
              </button>
            </article>
          ))}
          {readiness.packs.length === 0 ? (
            <p className="muted">No product packs configured yet.</p>
          ) : null}
        </div>
      </section>

      <section className="ax-lattice" aria-label="Tool lattice">
        <div className="ax-section-head">
          <h4>Tool lattice</h4>
          <div className="admin-form-row">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Scan tools…"
              aria-label="Search tools"
            />
            <div className="admin-tabs" role="tablist" aria-label="Lattice filter">
              {(
                [
                  ["all", "All"],
                  ["dim", "Gaps"],
                  ["licensed", "Signal"],
                  ["locked", "Locks"],
                  ["orphan", "Orphans"],
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
        </div>

        {message ? <p className="muted">{message}</p> : null}
        {error ? <p className="field-error">{error}</p> : null}

        <div className="ax-legend">
          <span data-signal="licensed">Signal</span>
          <span data-signal="included">Included</span>
          <span data-signal="dim">Gap</span>
          <span data-signal="locked">Hard lock</span>
          <span data-signal="orphan">Orphan home</span>
        </div>

        {groups.map(([category, rows]) => (
          <div key={category} className="ax-cat">
            <h5>{category}</h5>
            <div className="ax-nodes">
              {rows.map((node) => {
                const signal = signalFor(node);
                const busy = busyKey === node.toolId;
                return (
                  <article key={node.toolId} className="ax-node" data-signal={signal}>
                    <div className="ax-node-head">
                      <strong>{node.name}</strong>
                      <span className="ax-node-signal">{SIGNAL_LABEL[signal] ?? signal}</span>
                    </div>
                    <p className="muted">
                      <code>{node.toolId}</code>
                      {node.hasSku && !node.includedFree ? ` · ${inr(node.priceInr)}/mo` : ""}
                      {node.periodEnd ? ` · until ${node.periodEnd.slice(0, 10)}` : ""}
                      {node.onHome ? " · on home" : ""}
                    </p>
                    <div className="ax-node-actions">
                      {node.includedFree ? null : node.licensed ? (
                        <>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={busy}
                            onClick={() =>
                              void run(node.toolId, `Extended ${node.name}.`, async () => {
                                await api("/admin/skus/extend", {
                                  method: "POST",
                                  body: JSON.stringify({
                                    toolIds: [node.toolId],
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
                              void run(node.toolId, `Revoked ${node.name}.`, async () => {
                                await api("/admin/skus/revoke", {
                                  method: "POST",
                                  body: JSON.stringify({
                                    toolIds: [node.toolId],
                                    businessProfileId,
                                  }),
                                });
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
                            disabled={busy || !node.hasSku}
                            onClick={() =>
                              void run(node.toolId, `Licensed ${node.name}.`, async () => {
                                await api("/admin/skus/grant", {
                                  method: "POST",
                                  body: JSON.stringify({
                                    toolIds: [node.toolId],
                                    days: grantDays(),
                                    businessProfileId,
                                  }),
                                });
                              })
                            }
                          >
                            Grant
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={busy || !node.hasSku}
                            onClick={() =>
                              void run(node.toolId, `Trial for ${node.name}.`, async () => {
                                await api("/admin/skus/grant", {
                                  method: "POST",
                                  body: JSON.stringify({
                                    toolIds: [node.toolId],
                                    days: node.trialDays || 14,
                                    preferTrial: true,
                                    businessProfileId,
                                  }),
                                });
                              })
                            }
                          >
                            Trial
                          </button>
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        ))}
        {groups.length === 0 ? <p className="muted">No tools match this scan.</p> : null}
      </section>
    </div>
  );
}
