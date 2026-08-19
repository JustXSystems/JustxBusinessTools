"use client";

import { useCallback, useEffect, useState } from "react";
import { INDIAN_STATES } from "@/lib/types/business-profile";
import { api } from "@/lib/api";

type Profile = {
  id: number;
  businessName: string;
  gstin: string | null;
  pan: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  state: string | null;
  stateCode: string | null;
  phone: string | null;
  email: string | null;
  bankName: string | null;
  bankBranch: string | null;
  bankAccount: string | null;
  bankIfsc: string | null;
  bankUpi: string | null;
  terms: string | null;
  isDefault: boolean;
  approvalStatus: string;
  reviewNote: string | null;
  archivedAt: string | null;
  planId: string;
  subscriptionStatus: string;
  staffCount: number;
  recordCount: number;
  documentCount: number;
  completeness: number;
};

type Person = {
  userId: number;
  email: string;
  name: string | null;
  role: string;
  access: boolean;
  implicit: boolean;
};

type Tab = "identity" | "address" | "bank" | "access" | "lifecycle";
type Filter = "all" | "pending" | "approved" | "archived" | "incomplete";

const emptyForm = {
  businessName: "",
  gstin: "",
  pan: "",
  addressLine1: "",
  addressLine2: "",
  state: "",
  stateCode: "",
  phone: "",
  email: "",
  bankName: "",
  bankBranch: "",
  bankAccount: "",
  bankIfsc: "",
  bankUpi: "",
  terms: "",
};

function statusClass(status: string) {
  if (status === "approved") return "pill pill-success";
  if (status === "pending") return "pill pill-warning";
  if (status === "rejected" || status === "archived") return "pill pill-danger";
  return "pill";
}

function fromProfile(p: Profile) {
  return {
    businessName: p.businessName,
    gstin: p.gstin ?? "",
    pan: p.pan ?? "",
    addressLine1: p.addressLine1 ?? "",
    addressLine2: p.addressLine2 ?? "",
    state: p.state ?? "",
    stateCode: p.stateCode ?? "",
    phone: p.phone ?? "",
    email: p.email ?? "",
    bankName: p.bankName ?? "",
    bankBranch: p.bankBranch ?? "",
    bankAccount: p.bankAccount ?? "",
    bankIfsc: p.bankIfsc ?? "",
    bankUpi: p.bankUpi ?? "",
    terms: p.terms ?? "",
  };
}

export default function AdminProfilesPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [summary, setSummary] = useState({ total: 0, pending: 0, approved: 0, archived: 0, incomplete: 0 });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<Tab>("identity");
  const [form, setForm] = useState(emptyForm);
  const [people, setPeople] = useState<Person[]>([]);
  const [rejectNote, setRejectNote] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selected = profiles.find((p) => p.id === selectedId) ?? null;

  const reload = useCallback(async () => {
    const data = await api<{ profiles: Profile[]; summary: typeof summary }>("/admin/profiles");
    setProfiles(data.profiles);
    setSummary(data.summary);
  }, []);

  useEffect(() => {
    reload().catch((e) => setError(e.message));
  }, [reload]);

  async function openProfile(id: number) {
    setCreating(false);
    setSelectedId(id);
    setTab("identity");
    setError("");
    const data = await api<{ profile: Profile; people: Person[] }>(`/admin/profiles/${id}`);
    setForm(fromProfile(data.profile));
    setPeople(data.people);
    setRejectNote(data.profile.reviewNote ?? "");
  }

  const visible = profiles.filter((p) => {
    const q = query.trim().toLowerCase();
    if (q && !`${p.businessName} ${p.gstin ?? ""} ${p.state ?? ""} ${p.email ?? ""}`.toLowerCase().includes(q)) {
      return false;
    }
    if (filter === "pending") return p.approvalStatus === "pending";
    if (filter === "approved") return p.approvalStatus === "approved";
    if (filter === "archived") return p.approvalStatus === "archived";
    if (filter === "incomplete") return p.completeness < 75 && p.approvalStatus !== "archived";
    return true;
  });

  async function run(label: string, fn: () => Promise<number | void>) {
    setError("");
    setMessage("");
    try {
      const focus = await fn();
      setMessage(label);
      await reload();
      if (typeof focus === "number") await openProfile(focus);
      else if (selectedId && !creating) await openProfile(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    }
  }

  function setStateName(name: string) {
    const code = INDIAN_STATES.find(([n]) => n === name)?.[1] ?? "";
    setForm((f) => ({ ...f, state: name, stateCode: code }));
  }

  function applyGstin(gstin: string) {
    const next = gstin.toUpperCase();
    const code = next.slice(0, 2);
    const match = INDIAN_STATES.find(([, c]) => c === code);
    setForm((f) => ({
      ...f,
      gstin: next,
      state: match && !f.state ? match[0] : f.state,
      stateCode: match && !f.stateCode ? match[1] : f.stateCode,
    }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    await run(creating || !selectedId ? "Branch created — pending approval." : "Profile saved.", async () => {
      if (creating || !selectedId) {
        const created = await api<{ id: number }>("/admin/profiles", {
          method: "POST",
          body: JSON.stringify(form),
        });
        setCreating(false);
        return created.id;
      }
      await api(`/admin/profiles/${selectedId}`, { method: "PUT", body: JSON.stringify(form) });
    });
  }

  return (
    <div className="admin-page">
      <section className="panel admin-card admin-page-head">
        <div className="analytics-toolbar">
          <div>
            <h2>GST branches</h2>
            <p className="muted">Legal identity, bank details, approval, and who can work on each branch.</p>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setCreating(true);
              setSelectedId(null);
              setForm(emptyForm);
              setPeople([]);
              setTab("identity");
              setMessage("");
            }}
          >
            Add branch
          </button>
        </div>
        <div className="result-grid">
          {([
            ["all", "Total", summary.total],
            ["pending", "Pending", summary.pending],
            ["approved", "Approved", summary.approved],
            ["incomplete", "Incomplete", summary.incomplete],
          ] as Array<[Filter, string, number]>).map(([key, label, n]) => (
            <button
              key={key}
              type="button"
              className={`result-card ${filter === key ? "is-selected" : ""}`}
              onClick={() => setFilter(key)}
            >
              <span>{label}</span><strong>{n}</strong>
            </button>
          ))}
        </div>
      </section>

      <div className="team-workspace">
        <section className="panel admin-card">
          <h2>Directory</h2>
          <div className="admin-form-row">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, GSTIN, state" aria-label="Search profiles" />
            <div className="admin-tabs">
              {(["all", "pending", "approved", "archived", "incomplete"] as Filter[]).map((f) => (
                <button key={f} type="button" className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>{f}</button>
              ))}
            </div>
          </div>
          <div className="tracker-list">
            {visible.map((p) => (
              <button
                type="button"
                key={p.id}
                className={`tracker-row admin-member-row ${selectedId === p.id && !creating ? "is-selected" : ""}`}
                onClick={() => void openProfile(p.id)}
              >
                <div className="tracker-row-main">
                  <span className="tracker-row-title">{p.businessName}</span>
                  <span className="tracker-row-sub">{p.gstin || "No GSTIN"} · {p.state || "No state"}</span>
                  <div className="usage-bar" aria-hidden>
                    <span style={{ width: `${p.completeness}%` }} />
                  </div>
                </div>
                <div className="admin-form-row">
                  {p.isDefault ? <span className="pill pill-success">Default</span> : null}
                  <span className={statusClass(p.approvalStatus)}>{p.approvalStatus}</span>
                  <span className="pill">{p.completeness}%</span>
                </div>
              </button>
            ))}
            {visible.length === 0 ? <p className="muted">No branches match this filter.</p> : null}
          </div>
        </section>

        <section className="panel admin-card">
          {creating || selected ? (
            <>
              <h2>{creating ? "New branch" : selected?.businessName}</h2>
              {!creating && selected ? (
                <p className="muted">
                  {selected.planId} plan · {selected.recordCount} records · {selected.documentCount} documents · {selected.staffCount} staff grants
                </p>
              ) : (
                <p className="muted">New branches stay pending until an owner/admin approves them.</p>
              )}
              <div className="admin-tabs">
                {(["identity", "address", "bank", "access", "lifecycle"] as Tab[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={tab === t ? "active" : ""}
                    onClick={() => setTab(t)}
                    disabled={creating && (t === "access" || t === "lifecycle")}
                  >
                    {t[0].toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>

              <form onSubmit={save} className="admin-stack">
                {tab === "identity" ? (
                  <div className="admin-form-grid">
                    <label className="field"><span>Legal name</span>
                      <input value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} required />
                    </label>
                    <label className="field"><span>GSTIN</span>
                      <input value={form.gstin} onChange={(e) => applyGstin(e.target.value)} placeholder="29ABCDE1234F1Z5" maxLength={15} />
                    </label>
                    <label className="field"><span>PAN</span>
                      <input value={form.pan} onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })} placeholder="ABCDE1234F" maxLength={10} />
                    </label>
                    <label className="field"><span>Phone</span>
                      <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                    </label>
                    <label className="field"><span>Email</span>
                      <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                    </label>
                  </div>
                ) : null}

                {tab === "address" ? (
                  <div className="admin-form-grid">
                    <label className="field" style={{ gridColumn: "1 / -1" }}><span>Address line 1</span>
                      <input value={form.addressLine1} onChange={(e) => setForm({ ...form, addressLine1: e.target.value })} />
                    </label>
                    <label className="field" style={{ gridColumn: "1 / -1" }}><span>Address line 2</span>
                      <input value={form.addressLine2} onChange={(e) => setForm({ ...form, addressLine2: e.target.value })} />
                    </label>
                    <label className="field"><span>State</span>
                      <select value={form.state} onChange={(e) => setStateName(e.target.value)}>
                        <option value="">Select state</option>
                        {INDIAN_STATES.map(([name, code]) => (
                          <option key={`${name}-${code}`} value={name}>{name} ({code})</option>
                        ))}
                      </select>
                    </label>
                    <label className="field"><span>GST state code</span>
                      <input value={form.stateCode} readOnly />
                    </label>
                  </div>
                ) : null}

                {tab === "bank" ? (
                  <div className="admin-form-grid">
                    <label className="field"><span>Bank name</span>
                      <input value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} />
                    </label>
                    <label className="field"><span>Branch</span>
                      <input value={form.bankBranch} onChange={(e) => setForm({ ...form, bankBranch: e.target.value })} />
                    </label>
                    <label className="field"><span>Account number</span>
                      <input value={form.bankAccount} onChange={(e) => setForm({ ...form, bankAccount: e.target.value })} />
                    </label>
                    <label className="field"><span>IFSC</span>
                      <input value={form.bankIfsc} onChange={(e) => setForm({ ...form, bankIfsc: e.target.value.toUpperCase() })} placeholder="HDFC0001234" />
                    </label>
                    <label className="field"><span>UPI</span>
                      <input value={form.bankUpi} onChange={(e) => setForm({ ...form, bankUpi: e.target.value })} placeholder="name@upi" />
                    </label>
                    <label className="field" style={{ gridColumn: "1 / -1" }}><span>Invoice terms</span>
                      <textarea value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} rows={4} />
                    </label>
                  </div>
                ) : null}

                {tab === "identity" || tab === "address" || tab === "bank" ? (
                  <div className="admin-form-row">
                    <button type="submit" className="btn btn-primary">
                      {creating || !selectedId ? "Create (pending approval)" : "Save profile"}
                    </button>
                    {creating ? (
                      <button type="button" className="btn btn-secondary" onClick={() => { setCreating(false); setForm(emptyForm); }}>Cancel</button>
                    ) : null}
                  </div>
                ) : null}
              </form>

              {tab === "access" && selected ? (
                <ul className="admin-list">
                  {people.map((person) => (
                    <li key={person.userId}>
                      <span>
                        {person.name || person.email}
                        <span className="muted"> · {person.role}</span>
                      </span>
                      {person.implicit ? (
                        <span className="pill pill-success">all branches</span>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => run(person.access ? "Access revoked." : "Access granted.", async () => {
                            if (person.access) {
                              await api(`/admin/profiles/${selected.id}/access/${person.userId}`, { method: "DELETE" });
                            } else {
                              await api(`/admin/profiles/${selected.id}/access`, {
                                method: "POST",
                                body: JSON.stringify({ userId: person.userId }),
                              });
                            }
                          })}
                        >
                          {person.access ? "Revoke" : "Grant"}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}

              {tab === "lifecycle" && selected ? (
                <div className="admin-stack">
                  {selected.reviewNote ? <p className="muted">Review note: {selected.reviewNote}</p> : null}
                  <div className="admin-form-row">
                    {selected.approvalStatus === "pending" || selected.approvalStatus === "rejected" ? (
                      <button type="button" className="btn btn-primary" onClick={() => run("Branch approved.", () => api(`/admin/profiles/${selected.id}/approve`, { method: "POST" }).then(() => undefined))}>
                        Approve
                      </button>
                    ) : null}
                    {selected.approvalStatus === "pending" ? (
                      <>
                        <input value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="Rejection note" />
                        <button type="button" className="btn btn-secondary" onClick={() => run("Branch rejected.", () => api(`/admin/profiles/${selected.id}/reject`, {
                          method: "POST",
                          body: JSON.stringify({ note: rejectNote || "Rejected" }),
                        }).then(() => undefined))}>Reject</button>
                      </>
                    ) : null}
                    {!selected.isDefault && selected.approvalStatus === "approved" ? (
                      <button type="button" className="btn btn-secondary" onClick={() => run("Default branch updated.", () => api(`/admin/profiles/${selected.id}/default`, { method: "POST" }).then(() => undefined))}>
                        Make default
                      </button>
                    ) : null}
                    <button type="button" className="btn btn-ghost" onClick={() => run("Copy created as pending.", async () => {
                      const copy = await api<{ id: number }>(`/admin/profiles/${selected.id}/duplicate`, { method: "POST" });
                      return copy.id;
                    })}>Duplicate</button>
                    {selected.approvalStatus === "archived" ? (
                      <button type="button" className="btn btn-primary" onClick={() => run("Branch restored.", () => api(`/admin/profiles/${selected.id}/unarchive`, { method: "POST" }).then(() => undefined))}>
                        Restore
                      </button>
                    ) : !selected.isDefault ? (
                      <button type="button" className="btn btn-ghost" onClick={() => {
                        if (!window.confirm(`Archive ${selected.businessName}?`)) return;
                        void run("Branch archived.", () => api(`/admin/profiles/${selected.id}`, { method: "DELETE" }).then(() => undefined));
                      }}>Archive</button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {message ? <p className="muted">{message}</p> : null}
              {error ? <p className="field-error">{error}</p> : null}
            </>
          ) : (
            <>
              <h2>Branch detail</h2>
              <p className="muted">Select a GST branch to edit identity, banking, staff access, and approval.</p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
