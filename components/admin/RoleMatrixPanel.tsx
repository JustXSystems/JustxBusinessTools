"use client";

import { useCallback, useState } from "react";
import { api } from "@/lib/api";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";

type RoleKey = "owner" | "admin" | "staff" | "viewer";
type Capability =
  | "adminConsole"
  | "billing"
  | "writeRecords"
  | "exportData"
  | "approveUsers"
  | "manageBranches"
  | "manageTools";

type Matrix = Record<RoleKey, Record<Capability, boolean>>;

const ROLES: RoleKey[] = ["owner", "admin", "staff", "viewer"];
const ROLE_LABELS: Record<RoleKey, string> = {
  owner: "Business Owner",
  admin: "Admin",
  staff: "Staff",
  viewer: "Viewer",
};

export function RoleMatrixPanel() {
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  const reload = useCallback(async () => {
    const data = await api<{ matrix: Matrix; labels: Record<string, string> }>("/admin/team/roles/matrix");
    setMatrix(data.matrix);
    setLabels(data.labels);
  }, []);

  useLiveRefresh(
    () => reload().catch((e: Error) => setMessage(e.message)),
    { enabled: open, intervalMs: 60_000 },
  );

  function toggle(role: RoleKey, cap: Capability) {
    if (!matrix) return;
    // Locked capabilities / roles.
    if (role === "owner") return;
    if (cap === "adminConsole") return;
    setMatrix({
      ...matrix,
      [role]: { ...matrix[role], [cap]: !matrix[role][cap] },
    });
  }

  async function save() {
    if (!matrix) return;
    setSaving(true);
    setMessage("");
    try {
      const data = await api<{ matrix: Matrix }>("/admin/team/roles/matrix", {
        method: "PUT",
        body: JSON.stringify({ matrix }),
      });
      setMatrix(data.matrix);
      setMessage("Role matrix saved. Write access is enforced on the next API call.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const caps = matrix ? (Object.keys(matrix.owner) as Capability[]) : [];

  return (
    <section className="panel admin-card">
      <div className="analytics-toolbar">
        <div>
          <h2>Role permission matrix</h2>
          <p className="muted">
            Admin alone can open <code>/admin</code>. Owner edits Business Profile; Staff can view it
            read-only. Owner row and Admin Console column are locked.
          </p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide matrix" : "Edit matrix"}
        </button>
      </div>
      {message ? <p className="muted">{message}</p> : null}
      {open && matrix ? (
        <>
          <div className="admin-role-matrix-wrap">
            <table className="admin-role-matrix">
              <thead>
                <tr>
                  <th>Capability</th>
                  {ROLES.map((r) => (
                    <th key={r}>{ROLE_LABELS[r]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {caps.map((cap) => (
                  <tr key={cap}>
                    <td>{labels[cap] ?? cap}</td>
                    {ROLES.map((role) => (
                      <td key={role}>
                        <input
                          type="checkbox"
                          checked={Boolean(matrix[role][cap])}
                          disabled={role === "owner" || cap === "adminConsole"}
                          onChange={() => toggle(role, cap)}
                          aria-label={`${role} ${cap}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="admin-form-row" style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={() => void save()}>
              {saving ? "Saving…" : "Save matrix"}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
