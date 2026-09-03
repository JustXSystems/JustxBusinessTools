"use client";

import { useCallback, useState } from "react";
import { api } from "@/lib/api";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";

type PendingMember = {
  id: number;
  email: string;
  name: string | null;
  phone: string | null;
  role: string;
  status: string;
  createdAt: string;
};

export function TeamRequestsPanel() {
  const [members, setMembers] = useState<PendingMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [roles, setRoles] = useState<Record<number, "staff" | "viewer">>({});

  const reload = useCallback(async () => {
    try {
      const data = await api<{ members: PendingMember[] }>("/profile/team/pending");
      setMembers(data.members);
      setRoles((prev) => {
        const next = { ...prev };
        for (const m of data.members) {
          if (!next[m.id]) next[m.id] = "staff";
        }
        return next;
      });
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load join requests");
    } finally {
      setLoading(false);
    }
  }, []);

  useLiveRefresh(reload, { intervalMs: 45_000 });

  async function approve(id: number) {
    const role = roles[id] ?? "staff";
    setBusyId(id);
    setMessage("");
    setError("");
    try {
      await api(`/profile/team/${id}/approve`, {
        method: "POST",
        body: JSON.stringify({ role }),
      });
      setMessage(`Approved as ${role}. They can sign in now.`);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve failed");
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: number) {
    setBusyId(id);
    setMessage("");
    setError("");
    try {
      await api(`/profile/team/${id}/reject`, { method: "POST", body: JSON.stringify({}) });
      setMessage("Join request declined.");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reject failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="panel">
      <h3 className="panel-title">Team requests</h3>
      <p className="section-note">
        People who registered against your GSTIN wait here until you approve them as Staff or Viewer.
        JustX admins can also approve these optionally.
      </p>
      {loading ? <p className="muted">Loading…</p> : null}
      {error ? <div className="error-banner">{error}</div> : null}
      {message ? <p className="muted">{message}</p> : null}
      {!loading && members.length === 0 ? (
        <p className="muted">No pending join requests.</p>
      ) : null}
      <div className="admin-stack" style={{ gap: 12 }}>
        {members.map((m) => (
          <div key={m.id} className="flex-row-wrap" style={{ alignItems: "flex-end", gap: 10 }}>
            <div className="min-w-240" style={{ flex: 1 }}>
              <strong>{m.name || m.email}</strong>
              <p className="muted" style={{ margin: "4px 0 0" }}>
                {m.email}
                {m.phone ? ` · ${m.phone}` : ""}
              </p>
            </div>
            <label className="field" style={{ minWidth: 140, margin: 0 }}>
              <span>Role</span>
              <select
                value={roles[m.id] ?? "staff"}
                onChange={(e) =>
                  setRoles((prev) => ({ ...prev, [m.id]: e.target.value as "staff" | "viewer" }))
                }
                disabled={busyId === m.id}
              >
                <option value="staff">Staff</option>
                <option value="viewer">Viewer</option>
              </select>
            </label>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busyId === m.id}
              onClick={() => void approve(m.id)}
            >
              Approve
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busyId === m.id}
              onClick={() => void reject(m.id)}
            >
              Reject
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
