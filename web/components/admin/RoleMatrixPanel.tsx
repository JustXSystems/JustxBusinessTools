"use client";

import { useCallback, useRef, useState } from "react";
import { Alert, Button, Checkbox, DataTable, Skeleton, type BosColumn } from "@/components/bos";
import { AdminSection } from "@/components/admin/ui";
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

function isLocked(role: RoleKey, cap: Capability) {
  if (role === "owner") return true;
  if (cap === "adminConsole" || cap === "manageTools") return true;
  if (role === "viewer" && (cap === "writeRecords" || cap === "exportData")) return true;
  return false;
}

export function RoleMatrixPanel() {
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"emerald" | "coral">("emerald");
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const dirtyRef = useRef(false);

  const reload = useCallback(async (force = false) => {
    const data = await api<{ matrix: Matrix; labels: Record<string, string> }>("/admin/team/roles/matrix");
    if (force || !dirtyRef.current) {
      setMatrix(data.matrix);
    }
    setLabels(data.labels);
  }, []);

  useLiveRefresh(
    () =>
      reload().catch((e: Error) => {
        setMessageTone("coral");
        setMessage(e.message);
      }),
    { enabled: open, intervalMs: 60_000 },
  );

  function toggle(role: RoleKey, cap: Capability) {
    if (!matrix) return;
    // Locked capabilities / roles.
    if (isLocked(role, cap)) return;
    dirtyRef.current = true;
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
      dirtyRef.current = false;
      setMatrix(data.matrix);
      setMessageTone("emerald");
      setMessage("Role matrix saved. Write access is enforced on the next API call.");
    } catch (err) {
      setMessageTone("coral");
      setMessage(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const caps = matrix ? (Object.keys(matrix.owner) as Capability[]) : [];

  const columns: ReadonlyArray<BosColumn<Capability>> = [
    {
      key: "capability",
      header: "Capability",
      cell: (cap) => <span className="admin-cc-cell-title">{labels[cap] ?? cap}</span>,
    },
    ...ROLES.map(
      (role): BosColumn<Capability> => ({
        key: role,
        header: ROLE_LABELS[role],
        cell: (cap) => (
          <Checkbox
            checked={Boolean(matrix?.[role][cap])}
            disabled={isLocked(role, cap)}
            onChange={() => toggle(role, cap)}
            aria-label={`${role} ${cap}`}
          />
        ),
      }),
    ),
  ];

  return (
    <AdminSection
      title="Role permission matrix"
      description={
        <>
          Only Justxsystems platform super users open <code className="admin-cc-code">/admin</code>. Org Owner and org
          Admin manage team and settings from operator Business Profile. Tool licenses are assigned only in Access Fabric
          (platform). Staff can view Profile and use Email Outbox / My Tools; Viewer sees Home and My Tools only. Owner
          row, Admin Console, and Assign tool licenses are locked.
        </>
      }
      actions={
        <>
          <Button variant="secondary" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? "Hide matrix" : "Edit matrix"}
          </Button>
          {open && matrix ? (
            <Button variant="primary" size="sm" disabled={saving} onClick={() => void save()}>
              {saving ? "Saving…" : "Save matrix"}
            </Button>
          ) : null}
        </>
      }
    >
      {message ? <Alert tone={messageTone} title={message} /> : null}
      {open && !matrix && !message ? <Skeleton width="100%" height={120} radius={8} /> : null}
      {open && matrix ? (
        <div className="admin-cc-matrix" style={{ marginTop: message ? 12 : 0 }}>
          <DataTable
            caption="Role permission matrix"
            compact
            columns={columns}
            rows={caps}
            rowKey={(cap) => cap}
          />
        </div>
      ) : null}
    </AdminSection>
  );
}
