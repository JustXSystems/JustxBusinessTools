"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Dialog,
  Field,
  FormGrid,
  Grid,
  KpiCard,
  SearchInput,
  Select,
  cx,
  type BosBadgeTone,
} from "@/components/bos";
import {
  AdminEmpty,
  AdminErrorState,
  AdminPage,
  AdminPageSkeleton,
  AdminSection,
  AdminTabs,
  useAdminConfirm,
} from "@/components/admin/ui";
import { SelectField, TextField } from "@/components/admin/ui/AdminFields";
import { api } from "@/lib/api";
import { withBasePath } from "@/lib/base-path";
import { AdminOrgSelect } from "@/components/admin/AdminOrgSelect";
import { RoleMatrixPanel } from "@/components/admin/RoleMatrixPanel";
import { invalidateAdminData, useLiveRefresh } from "@/hooks/useLiveRefresh";
import { useRevealWhenStacked } from "@/hooks/useRevealWhenStacked";

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
type Tab = "profile" | "access" | "verify";
type Filter = "all" | "pending" | "active" | "suspended" | "unverified";
type AccessMode = "all" | "selected";

const ROLE_HELP: Record<string, string> = {
  owner: "Operator Business Profile — team & settings; no /admin",
  admin: "Org Admin — Business Profile team & settings; no /admin",
  staff: "Create and edit records on granted Business Profiles",
  viewer: "Read-only access",
};

const KYC_OPTIONS = ["unverified", "pending", "verified", "rejected"] as const;

const FILTER_OPTIONS: ReadonlyArray<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "unverified", label: "Unverified" },
];

const TAB_OPTIONS: ReadonlyArray<{ value: Tab; label: string }> = [
  { value: "profile", label: "Profile" },
  { value: "access", label: "Branch access" },
  { value: "verify", label: "Verification" },
];

function syncTeamUrl(filter: Filter, userId: number | null) {
  const params = new URLSearchParams();
  if (filter !== "all") params.set("filter", filter);
  if (userId != null) params.set("user", String(userId));
  const qs = params.toString();
  window.history.replaceState(null, "", withBasePath(`/admin/team${qs ? `?${qs}` : ""}`));
}

function statusTone(status: string): BosBadgeTone {
  if (status === "active" || status === "verified") return "emerald";
  if (status === "pending") return "amber";
  if (status === "suspended" || status === "rejected") return "coral";
  return "neutral";
}

export default function AdminTeamPage() {
  return (
    <Suspense fallback={<AdminPageSkeleton cards={4} />}>
      <AdminTeamInner />
    </Suspense>
  );
}

function AdminTeamInner() {
  const search = useSearchParams();
  const initialFilter = useMemo((): Filter => {
    const f = search.get("filter");
    if (f === "pending" || f === "active" || f === "suspended" || f === "unverified") return f;
    return "all";
  }, [search]);
  const focusUserId = useMemo(() => {
    const raw = search.get("user") || search.get("userId");
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [search]);

  const [members, setMembers] = useState<Member[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [summary, setSummary] = useState({ total: 0, pending: 0, active: 0, suspended: 0, unverified: 0 });
  const [branches, setBranches] = useState<Branch[]>([]);
  const [inviteBranches, setInviteBranches] = useState<Branch[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { ref: detailRef, reveal: revealDetail } = useRevealWhenStacked<HTMLElement>();
  const [tab, setTab] = useState<Tab>("profile");
  const [branchIds, setBranchIds] = useState<number[]>([]);
  const [branchMode, setBranchMode] = useState<AccessMode>("all");
  const [sessions, setSessions] = useState({ active: 0, lastSeenAt: null as string | null });
  const [copyFrom, setCopyFrom] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [removeOpen, setRemoveOpen] = useState(false);
  const [invite, setInvite] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    role: "staff",
    organizationId: null as number | null,
    branchIds: [] as number[],
  });
  const [profile, setProfile] = useState({ name: "", phone: "", role: "staff" });
  const [approveRole, setApproveRole] = useState<"staff" | "viewer">("staff");
  const [newPassword, setNewPassword] = useState("");
  const { confirm, dialog: confirmDialog } = useAdminConfirm();
  const inviteRef = useRef<HTMLDivElement>(null);
  const appliedUser = useRef<number | null>(null);

  const selected = members.find((m) => m.id === selectedId) ?? null;

  const reload = useCallback(async () => {
    try {
      const team = await api<{ members: Member[]; summary: typeof summary }>("/admin/team");
      setMembers(team.members);
      setSummary(team.summary);
      setError("");
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load team");
    }
  }, []);

  useLiveRefresh(reload, { intervalMs: 45_000 });

  useEffect(() => {
    setFilter(initialFilter);
  }, [initialFilter]);

  useEffect(() => {
    if (!focusUserId || members.length === 0) return;
    if (!members.some((m) => m.id === focusUserId)) return;
    if (selectedId === focusUserId) {
      appliedUser.current = focusUserId;
      return;
    }
    if (appliedUser.current === focusUserId) return;
    appliedUser.current = focusUserId;
    void openMember(focusUserId);
    revealDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once when list + query user are ready
  }, [focusUserId, members]);

  // Two-way URL sync: filter + selected user (inbound handled by initialFilter / focusUserId above).
  useEffect(() => {
    if (!loaded) return;
    // Deep-linked user not opened yet — don't strip ?user= before the open effect runs.
    if (focusUserId != null && selectedId == null && members.some((m) => m.id === focusUserId)) return;
    syncTeamUrl(filter, selectedId);
  }, [loaded, filter, selectedId, focusUserId, members]);

  async function openMember(id: number, resetTab = true) {
    setSelectedId(id);
    if (resetTab) setTab("profile");
    setError("");
    try {
      const data = await api<{
        member: Member;
        branchIds: number[];
        branchMode?: AccessMode;
        sessions?: { active: number; lastSeenAt: string | null };
      }>(`/admin/team/${id}`);
      setProfile({
        name: data.member.name ?? "",
        phone: data.member.phone ?? "",
        role: data.member.role,
      });
      setBranchIds(data.branchIds);
      setBranchMode(data.branchMode ?? (data.branchIds.length ? "selected" : "all"));
      setSessions(data.sessions ?? { active: 0, lastSeenAt: null });
      setNewPassword("");
      setCopyFrom("");
      const orgId = data.member.organizationId;
      if (orgId != null) {
        const branchData = await api<{ branches: Branch[] }>(
          `/admin/branches?organizationId=${orgId}`,
        );
        setBranches(branchData.branches);
      } else {
        setBranches([]);
      }
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

  function saveProfile() {
    if (!selected) return;
    void run("Profile saved.", () =>
      api(`/admin/team/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify(profile),
      }).then(() => undefined),
    );
  }

  function reviewPending() {
    const first = members.find((m) => m.status === "pending");
    setFilter("pending");
    setQuery("");
    if (!first) return;
    void openMember(first.id);
    revealDetail();
  }

  function focusInvite() {
    const el = inviteRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.querySelector<HTMLInputElement>("input, select")?.focus({ preventScroll: true });
  }

  function confirmReject(m: Member) {
    confirm({
      title: m.role === "owner" ? "Reject this new business?" : "Decline this join request?",
      description: (
        <>
          <strong>{m.name || m.email}</strong> will be declined and cannot sign in. You can reactivate them later from
          the Suspended filter.
        </>
      ),
      confirmLabel: "Reject",
      onConfirm: () =>
        run("Request declined.", () =>
          api(`/admin/team/${m.id}/reject`, { method: "POST" }).then(() => undefined),
        ),
    });
  }

  function confirmSuspend(m: Member) {
    confirm({
      title: "Suspend this account?",
      description: (
        <>
          <strong>{m.name || m.email}</strong> will be blocked from signing in. Use Reactivate to restore access.
        </>
      ),
      confirmLabel: "Suspend",
      onConfirm: () =>
        run("Account suspended.", () =>
          api(`/admin/team/${m.id}/suspend`, { method: "POST" }).then(() => undefined),
        ),
    });
  }

  function confirmResetPassword(m: Member) {
    confirm({
      title: "Reset password?",
      description: (
        <>
          Sets a new password for <strong>{m.email}</strong>. Share it with them securely — they will need it to sign
          in.
        </>
      ),
      confirmLabel: "Reset password",
      tone: "primary",
      onConfirm: () =>
        run("Password updated.", () =>
          api(`/admin/team/${m.id}/reset-password`, {
            method: "POST",
            body: JSON.stringify({ password: newPassword }),
          }).then(() => {
            setNewPassword("");
          }),
        ),
    });
  }

  if (!loaded) {
    if (error) {
      return (
        <AdminPage title="People" section="Access" sub="Directory · access · verification">
          <AdminErrorState message={error} onRetry={reload} />
        </AdminPage>
      );
    }
    return <AdminPageSkeleton cards={4} />;
  }

  const kpi = (
    key: Filter,
    label: string,
    value: number,
    chip: { color: "blue" | "amber" | "mint" | "lavender" | "rose" | "sage"; glyph: string },
    warn?: boolean,
  ) => (
    <button
      type="button"
      className={cx("admin-cc-kpi-btn", filter === key && "is-selected")}
      aria-pressed={filter === key}
      onClick={() => setFilter(key)}
    >
      <KpiCard
        label={label}
        value={value}
        chip={chip}
        delta={warn && value ? "Needs attention" : "Filter directory"}
        deltaTone={warn && value ? "warn" : "muted"}
      />
    </button>
  );

  const others = members.filter((m) => !selected || m.id !== selected.id);

  return (
    <AdminPage
      title="People"
      section="Access"
      entity={selected ? selected.name || selected.email : undefined}
      sub="Directory · access · verification"
      toolbar={
        <>
          <Badge auto tone={summary.pending ? "amber" : "emerald"}>
            {summary.pending ? `${summary.pending} pending approval` : "No pending approvals"}
          </Badge>
          <Button variant="primary" size="sm" icon="plus" onClick={focusInvite}>
            Invite
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={summary.pending === 0}
            title={summary.pending === 0 ? "Nothing waiting for approval" : undefined}
            onClick={reviewPending}
          >
            Review pending{summary.pending ? ` (${summary.pending})` : ""}
          </Button>
          <Button variant="ghost" size="sm" icon="refresh" onClick={() => void reload()}>
            Refresh
          </Button>
        </>
      }
    >
      <Alert tone="blue" title="Platform console for people across organizations">
        Invite, approve, verify, and assign Business Profile access. Org Owners and org Admins manage day-to-day
        Staff/Viewer access from operator Business Profile → Team. Tool licenses are assigned only in Access Fabric.
      </Alert>

      <Grid cols={4} min={140} gap={12}>
        {kpi("all", "Total", summary.total, { color: "blue", glyph: "👤" })}
        {kpi("pending", "Pending approval", summary.pending, { color: "amber", glyph: "◈" }, true)}
        {kpi("active", "Active", summary.active, { color: "mint", glyph: "✓" })}
        {kpi("unverified", "Needs verification", summary.unverified, { color: "rose", glyph: "◎" }, true)}
      </Grid>

      {error ? <AdminErrorState title="Action or refresh failed" message={error} onRetry={reload} /> : null}
      {message ? <Alert tone="emerald" title={message} /> : null}

      <RoleMatrixPanel />

      <div className="admin-cc-split">
        <AdminSection title="Directory" description={`${visible.length} of ${members.length} shown`}>
          <div className="admin-cc-stack">
            <SearchInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, email, phone, role"
              aria-label="Search team"
            />
            <AdminTabs aria-label="People filter" options={FILTER_OPTIONS} value={filter} onChange={setFilter} />
          </div>
          <div className="admin-cc-dir-list">
            {visible.map((m) => {
              const active = selectedId === m.id;
              return (
                <button
                  type="button"
                  key={m.id}
                  className={cx("admin-cc-row", active && "is-selected")}
                  aria-pressed={active}
                  onClick={() => {
                    void openMember(m.id);
                    revealDetail();
                  }}
                >
                  <div className="admin-cc-row-main">
                    <div className="admin-cc-cell-title">{m.name || m.email}</div>
                    <div className="admin-cc-cell-sub">
                      {m.email} · {m.role}
                      {m.status === "pending" && m.role === "owner" ? " · new business" : null}
                      {m.status === "pending" && m.role !== "owner" ? " · join request" : null}
                      {m.organizationName ? ` · ${m.organizationName}` : ""}
                      {m.gstin ? ` · ${m.gstin}` : ""}
                    </div>
                  </div>
                  <div className="admin-cc-row-badges">
                    <Badge auto tone={statusTone(m.status)}>
                      {m.status}
                    </Badge>
                    <Badge auto tone={statusTone(m.emailVerified ? "verified" : "pending")} title="Email">
                      {m.emailVerified ? "email" : "email?"}
                    </Badge>
                    <Badge auto tone={statusTone(m.phoneVerified ? "verified" : "pending")} title="Phone">
                      {m.phoneVerified ? "phone" : "phone?"}
                    </Badge>
                    <Badge auto tone={statusTone(m.kycStatus)}>
                      kyc:{m.kycStatus}
                    </Badge>
                  </div>
                </button>
              );
            })}
            {visible.length === 0 ? (
              <AdminEmpty title="No people match" icon="users">
                No people match this filter.
              </AdminEmpty>
            ) : null}
          </div>
        </AdminSection>

        <div className="admin-cc-split-stack">
          {selected ? (
            <section ref={detailRef} className="bos-widget admin-cc-section" style={{ minWidth: 0 }}>
              <div className="admin-cc-detail-head">
                <div>
                  <h3 className="admin-cc-detail-title">{selected.name || selected.email}</h3>
                  <p className="admin-cc-detail-sub">{ROLE_HELP[selected.role] ?? selected.role}</p>
                </div>
                <div className="admin-cc-actions">
                  <Badge auto tone={statusTone(selected.status)}>
                    {selected.status}
                  </Badge>
                  <Badge auto tone="neutral">
                    {selected.role}
                  </Badge>
                </div>
              </div>

              <div className="admin-cc-tabs-bar">
                <AdminTabs aria-label="Member section" options={TAB_OPTIONS} value={tab} onChange={setTab} />
                <div className="admin-cc-actions">
                  {tab === "profile" ? (
                    <Button variant="primary" onClick={saveProfile}>
                      Save profile
                    </Button>
                  ) : null}
                  {tab === "access" && selected.role !== "owner" && selected.role !== "admin" ? (
                    <Button
                      variant="primary"
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
                    </Button>
                  ) : null}
                </div>
              </div>

              {tab === "profile" ? (
                <div className="admin-cc-form">
                  <div className="admin-cc-inline">
                    {selected.status === "pending" ? (
                      <>
                        {selected.role === "owner" ? (
                          <Button
                            variant="primary"
                            onClick={() =>
                              void run("Owner approved — they can sign in.", () =>
                                api(`/admin/team/${selected.id}/approve`, { method: "POST" }).then(() => undefined),
                              )
                            }
                          >
                            Approve Owner
                          </Button>
                        ) : (
                          <>
                            <SelectField
                              label="Assign role"
                              value={approveRole}
                              onChange={(e) => setApproveRole(e.target.value as "staff" | "viewer")}
                            >
                              <option value="staff">Staff</option>
                              <option value="viewer">Viewer</option>
                            </SelectField>
                            <Button
                              variant="primary"
                              onClick={() =>
                                void run(`Approved as ${approveRole} — they can sign in.`, () =>
                                  api(`/admin/team/${selected.id}/approve`, {
                                    method: "POST",
                                    body: JSON.stringify({ role: approveRole }),
                                  }).then(() => undefined),
                                )
                              }
                            >
                              Approve access
                            </Button>
                          </>
                        )}
                        <Button variant="destructive" onClick={() => confirmReject(selected)}>
                          Reject
                        </Button>
                      </>
                    ) : null}
                    {selected.status === "active" ? (
                      <Button variant="destructive" onClick={() => confirmSuspend(selected)}>
                        Suspend
                      </Button>
                    ) : null}
                    {selected.status === "suspended" || selected.status === "rejected" ? (
                      <Button
                        variant="primary"
                        onClick={() =>
                          void run("Account reactivated.", () =>
                            api(`/admin/team/${selected.id}/approve`, { method: "POST" }).then(() => undefined),
                          )
                        }
                      >
                        Reactivate
                      </Button>
                    ) : null}
                  </div>

                  <form
                    id="team-profile-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      saveProfile();
                    }}
                  >
                    <FormGrid>
                      <TextField
                        label="Name"
                        value={profile.name}
                        onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                      />
                      <TextField
                        label="Phone"
                        value={profile.phone}
                        onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                      />
                      <SelectField
                        label="Role"
                        value={profile.role}
                        onChange={(e) => setProfile({ ...profile, role: e.target.value })}
                      >
                        <option value="owner">Owner</option>
                        <option value="admin">Admin</option>
                        <option value="staff">Staff</option>
                        <option value="viewer">Viewer (read-only)</option>
                      </SelectField>
                    </FormGrid>
                  </form>

                  <form
                    className="admin-cc-inline"
                    onSubmit={(e) => {
                      e.preventDefault();
                      confirmResetPassword(selected);
                    }}
                  >
                    <TextField
                      label="New password"
                      type="password"
                      minLength={8}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="New password (min 8)"
                      required
                    />
                    <Button type="submit" variant="ghost">
                      Reset password
                    </Button>
                  </form>

                  <div className="admin-cc-stack">
                    <p className="admin-cc-note-text">
                      Active sessions: {sessions.active}
                      {sessions.lastSeenAt
                        ? ` · last sign-in ${String(sessions.lastSeenAt).slice(0, 16).replace("T", " ")}`
                        : " · no live session"}
                    </p>
                    <div className="admin-cc-actions" style={{ justifyContent: "flex-start" }}>
                      <Button
                        variant="destructive"
                        onClick={() =>
                          void run("Signed out of other devices.", () =>
                            api(`/admin/team/${selected.id}/revoke-sessions`, { method: "POST" }).then(() => undefined),
                          )
                        }
                      >
                        Sign out all sessions
                      </Button>
                      <Button variant="destructive" onClick={() => setRemoveOpen(true)}>
                        Remove from org
                      </Button>
                    </div>
                  </div>

                  {others.length > 0 ? (
                    <div className="admin-cc-inline">
                      <Select
                        value={copyFrom}
                        onChange={(e) => setCopyFrom(e.target.value)}
                        aria-label="Copy access from"
                      >
                        <option value="">Copy tools &amp; branches from…</option>
                        {others.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name || m.email}
                          </option>
                        ))}
                      </Select>
                      <Button
                        variant="secondary"
                        disabled={!copyFrom}
                        onClick={() =>
                          void run("Access copied.", () =>
                            api(`/admin/team/${selected.id}/copy-access`, {
                              method: "POST",
                              body: JSON.stringify({ fromUserId: Number(copyFrom) }),
                            }).then(() => undefined),
                          )
                        }
                      >
                        Copy access
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {tab === "access" ? (
                <div className="admin-cc-form">
                  <p className="admin-cc-note-text">
                    Owners and admins always see every GST branch. Staff and viewers can be limited to selected
                    branches.
                  </p>
                  {selected.role === "owner" || selected.role === "admin" ? (
                    <Alert tone="blue" title="All Business Profiles">
                      This role has access to all Business Profiles automatically.
                    </Alert>
                  ) : (
                    <>
                      <FormGrid>
                        <SelectField
                          label="Branch access"
                          value={branchMode}
                          onChange={(e) => setBranchMode(e.target.value as AccessMode)}
                        >
                          <option value="all">All branches</option>
                          <option value="selected">Selected branches only</option>
                        </SelectField>
                      </FormGrid>
                      {branchMode === "selected" ? (
                        branches.length === 0 ? (
                          <AdminEmpty title="No Business Profiles yet" icon="layers">
                            Add them under Access Fabric.
                          </AdminEmpty>
                        ) : (
                          <div className="admin-cc-checklist" role="group" aria-label="Branches">
                            {branches.map((b) => (
                              <label key={b.id} className="admin-cc-check">
                                <Checkbox
                                  checked={branchIds.includes(b.id)}
                                  onChange={() =>
                                    setBranchIds((prev) =>
                                      prev.includes(b.id) ? prev.filter((id) => id !== b.id) : [...prev, b.id],
                                    )
                                  }
                                  aria-label={b.businessName}
                                />
                                {b.businessName}
                              </label>
                            ))}
                          </div>
                        )
                      ) : (
                        <ul className="admin-cc-verify-list">
                          {branches.map((b) => (
                            <li key={b.id}>
                              <span>{b.businessName}</span>
                              <Badge auto tone="emerald">
                                included
                              </Badge>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </div>
              ) : null}

              {tab === "verify" ? (
                <div className="admin-cc-form">
                  <p className="admin-cc-note-text">
                    Mark each item on its own. Approving login does not verify identity.
                  </p>
                  <ul className="admin-cc-verify-list">
                    <li>
                      <div>
                        <strong>Email</strong>
                        <span className="admin-cc-cell-sub">{selected.email}</span>
                      </div>
                      <div className="admin-cc-actions">
                        <Badge auto tone={statusTone(selected.emailVerified ? "verified" : "pending")}>
                          {selected.emailVerified ? "verified" : "not verified"}
                        </Badge>
                        {selected.emailVerified ? (
                          <Button variant="ghost" size="sm" onClick={() => verifyItem("Email unmarked.", { emailVerified: false })}>
                            Clear
                          </Button>
                        ) : (
                          <Button variant="primary" size="sm" onClick={() => verifyItem("Email verified.", { emailVerified: true })}>
                            Verify email
                          </Button>
                        )}
                      </div>
                    </li>
                    <li>
                      <div>
                        <strong>Phone</strong>
                        <span className="admin-cc-cell-sub">{selected.phone || "No phone on profile"}</span>
                      </div>
                      <div className="admin-cc-actions">
                        <Badge auto tone={statusTone(selected.phoneVerified ? "verified" : "pending")}>
                          {selected.phoneVerified ? "verified" : "not verified"}
                        </Badge>
                        {selected.phoneVerified ? (
                          <Button variant="ghost" size="sm" onClick={() => verifyItem("Phone unmarked.", { phoneVerified: false })}>
                            Clear
                          </Button>
                        ) : (
                          <Button
                            variant="primary"
                            size="sm"
                            disabled={!selected.phone && !profile.phone}
                            onClick={() => verifyItem("Phone verified.", { phoneVerified: true })}
                          >
                            Verify phone
                          </Button>
                        )}
                      </div>
                    </li>
                    <li>
                      <div>
                        <strong>KYC</strong>
                        <span className="admin-cc-cell-sub">Identity / documents review</span>
                      </div>
                      <div className="admin-cc-actions">
                        <Badge auto tone={statusTone(selected.kycStatus)}>
                          {selected.kycStatus}
                        </Badge>
                        <Select
                          size="sm"
                          value={selected.kycStatus}
                          onChange={(e) => verifyItem(`KYC set to ${e.target.value}.`, { kycStatus: e.target.value })}
                          aria-label="KYC status"
                          style={{ width: "auto" }}
                        >
                          {KYC_OPTIONS.map((k) => (
                            <option key={k} value={k}>
                              {k}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </li>
                  </ul>
                </div>
              ) : null}

              <Dialog
                open={removeOpen}
                onClose={() => setRemoveOpen(false)}
                title="Remove from organization?"
                description={`Remove ${selected.email} from this organization?`}
                icon={{ tone: "coral" }}
                actions={
                  <>
                    <Button variant="ghost" onClick={() => setRemoveOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => {
                        setRemoveOpen(false);
                        void run("Removed from organization.", async () => {
                          await api(`/admin/team/${selected.id}`, { method: "DELETE" });
                          return 0;
                        });
                      }}
                    >
                      Remove
                    </Button>
                  </>
                }
              />
            </section>
          ) : (
            <AdminSection title="Member detail">
              <AdminEmpty title="Select someone" icon="user">
                Select someone from the directory to approve access, reset a password, or assign branches and tools.
              </AdminEmpty>
            </AdminSection>
          )}

          <div ref={inviteRef} id="team-invite">
          <AdminSection
            title="Invite teammate"
            description="New people join as pending until you approve them. They cannot sign in before approval."
          >
            <form
              className="admin-cc-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (invite.organizationId == null) {
                  setError("Select an organization for the invite");
                  return;
                }
                void run("Invite sent — awaiting approval.", async () => {
                  const created = await api<{ userId: number; status: string }>("/admin/team/invite", {
                    method: "POST",
                    body: JSON.stringify(invite),
                  });
                  setInvite({
                    name: "",
                    email: "",
                    phone: "",
                    password: "",
                    role: "staff",
                    organizationId: null,
                    branchIds: [],
                  });
                  setInviteBranches([]);
                  return created.userId;
                });
              }}
            >
              <FormGrid>
                <AdminOrgSelect
                  full
                  value={invite.organizationId}
                  onChange={(organizationId) => {
                    setInvite((prev) => ({ ...prev, organizationId, branchIds: [] }));
                    if (organizationId == null) {
                      setInviteBranches([]);
                      return;
                    }
                    void api<{ branches: Branch[] }>(`/admin/branches?organizationId=${organizationId}`)
                      .then((d) => setInviteBranches(d.branches))
                      .catch(() => setInviteBranches([]));
                  }}
                  required
                  label="Organization"
                />
                <TextField
                  label="Name"
                  value={invite.name}
                  onChange={(e) => setInvite({ ...invite, name: e.target.value })}
                />
                <TextField
                  label="Email"
                  type="email"
                  value={invite.email}
                  onChange={(e) => setInvite({ ...invite, email: e.target.value })}
                  required
                />
                <TextField
                  label="Phone"
                  value={invite.phone}
                  onChange={(e) => setInvite({ ...invite, phone: e.target.value })}
                />
                <TextField
                  label="Temporary password"
                  type="password"
                  minLength={8}
                  value={invite.password}
                  onChange={(e) => setInvite({ ...invite, password: e.target.value })}
                  required
                />
                <SelectField
                  label="Role"
                  value={invite.role}
                  onChange={(e) => setInvite({ ...invite, role: e.target.value })}
                >
                  <option value="admin">Admin</option>
                  <option value="staff">Staff</option>
                  <option value="viewer">Viewer</option>
                </SelectField>
                {(invite.role === "staff" || invite.role === "viewer") && inviteBranches.length > 0 ? (
                  <Field full label="Starting branches (optional)">
                    {() => (
                      <div className="admin-cc-checklist" role="group" aria-label="Starting branches">
                        {inviteBranches.map((b) => (
                          <label key={b.id} className="admin-cc-check">
                            <Checkbox
                              checked={invite.branchIds.includes(b.id)}
                              onChange={() =>
                                setInvite((prev) => ({
                                  ...prev,
                                  branchIds: prev.branchIds.includes(b.id)
                                    ? prev.branchIds.filter((id) => id !== b.id)
                                    : [...prev.branchIds, b.id],
                                }))
                              }
                              aria-label={b.businessName}
                            />
                            {b.businessName}
                          </label>
                        ))}
                      </div>
                    )}
                  </Field>
                ) : null}
              </FormGrid>
              <div>
                <Button type="submit" variant="primary" disabled={invite.organizationId == null}>
                  Send invite
                </Button>
              </div>
            </form>
          </AdminSection>
          </div>
        </div>
      </div>
      {confirmDialog}
    </AdminPage>
  );
}
