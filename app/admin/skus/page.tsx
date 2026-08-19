"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

function inr(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

type Sku = {
  toolId: string;
  name: string;
  category: string;
  priceInr: number;
  billingInterval: string;
  includedFree: boolean;
  available: boolean;
};

type License = {
  toolId: string;
  name: string;
  status: string;
  periodEnd: string | null;
};

export default function AdminSkusPage() {
  const [skus, setSkus] = useState<Sku[]>([]);
  const [licenses, setLicenses] = useState<License[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  async function reload() {
    const data = await api<{ skus: Sku[]; licenses: License[] }>("/admin/skus");
    setSkus(data.skus);
    setLicenses(data.licenses);
    const next: Record<string, string> = {};
    for (const s of data.skus) next[s.toolId] = String(s.priceInr);
    setDraft(next);
  }

  useEffect(() => {
    reload().catch((e: Error) => setMessage(e.message));
  }, []);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, Sku[]>();
    for (const sku of skus) {
      if (q && !sku.name.toLowerCase().includes(q) && !sku.toolId.includes(q) && !sku.category.toLowerCase().includes(q)) {
        continue;
      }
      const list = map.get(sku.category) ?? [];
      list.push(sku);
      map.set(sku.category, list);
    }
    return Array.from(map.entries());
  }, [skus, query]);

  const licensedSet = useMemo(() => new Set(licenses.map((l) => l.toolId)), [licenses]);
  const catalogMrr = useMemo(
    () => skus.filter((s) => !s.includedFree && s.available).reduce((sum, s) => sum + s.priceInr, 0),
    [skus],
  );
  const operatorMrr = useMemo(
    () =>
      licenses.reduce((sum, l) => {
        const sku = skus.find((s) => s.toolId === l.toolId);
        return sum + (sku && !sku.includedFree ? sku.priceInr : 0);
      }, 0),
    [licenses, skus],
  );

  async function savePrice(sku: Sku) {
    setBusy(true);
    setMessage("");
    try {
      await api(`/admin/skus/${sku.toolId}`, {
        method: "PUT",
        body: JSON.stringify({
          priceInr: Number(draft[sku.toolId] ?? sku.priceInr),
          includedFree: sku.includedFree,
          available: sku.available,
          billingInterval: sku.billingInterval,
        }),
      });
      setMessage(`${sku.name} price saved. Operator catalog updates immediately.`);
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggleFlag(sku: Sku, patch: Partial<Sku>) {
    setBusy(true);
    try {
      await api(`/admin/skus/${sku.toolId}`, {
        method: "PUT",
        body: JSON.stringify({
          priceInr: sku.priceInr,
          includedFree: patch.includedFree ?? sku.includedFree,
          available: patch.available ?? sku.available,
          billingInterval: sku.billingInterval,
        }),
      });
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function grant(allPaid = false) {
    setBusy(true);
    setMessage("");
    try {
      await api("/admin/skus/grant", {
        method: "POST",
        body: JSON.stringify(allPaid ? { allPaid: true, days: 365 } : { toolIds: selected, days: 30 }),
      });
      setSelected([]);
      setMessage(allPaid ? "All paid tools licensed for this operator." : "Selected tools licensed.");
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Grant failed");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(toolIds?: string[]) {
    setBusy(true);
    try {
      await api("/admin/skus/revoke", {
        method: "POST",
        body: JSON.stringify(toolIds ? { toolIds } : {}),
      });
      setMessage(toolIds ? "License revoked." : "All paid licenses revoked.");
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Revoke failed");
    } finally {
      setBusy(false);
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <div className="admin-page">
      <section className="panel admin-card admin-page-head">
        <div className="analytics-toolbar">
          <div>
            <h2>Tool subscription SKUs</h2>
            <p className="muted">
              Set a monthly price per tool. Operators add tools to a cart; checkout is the sum. Included tools stay
              free. Verify UPI in <Link href="/admin/upi">UPI verify</Link>.
            </p>
          </div>
          <div className="admin-form-row">
            <Link href="/admin/tools" className="btn btn-ghost btn-sm">
              Catalog enablement
            </Link>
            <Link href="/admin/subscriptions" className="btn btn-secondary btn-sm">
              Record cap
            </Link>
          </div>
        </div>
        <div className="analytics-kpis">
          <div className="result-card">
            <span>Priced SKUs</span>
            <strong>{skus.filter((s) => !s.includedFree).length}</strong>
          </div>
          <div className="result-card">
            <span>List MRR (all tools)</span>
            <strong>{inr(catalogMrr)}</strong>
          </div>
          <div className="result-card">
            <span>This operator</span>
            <strong>{licenses.length} licensed</strong>
            <span className="analytics-delta">{inr(operatorMrr)} / month</span>
          </div>
          <div className="result-card">
            <span>Included</span>
            <strong>{skus.filter((s) => s.includedFree).length}</strong>
          </div>
        </div>
        {message ? <p className="muted">{message}</p> : null}
      </section>

      <div className="admin-split">
        <section className="panel admin-card">
          <div className="analytics-toolbar">
            <h2>Price list</h2>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tools…"
              aria-label="Search SKUs"
            />
          </div>
          {groups.map(([category, rows]) => (
            <div key={category} className="admin-tool-group">
              <h3>{category}</h3>
              <div className="sku-table">
                {rows.map((sku) => (
                  <div key={sku.toolId} className="sku-row">
                    <label className="sku-check">
                      <input
                        type="checkbox"
                        checked={selected.includes(sku.toolId)}
                        disabled={sku.includedFree}
                        onChange={() => toggleSelect(sku.toolId)}
                      />
                    </label>
                    <div>
                      <strong>{sku.name}</strong>
                      <span className="muted">{sku.toolId}</span>
                    </div>
                    <span className={licensedSet.has(sku.toolId) ? "pill pill-success" : sku.includedFree ? "pill" : "pill pill-warning"}>
                      {sku.includedFree ? "Included" : licensedSet.has(sku.toolId) ? "Licensed" : "Paid"}
                    </span>
                    <div className="sku-price-edit">
                      <input
                        type="number"
                        min={0}
                        step="1"
                        value={draft[sku.toolId] ?? ""}
                        disabled={sku.includedFree}
                        onChange={(e) => setDraft({ ...draft, [sku.toolId]: e.target.value })}
                        aria-label={`${sku.name} price`}
                      />
                      <button type="button" className="btn btn-ghost btn-sm" disabled={busy || sku.includedFree} onClick={() => void savePrice(sku)}>
                        Save
                      </button>
                    </div>
                    <select
                      value={sku.includedFree ? "1" : "0"}
                      onChange={(e) => void toggleFlag(sku, { includedFree: e.target.value === "1" })}
                      aria-label={`${sku.name} billing type`}
                    >
                      <option value="0">Subscription</option>
                      <option value="1">Included</option>
                    </select>
                    <select
                      value={sku.available ? "1" : "0"}
                      onChange={(e) => void toggleFlag(sku, { available: e.target.value === "1" })}
                      aria-label={`${sku.name} availability`}
                    >
                      <option value="1">On sale</option>
                      <option value="0">Hidden</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>

        <div className="admin-pane-stack">
          <section className="panel admin-card">
            <h2>Grant to this operator</h2>
            <p className="muted">Manual licenses skip UPI. Use for trials, enterprise, or corrections.</p>
            <div className="admin-form-row">
              <button type="button" className="btn btn-primary" disabled={busy || selected.length === 0} onClick={() => void grant(false)}>
                License selected ({selected.length})
              </button>
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void grant(true)}>
                License all paid tools
              </button>
            </div>
          </section>
          <section className="panel admin-card">
            <h2>Active licenses</h2>
            <div className="tracker-list">
              {licenses.map((lic) => (
                <div key={lic.toolId} className="tracker-row">
                  <div>
                    <strong>{lic.name}</strong>
                    <span className="muted">Until {lic.periodEnd ? String(lic.periodEnd).slice(0, 10) : "open"}</span>
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void revoke([lic.toolId])}>
                    Revoke
                  </button>
                </div>
              ))}
              {licenses.length === 0 ? <p className="muted">No paid licenses. Operator is on the record cap per unlicensed tool.</p> : null}
            </div>
            {licenses.length > 0 ? (
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void revoke()}>
                Revoke all
              </button>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
