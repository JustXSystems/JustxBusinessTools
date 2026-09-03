import { pool } from "../../db.js";
import { orgEqualsSql, orgScopeParams } from "../platform-admin.js";
import { listClaims } from "../upi/claims.js";
import { adminDeepLink } from "./deep-links.js";

export type PendingInboxKind = "profile" | "user" | "payment_op" | "upi_claim";

export type PendingInboxItem = {
  kind: PendingInboxKind;
  id: string;
  title: string;
  subtitle: string;
  status: string;
  createdAt: string | null;
  href: string;
  role?: string | null;
  organizationId?: number | null;
};

export type PendingInboxSummary = {
  total: number;
  profiles: number;
  users: number;
  deskOps: number;
  upiClaims: number;
  upiAmountInr: number;
};

/**
 * Single source of truth for dashboard counts + Approvals inbox rows.
 * Keep queries aligned so KPI numbers always match the inbox list.
 */
export async function loadPendingInbox(): Promise<{
  items: PendingInboxItem[];
  summary: PendingInboxSummary;
}> {
  const scope = orgScopeParams();

  const [profileRows, userRows, opRows] = await Promise.all([
    pool.query(
      `SELECT p.id, p.business_name, p.organization_id, o.name AS organization_name, m.created_at
       FROM business_profiles p
       LEFT JOIN organizations o ON o.id = p.organization_id
       LEFT JOIN business_profile_meta m ON m.business_profile_id = p.id
       WHERE COALESCE(m.approval_status, 'approved') = 'pending'
         AND ${orgEqualsSql("p.organization_id")}
       ORDER BY m.created_at DESC, p.id DESC
       LIMIT 100`,
      scope,
    ),
    pool.query(
      `SELECT u.id, u.email, u.name, u.created_at, u.status,
              m.organization_id, m.role, o.name AS organization_name
       FROM users u
       INNER JOIN org_members m ON m.user_id = u.id
       LEFT JOIN organizations o ON o.id = m.organization_id
       WHERE u.status = 'pending'
         AND ${orgEqualsSql("m.organization_id")}
       ORDER BY u.created_at DESC
       LIMIT 100`,
      scope,
    ),
    pool.query(
      `SELECT id, party, kind, amount_inr, created_at, organization_id
       FROM payment_ops
       WHERE approval_status = 'pending'
         AND ${orgEqualsSql("organization_id")}
       ORDER BY created_at DESC
       LIMIT 100`,
      scope,
    ),
  ]);

  const items: PendingInboxItem[] = [];

  for (const row of Array.isArray(profileRows[0]) ? profileRows[0] : []) {
    const r = row as {
      id: number;
      business_name: string;
      organization_id: number | null;
      organization_name: string | null;
      created_at: string | null;
    };
    items.push({
      kind: "profile",
      id: String(r.id),
      title: String(r.business_name),
      subtitle: r.organization_name ? `Branch · ${r.organization_name}` : "Branch awaiting approval",
      status: "pending",
      createdAt: r.created_at ? String(r.created_at) : null,
      href: adminDeepLink.profilePending(r.id),
      organizationId: r.organization_id == null ? null : Number(r.organization_id),
    });
  }

  // Deduplicate users who somehow appear in multiple orgs while pending.
  const seenUsers = new Set<number>();
  for (const row of Array.isArray(userRows[0]) ? userRows[0] : []) {
    const r = row as {
      id: number;
      email: string;
      name: string | null;
      created_at: string | null;
      organization_id: number | null;
      organization_name: string | null;
      role: string;
    };
    const userId = Number(r.id);
    if (seenUsers.has(userId)) continue;
    seenUsers.add(userId);
    const role = String(r.role || "");
    const kindLabel =
      role === "owner" ? "New business Owner" : role ? `Join request (${role})` : "Join request";
    items.push({
      kind: "user",
      id: String(userId),
      title: r.name || String(r.email),
      subtitle: r.organization_name ? `${kindLabel} · ${r.organization_name}` : kindLabel,
      status: "pending",
      createdAt: r.created_at ? String(r.created_at) : null,
      href: adminDeepLink.userPending(userId),
      role,
      organizationId: r.organization_id == null ? null : Number(r.organization_id),
    });
  }

  for (const row of Array.isArray(opRows[0]) ? opRows[0] : []) {
    const r = row as {
      id: number;
      party: string;
      kind: string;
      amount_inr: number;
      created_at: string | null;
      organization_id: number | null;
    };
    items.push({
      kind: "payment_op",
      id: String(r.id),
      title: String(r.party),
      subtitle: `Payment desk · ${r.kind} · ₹${Number(r.amount_inr).toLocaleString("en-IN")}`,
      status: "pending",
      createdAt: r.created_at ? String(r.created_at) : null,
      href: adminDeepLink.paymentOpPending(r.id),
      organizationId: r.organization_id == null ? null : Number(r.organization_id),
    });
  }

  let upiAmountInr = 0;
  try {
    const claims = await listClaims("pending");
    for (const c of claims.slice(0, 100)) {
      upiAmountInr += c.amountInr;
      items.push({
        kind: "upi_claim",
        id: String(c.id),
        title: c.payerName || c.payerEmail,
        subtitle: `UPI claim · ${c.planId} · UTR ${c.utr} · ₹${c.amountInr.toLocaleString("en-IN")}`,
        status: c.status,
        createdAt: c.createdAt,
        href: adminDeepLink.upiClaimPending(c.id),
        organizationId: c.organizationId,
      });
    }
  } catch {
    // UPI schema may not exist yet
  }

  items.sort((a, b) => {
    const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
    const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
    return tb - ta;
  });

  const profiles = items.filter((i) => i.kind === "profile").length;
  const users = items.filter((i) => i.kind === "user").length;
  const deskOps = items.filter((i) => i.kind === "payment_op").length;
  const upiClaims = items.filter((i) => i.kind === "upi_claim").length;

  return {
    items,
    summary: {
      total: items.length,
      profiles,
      users,
      deskOps,
      upiClaims,
      upiAmountInr,
    },
  };
}
