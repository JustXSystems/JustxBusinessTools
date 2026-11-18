"use client";

import { useCallback, useState } from "react";
import { api } from "@/lib/api";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { CollapsibleSection } from "@/components/common/CollapsibleSection";
import { TeamRequestsPanel } from "@/components/profile/TeamRequestsPanel";

type Member = {
  id: number;
  email: string;
  name: string | null;
  phone: string | null;
  status: string;
  role: string;
  access: boolean;
  implicit: boolean;
};

function statusClass(status: string) {
  if (status === "active") return "pill pill-success";
  if (status === "pending") return "pill pill-warning";
  if (status === "suspended") return "pill pill-danger";
  return "pill";
}

export function TeamMembersPanel() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [invite, setInvite] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    role: "staff" as "staff" | "viewer",
  });

  const reload = useCallback(async () => {
    try {
      const data = await api<{ members: Member[] }>("/profile/team/members");
      setMembers(data.members);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load team");
    } finally {
      setLoading(false);
    }
  }, []);

  useLiveRefresh(reload, { intervalMs: 45_000 });

  async function run(id: number | null, label: string, fn: () => Promise<void>) {
    setBusyId(id);
    setMessage("");
    setError("");
    try {
      await fn();
      setMessage(label);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  }

  async function submitInvite(e: React.FormEvent) {
    e.preventDefault();
    await run(null, "Teammate invited and granted access to this Business Profile.", async () => {
      await api("/profile/team/invite", {
        method: "POST",
        body: JSON.stringify(invite),
      });
      setInvite({ name: "", email: "", phone: "", password: "", role: "staff" });
    });
  }

  const manageable = members.filter((m) => m.role === "staff" || m.role === "viewer");
  const leadership = members.filter((m) => m.role === "owner" || m.role === "admin");

  return (
    <div className="admin-stack" style={{ gap: 16 }}>
      <p className="section-note" style={{ margin: 0 }}>
        People reach for this Business Profile: invite Staff/Viewer, set roles, and grant or revoke
        who can enter. Commercial tool licenses are assigned only by Justxsystems platform super
        users in Access Fabric — org Owner/Admin never use <code>/admin</code>.
      </p>

      <TeamRequestsPanel />

      <CollapsibleSection
        className="profile-page-section"
        title="Invite teammate"
        hint="Create Staff or Viewer and grant this Business Profile"
        defaultOpen={false}
      >
        <form className="admin-form-grid" onSubmit={(e) => void submitInvite(e)}>
          <label className="field">
            <span>Name</span>
            <input
              value={invite.name}
              onChange={(e) => setInvite({ ...invite, name: e.target.value })}
              placeholder="Optional"
            />
          </label>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              required
              value={invite.email}
              onChange={(e) => setInvite({ ...invite, email: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Phone</span>
            <input
              value={invite.phone}
              onChange={(e) => setInvite({ ...invite, phone: e.target.value })}
              placeholder="Optional"
            />
          </label>
          <label className="field">
            <span>Temporary password</span>
            <input
              type="password"
              minLength={8}
              value={invite.password}
              onChange={(e) => setInvite({ ...invite, password: e.target.value })}
              placeholder="Required for new emails (min 8)"
            />
          </label>
          <label className="field">
            <span>Role</span>
            <select
              value={invite.role}
              onChange={(e) =>
                setInvite({ ...invite, role: e.target.value as "staff" | "viewer" })
              }
            >
              <option value="staff">Staff</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
          <div className="admin-form-row" style={{ alignItems: "end" }}>
            <button type="submit" className="btn btn-primary" disabled={busyId !== null}>
              Invite
            </button>
          </div>
        </form>
      </CollapsibleSection>

      <CollapsibleSection
        className="profile-page-section"
        title="Team members"
        hint="Roles and access for the active Business Profile"
        badge={loading ? undefined : `${manageable.length} staff/viewer`}
        defaultOpen
      >
        {loading ? <p className="muted">Loading…</p> : null}
        {error ? <div className="error-banner">{error}</div> : null}
        {message ? <p className="muted">{message}</p> : null}

        {leadership.length > 0 ? (
          <div className="admin-stack" style={{ gap: 8, marginBottom: 12 }}>
            <p className="muted" style={{ margin: 0 }}>
              Leadership (read-only here)
            </p>
            {leadership.map((m) => (
              <div key={m.id} className="flex-row-wrap" style={{ alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <strong>{m.name || m.email}</strong>
                  <p className="muted" style={{ margin: "2px 0 0" }}>
                    {m.email}
                  </p>
                </div>
                <span className="pill">{m.role}</span>
                <span className={statusClass(m.status)}>{m.status}</span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="admin-stack" style={{ gap: 12 }}>
          {manageable.map((m) => (
            <div key={m.id} className="flex-row-wrap profile-team-row" style={{ alignItems: "flex-end", gap: 10 }}>
              <div className="min-w-240" style={{ flex: 1 }}>
                <strong>{m.name || m.email}</strong>
                <p className="muted" style={{ margin: "4px 0 0" }}>
                  {m.email}
                  {m.phone ? ` · ${m.phone}` : ""}
                </p>
              </div>
              <span className={statusClass(m.status)}>{m.status}</span>
              <label className="field" style={{ minWidth: 120, margin: 0 }}>
                <span>Role</span>
                <select
                  value={m.role}
                  disabled={busyId === m.id || m.status === "pending"}
                  onChange={(e) =>
                    void run(m.id, `Role updated to ${e.target.value}.`, async () => {
                      await api(`/profile/team/${m.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ role: e.target.value }),
                      });
                    })
                  }
                >
                  <option value="staff">Staff</option>
                  <option value="viewer">Viewer</option>
                </select>
              </label>
              {m.implicit ? (
                <span className="pill pill-success">all profiles</span>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busyId === m.id}
                  onClick={() =>
                    void run(
                      m.id,
                      m.access ? "Access removed from this profile." : "Access granted to this profile.",
                      async () => {
                        if (m.access) {
                          await api(`/profile/team/${m.id}/access`, { method: "DELETE" });
                        } else {
                          await api(`/profile/team/${m.id}/access`, { method: "POST" });
                        }
                      },
                    )
                  }
                >
                  {m.access ? "Revoke profile" : "Grant profile"}
                </button>
              )}
              {m.status === "active" ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busyId === m.id}
                  onClick={() =>
                    void run(m.id, "Member suspended.", async () => {
                      await api(`/profile/team/${m.id}/suspend`, { method: "POST", body: "{}" });
                    })
                  }
                >
                  Suspend
                </button>
              ) : null}
              {m.status === "suspended" ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busyId === m.id}
                  onClick={() =>
                    void run(m.id, "Member reactivated.", async () => {
                      await api(`/profile/team/${m.id}/reactivate`, {
                        method: "POST",
                        body: "{}",
                      });
                    })
                  }
                >
                  Reactivate
                </button>
              ) : null}
            </div>
          ))}
          {!loading && manageable.length === 0 ? (
            <p className="muted">No Staff or Viewer accounts yet — invite someone above.</p>
          ) : null}
        </div>
      </CollapsibleSection>
    </div>
  );
}
