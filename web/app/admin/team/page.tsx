"use client";

import { useCallback, useMemo, useState } from "react";
import { uniqueTools } from "@/config/tools.config";
import { api } from "@/lib/api";
import { RoleMatrixPanel } from "@/components/admin/RoleMatrixPanel";
import { invalidateAdminData, useLiveRefresh } from "@/hooks/useLiveRefresh";

type Member = {
  id: number;
  email: string;
  name: string | null;
  phone: string | null;
  role: string;
  status: string;
  joinedAt: string;
  kycStatus: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  organizationId?: number | null;
  organizationName?: string | null;
  gstin?: string | null;
};

type Branch = { id: number; businessName: string };
type CatalogTool = {
  id: string;
  name: string;
  groupName: string;
  available: boolean;
  toolType: string;
};
type Tab = "profile" | "access" | "tools" | "verify";
type Filter = "all" | "pending" | "active" | "suspended" | "unverified";
type AccessMode = "all" | "selected";

const ROLE_HELP: Record<string, string> = {
  owner: "Full control, including billing and user approvals",
  admin: "Manage team, profiles, tools, and settings",
  staff: "Create and edit records on granted branches",
  viewer: "Read-only access",
};

const KYC_OPTIONS = ["unverified", "pending", "verified", "rejected"] as const;

function statusClass(status: string) {
  if (status === "active" || status === "verified") return "pill pill-success";
  if (status === "pending") return "pill pill-warning";
  if (status === "suspended" || status === "rejected") return "pill pill-danger";
  return "pill";
}

function mergeCatalog(
  rows: Array<{ id: string; groupName: string; available: boolean; toolType: string }>,
): CatalogTool[] {
  const names = new Map(uniqueTools().map((t) => [t.id, t]));
  const byId = new Map<string, CatalogTool>();
  for (const row of rows) {
    const fallback = names.get(row.id);
    byId.set(row.id, {
      id: row.id,
      name: fallback?.name ?? row.id,
      groupName: row.groupName || fallback?.category || "General",
      available: row.available,
      toolType: row.toolType,
    });
  }
  for (const t of uniqueTools()) {
    if (!byId.has(t.id)) {
      byId.set(t.id, {
        id: t.id,
        name: t.name,
        groupName: t.category,
        available: true,
        toolType: "",
      });
    }
  }
  return Array.from(byId.values());
}

export default function AdminTeamPage() {
  const [catalog, setCatalog] = useState<CatalogTool[]>(() => mergeCatalog([]));
  const [toolQuery, setToolQuery] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [summary, setSummary] = useState({ total: 0, pending: 0, active: 0, suspended: 0, unverified: 0 });
  const [branches, setBranches] = useState<Branch[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("profile");
  const [branchIds, setBranchIds] = useState<number[]>([]);
  const [branchMode, setBranchMode] = useState<AccessMode>("all");
  const [toolMode, setToolMode] = useState<AccessMode>("all");
  const [toolIds, setToolIds] = useState<string[]>([]);
  const [sessions, setSessions] = useState({ active: 0, lastSeenAt: null as string | null });
  const [copyFrom, setCopyFrom] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [invite, setInvite] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    role: "staff",
    branchIds: [] as number[],
  });
  const [profile, setProfile] = useState({ name: "", phone: "", role: "staff" });
  const [approveRole, setApproveRole] = useState<"staff" | "viewer">("staff");
  const [newPassword, setNewPassword] = useState("");

  const selected = members.find((m) => m.id === selectedId) ?? null;

  const reload = useCallback(async () => {
    try {
      const [team, branchData] = await Promise.all([
        api<{ members: Member[]; summary: typeof summary }>("/admin/team"),
        api<{ branches: Branch[] }>("/admin/branches"),
      ]);
      setMembers(team.members);
      setSummary(team.summary);
      setBranches(branchData.branches);
      setError("");
      try {
        const catalogData = await api<{
          tools: Array<{ id: string; groupName: string; available: boolean; toolType: string }>;
        }>("/admin/catalog");
        setCatalog(mergeCatalog(catalogData.tools));
      } catch {
        setCatalog(mergeCatalog([]));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load team");
    }
  }, []);

  useLiveRefresh(reload, { intervalMs: 45_000 });

  async function openMember(id: number, resetTab = true) {
    setSelectedId(id);
    if (resetTab) setTab("profile");
    setError("");
    try {
      const data = await api<{
        member: Member;
        branchIds: number[];
        branchMode?: AccessMode;
        tools: Array<{ toolId: string; granted: boolean }>;
        toolMode: AccessMode;
        sessions?: { active: number; lastSeenAt: string | null };
      }>(`/admin/team/${id}`);
      setProfile({
        name: data.member.name ?? "",
        phone: data.member.phone ?? "",
        role: data.member.role,
      });
      setBranchIds(data.branchIds);
      setBranchMode(data.branchMode ?? (data.branchIds.length ? "selected" : "all"));
      setToolMode(data.toolMode);
      setToolIds(data.tools.filter((t) => t.granted).map((t) => t.toolId));
      setSessions(data.sessions ?? { active: 0, lastSeenAt: null });
      setNewPassword("");
      setCopyFrom("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load member");
    }
  }

  const visible = members.filter((m) => {
    const q = query.trim().toLowerCase();
    if (q && !`${m.name ?? ""} ${m.email} ${m.phone ?? ""} ${m.role} ${m.organizationName ?? ""} ${m.gstin ?? ""}`.toLowerCase().includes(q)) return false;
    if (filter === "pending") return m.status === "pending";
    if (filter === "active") return m.status === "active";
    if (filter === "suspended") return m.status === "suspended" || m.status === "rejected";
    if (filter === "unverified") return m.kycStatus === "unverified" || !m.emailVerified;
    return true;
  });

  const toolGroups = useMemo(() => {
    const q = toolQuery.trim().toLowerCase();
    const map = new Map<string, CatalogTool[]>();
    for (const t of catalog) {
      if (q && !`${t.name} ${t.id} ${t.groupName}`.toLowerCase().includes(q)) continue;
      const list = map.get(t.groupName) ?? [];
      list.push(t);
      map.set(t.groupName, list);
    }
    return Array.from(map.entries());
  }, [catalog, toolQuery]);

  async function run(label: string, fn: () => Promise<number | void>) {
    setError("");
    setMessage("");
    try {
      const focusId = await fn();
      setMessage(label);
      invalidateAdminData("admin-team");
      await reload();
      if (focusId === 0) {
        setSelectedId(null);
        return;
      }
      const id = typeof focusId === "number" ? focusId : selectedId;
      if (id) await openMember(id, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    }
  }

  function verifyItem(label: string, body: Record<string, unknown>) {
    if (!selected) return;
    void run(label, () =>
      api(`/admin/team/${selected.id}/verify`, {
        method: "POST",
        body: JSON.stringify(body),
      }).then(() => undefined),
    );
  }

  return (
    <div className="admin-page">
      <section className="panel admin-card admin-page-head">
        <h2>People</h2>
        <p className="muted">
          Invite staff, approve login, verify email / phone / KYC separately, then assign branches and the full tool catalog.
        </p>
        <div className="result-grid">
          <button type="button" className={`result-card ${filter === "all" ? "is-selected" : ""}`} onClick={() => setFilter("all")}>
            <span>Total</span><strong>{summary.total}</strong>
          </button>
          <button type="button" className={`result-card ${filter === "pending" ? "is-selected" : ""}`} onClick={() => setFilter("pending")}>
            <span>Pending approval</span><strong>{summary.pending}</strong>
          </button>
          <button type="button" className={`result-card ${filter === "active" ? "is-selected" : ""}`} onClick={() => setFilter("active")}>
            <span>Active</span><strong>{summary.active}</strong>
          </button>
          <button type="button" className={`result-card ${filter === "unverified" ? "is-selected" : ""}`} onClick={() => setFilter("unverified")}>
            <span>Needs verification</span><strong>{summary.unverified}</strong>
          </button>
        </div>
      </section>

      <div className="admin-page-scroll">
      <RoleMatrixPanel />

      <div className="team-workspace">
      <section className="panel admin-card admin-dir-panel">
        <h2>Directory</h2>
        <div className="admin-form-row">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email, phone, role"
            aria-label="Search team"
          />
          <div className="admin-tabs">
            {(["all", "pending", "active", "suspended", "unverified"] as Filter[]).map((f) => (
              <button key={f} type="button" className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="tracker-list admin-dir-list">
          {visible.map((m) => (
            <button
              type="button"
              key={m.id}
              className={`tracker-row admin-member-row ${selectedId === m.id ? "is-selected" : ""}`}
              onClick={() => void openMember(m.id)}
            >
              <div className="tracker-row-main">
                <span className="tracker-row-title">{m.name || m.email}</span>
                <span className="tracker-row-sub">
                  {m.email} · {m.role}
                  {m.status === "pending" && m.role === "owner" ? " · new business" : null}
                  {m.status === "pending" && m.role !== "owner" ? " · join request" : null}
                  {m.organizationName ? ` · ${m.organizationName}` : ""}
                  {m.gstin ? ` · ${m.gstin}` : ""}
                </span>
              </div>
              <div className="admin-form-row">
                <span className={statusClass(m.status)}>{m.status}</span>
                <span className={statusClass(m.emailVerified ? "verified" : "pending")} title="Email">
                  {m.emailVerified ? "email" : "email?"}
                </span>
                <span className={statusClass(m.phoneVerified ? "verified" : "pending")} title="Phone">
                  {m.phoneVerified ? "phone" : "phone?"}
                </span>
                <span className={statusClass(m.kycStatus)}>kyc:{m.kycStatus}</span>
              </div>
            </button>
          ))}
          {visible.length === 0 ? <p className="muted">No people match this filter.</p> : null}
        </div>
      </section>

      <div className="admin-pane-stack">
      {selected ? (
        <section className="panel admin-card admin-detail-panel">
          <h2>{selected.name || selected.email}</h2>
          <p className="muted">{ROLE_HELP[selected.role] ?? selected.role}</p>
          <div className="admin-tabs-bar">
            <div className="admin-tabs" role="tablist">
              {(["profile", "access", "tools", "verify"] as Tab[]).map((t) => (
                <button key={t} type="button" role="tab" className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
                  {t === "access" ? "Branches" : t === "verify" ? "Verification" : t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            <div className="admin-tabs-actions">
              {tab === "profile" ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() =>
                    void run("Profile saved.", () =>
                      api(`/admin/team/${selected.id}`, {
                        method: "PATCH",
                        body: JSON.stringify(profile),
                      }).then(() => undefined),
                    )
                  }
                >
                  Save profile
                </button>
              ) : null}
              {tab === "access" && selected.role !== "owner" && selected.role !== "admin" ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() =>
                    void run("Branch access saved.", () =>
                      api(`/admin/team/${selected.id}/branches`, {
                        method: "PUT",
                        body: JSON.stringify({ mode: branchMode, branchIds }),
                      }).then(() => undefined),
                    )
                  }
                >
                  Save branch access
                </button>
              ) : null}
              {tab === "tools" ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() =>
                    void run("Tool access saved.", () =>
                      api(`/admin/team/${selected.id}/tools`, {
                        method: "PUT",
                        body: JSON.stringify({ mode: toolMode, toolIds }),
                      }).then(() => undefined),
                    )
                  }
                >
                  Save tool access
                </button>
              ) : null}
            </div>
          </div>

          <div className="admin-detail-scroll">
          {tab === "profile" ? (
            <div className="admin-stack">
              <div className="admin-form-row">
                {selected.status === "pending" ? (
                  <>
                    {selected.role === "owner" ? (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() =>
                          run("Owner approved — they can sign in.", () =>
                            api(`/admin/team/${selected.id}/approve`, { method: "POST" }).then(() => undefined),
                          )
                        }
                      >
                        Approve Owner
                      </button>
                    ) : (
                      <>
                        <label className="field" style={{ minWidth: 140 }}>
                          <span>Assign role</span>
                          <select
                            value={approveRole}
                            onChange={(e) => setApproveRole(e.target.value as "staff" | "viewer")}
                          >
                            <option value="staff">Staff</option>
                            <option value="viewer">Viewer</option>
                          </select>
                        </label>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() =>
                            run(`Approved as ${approveRole} — they can sign in.`, () =>
                              api(`/admin/team/${selected.id}/approve`, {
                                method: "POST",
                                body: JSON.stringify({ role: approveRole }),
                              }).then(() => undefined),
                            )
                          }
                        >
                          Approve access
                        </button>
                      </>
                    )}
                    <button type="button" className="btn btn-secondary" onClick={() => run("Request declined.", () => api(`/admin/team/${selected.id}/reject`, { method: "POST" }).then(() => undefined))}>Reject</button>
                  </>
                ) : null}
                {selected.status === "active" ? (
                  <button type="button" className="btn btn-secondary" onClick={() => run("Account suspended.", () => api(`/admin/team/${selected.id}/suspend`, { method: "POST" }).then(() => undefined))}>Suspend</button>
                ) : null}
                {selected.status === "suspended" || selected.status === "rejected" ? (
                  <button type="button" className="btn btn-primary" onClick={() => run("Account reactivated.", () => api(`/admin/team/${selected.id}/approve`, { method: "POST" }).then(() => undefined))}>Reactivate</button>
                ) : null}
              </div>
              <form className="admin-form-grid" id="team-profile-form" onSubmit={(e) => {
                e.preventDefault();
                void run("Profile saved.", () => api(`/admin/team/${selected.id}`, {
                  method: "PATCH",
                  body: JSON.stringify(profile),
                }).then(() => undefined));
              }}>
                <label className="field"><span>Name</span>
                  <input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
                </label>
                <label className="field"><span>Phone</span>
                  <input value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
                </label>
                <label className="field"><span>Role</span>
                  <select value={profile.role} onChange={(e) => setProfile({ ...profile, role: e.target.value })}>
                    <option value="owner">Owner</option>
                    <option value="admin">Admin</option>
                    <option value="staff">Staff</option>
                    <option value="viewer">Viewer (read-only)</option>
                  </select>
                </label>
              </form>
              <form className="admin-form-row" onSubmit={(e) => {
                e.preventDefault();
                void run("Password updated.", () => api(`/admin/team/${selected.id}/reset-password`, {
                  method: "POST",
                  body: JSON.stringify({ password: newPassword }),
                }).then(() => { setNewPassword(""); }));
              }}>
                <input type="password" minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="New password (min 8)" required />
                <button type="submit" className="btn btn-secondary">Reset password</button>
              </form>
              <div className="admin-kv-block">
                <p className="muted">
                  Active sessions: {sessions.active}
                  {sessions.lastSeenAt ? ` · last sign-in ${String(sessions.lastSeenAt).slice(0, 16).replace("T", " ")}` : " · no live session"}
                </p>
                <div className="admin-form-row">
                  <button type="button" className="btn btn-secondary" onClick={() => run("Signed out of other devices.", () => api(`/admin/team/${selected.id}/revoke-sessions`, { method: "POST" }).then(() => undefined))}>
                    Sign out all sessions
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      if (!window.confirm(`Remove ${selected.email} from this organization?`)) return;
                      void run("Removed from organization.", async () => {
                        await api(`/admin/team/${selected.id}`, { method: "DELETE" });
                        return 0;
                      });
                    }}
                  >
                    Remove from org
                  </button>
                </div>
              </div>
              {members.filter((m) => m.id !== selected.id).length > 0 ? (
                <div className="admin-form-row">
                  <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} aria-label="Copy access from">
                    <option value="">Copy tools & branches from…</option>
                    {members.filter((m) => m.id !== selected.id).map((m) => (
                      <option key={m.id} value={m.id}>{m.name || m.email}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={!copyFrom}
                    onClick={() => run("Access copied.", () => api(`/admin/team/${selected.id}/copy-access`, {
                      method: "POST",
                      body: JSON.stringify({ fromUserId: Number(copyFrom) }),
                    }).then(() => undefined))}
                  >
                    Copy access
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === "access" ? (
            <div className="admin-stack">
              <p className="muted">
                Owners and admins always see every GST branch. Staff and viewers can be limited to selected branches.
              </p>
              {selected.role === "owner" || selected.role === "admin" ? (
                <p className="muted">This role has access to all GST branches automatically.</p>
              ) : (
                <>
                  <label className="field">
                    <span>Branch access</span>
                    <select value={branchMode} onChange={(e) => setBranchMode(e.target.value as AccessMode)}>
                      <option value="all">All branches</option>
                      <option value="selected">Selected branches only</option>
                    </select>
                  </label>
                  {branchMode === "selected" ? (
                    <div className="branch-checklist">
                      {branches.map((b) => (
                        <label key={b.id} className="branch-check">
                          <input
                            type="checkbox"
                            checked={branchIds.includes(b.id)}
                            onChange={() => setBranchIds((prev) => prev.includes(b.id) ? prev.filter((id) => id !== b.id) : [...prev, b.id])}
                          />
                          {b.businessName}
                        </label>
                      ))}
                      {branches.length === 0 ? <p className="muted">No GST branches yet. Add them under Profiles.</p> : null}
                    </div>
                  ) : (
                    <ul className="admin-list">
                      {branches.map((b) => (
                        <li key={b.id}><span>{b.businessName}</span><span className="pill pill-success">included</span></li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          ) : null}

          {tab === "tools" ? (
            <div className="admin-stack">
              <p className="muted">
                Complete catalog from Tools admin, plus any built-in tools not yet grouped. Hidden tools stay in this list so you can still grant them.
              </p>
              <label className="field">
                <span>Access mode</span>
                <select value={toolMode} onChange={(e) => setToolMode(e.target.value as AccessMode)}>
                  <option value="all">All tools</option>
                  <option value="selected">Selected tools only</option>
                </select>
              </label>
              <div className="admin-form-row">
                <input
                  value={toolQuery}
                  onChange={(e) => setToolQuery(e.target.value)}
                  placeholder={`Search ${catalog.length} tools`}
                  aria-label="Search tools"
                />
                {toolMode === "selected" ? (
                  <>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setToolIds(catalog.map((t) => t.id))}>Select all</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setToolIds([])}>Clear</button>
                  </>
                ) : null}
                <span className="muted">
                  {toolMode === "all" ? catalog.length : toolIds.length} / {catalog.length} granted
                </span>
              </div>
              {toolGroups.map(([group, rows]) => (
                <div key={group} className="admin-tool-group">
                  <h3>
                    {group}
                    {toolMode === "selected" ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setToolIds((prev) => {
                          const ids = rows.map((r) => r.id);
                          const allOn = ids.every((id) => prev.includes(id));
                          return allOn ? prev.filter((id) => !ids.includes(id)) : Array.from(new Set([...prev, ...ids]));
                        })}
                      >
                        Toggle group
                      </button>
                    ) : null}
                  </h3>
                  <div className="branch-checklist">
                    {rows.map((t) => {
                      const checked = toolMode === "all" || toolIds.includes(t.id);
                      return (
                        <label key={t.id} className={`branch-check ${!t.available ? "is-muted" : ""}`}>
                          <input
                            type="checkbox"
                            disabled={toolMode === "all"}
                            checked={checked}
                            onChange={() => setToolIds((prev) => prev.includes(t.id) ? prev.filter((id) => id !== t.id) : [...prev, t.id])}
                          />
                          <span>
                            {t.name}
                            <span className="muted"> · {t.id}{t.toolType ? ` · ${t.toolType}` : ""}</span>
                          </span>
                          {!t.available ? <span className="pill">hidden</span> : null}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
              {toolGroups.length === 0 ? <p className="muted">No tools match that search.</p> : null}
            </div>
          ) : null}

          {tab === "verify" ? (
            <div className="admin-stack">
              <p className="muted">Mark each item on its own. Approving login does not verify identity.</p>
              <ul className="verify-list">
                <li>
                  <div>
                    <strong>Email</strong>
                    <span className="muted">{selected.email}</span>
                  </div>
                  <div className="admin-form-row">
                    <span className={statusClass(selected.emailVerified ? "verified" : "pending")}>
                      {selected.emailVerified ? "verified" : "not verified"}
                    </span>
                    {selected.emailVerified ? (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => verifyItem("Email unmarked.", { emailVerified: false })}>Clear</button>
                    ) : (
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => verifyItem("Email verified.", { emailVerified: true })}>Verify email</button>
                    )}
                  </div>
                </li>
                <li>
                  <div>
                    <strong>Phone</strong>
                    <span className="muted">{selected.phone || "No phone on profile"}</span>
                  </div>
                  <div className="admin-form-row">
                    <span className={statusClass(selected.phoneVerified ? "verified" : "pending")}>
                      {selected.phoneVerified ? "verified" : "not verified"}
                    </span>
                    {selected.phoneVerified ? (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => verifyItem("Phone unmarked.", { phoneVerified: false })}>Clear</button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={!selected.phone && !profile.phone}
                        onClick={() => verifyItem("Phone verified.", { phoneVerified: true })}
                      >
                        Verify phone
                      </button>
                    )}
                  </div>
                </li>
                <li>
                  <div>
                    <strong>KYC</strong>
                    <span className="muted">Identity / documents review</span>
                  </div>
                  <div className="admin-form-row">
                    <span className={statusClass(selected.kycStatus)}>{selected.kycStatus}</span>
                    <select
                      value={selected.kycStatus}
                      onChange={(e) => verifyItem(`KYC set to ${e.target.value}.`, { kycStatus: e.target.value })}
                      aria-label="KYC status"
                    >
                      {KYC_OPTIONS.map((k) => (
                        <option key={k} value={k}>{k}</option>
                      ))}
                    </select>
                  </div>
                </li>
              </ul>
            </div>
          ) : null}
          </div>

          {message ? <p className="muted">{message}</p> : null}
          {error ? <p className="field-error">{error}</p> : null}
        </section>
      ) : (
        <section className="panel admin-card">
          <h2>Member detail</h2>
          <p className="muted">Select someone from the directory to approve access, reset a password, or assign branches and tools.</p>
        </section>
      )}
      <section className="panel admin-card">
        <h2>Invite teammate</h2>
        <p className="muted">New people join as pending until you approve them. They cannot sign in before approval.</p>
        <form className="admin-form-grid" onSubmit={(e) => {
          e.preventDefault();
          void run("Invite sent — awaiting approval.", async () => {
            const created = await api<{ userId: number; status: string }>("/admin/team/invite", {
              method: "POST",
              body: JSON.stringify(invite),
            });
            setInvite({ name: "", email: "", phone: "", password: "", role: "staff", branchIds: [] });
            return created.userId;
          });
        }}>
          <label className="field"><span>Name</span>
            <input value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} />
          </label>
          <label className="field"><span>Email</span>
            <input type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} required />
          </label>
          <label className="field"><span>Phone</span>
            <input value={invite.phone} onChange={(e) => setInvite({ ...invite, phone: e.target.value })} />
          </label>
          <label className="field"><span>Temporary password</span>
            <input type="password" minLength={8} value={invite.password} onChange={(e) => setInvite({ ...invite, password: e.target.value })} required />
          </label>
          <label className="field"><span>Role</span>
            <select value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}>
              <option value="admin">Admin</option>
              <option value="staff">Staff</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
          {(invite.role === "staff" || invite.role === "viewer") && branches.length > 0 ? (
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <span>Starting branches (optional)</span>
              <div className="branch-checklist">
                {branches.map((b) => (
                  <label key={b.id} className="branch-check">
                    <input
                      type="checkbox"
                      checked={invite.branchIds.includes(b.id)}
                      onChange={() => setInvite((prev) => ({
                        ...prev,
                        branchIds: prev.branchIds.includes(b.id)
                          ? prev.branchIds.filter((id) => id !== b.id)
                          : [...prev.branchIds, b.id],
                      }))}
                    />
                    {b.businessName}
                  </label>
                ))}
              </div>
            </div>
          ) : null}
          <button type="submit" className="btn btn-primary">Send invite</button>
        </form>
      </section>
      </div>
      </div>
      </div>
    </div>
  );
}
