import { Router } from "express";
import { pool } from "../../db.js";
import { orgEqualsSql, orgScopeParams } from "../../lib/platform-admin.js";
import { listClaims } from "../../lib/upi/claims.js";

const router = Router();

export type InboxItem = {
  kind: "profile" | "user" | "payment_op" | "upi_claim";
  id: string;
  title: string;
  subtitle: string;
  status: string;
  createdAt: string | null;
  href: string;
  role?: string | null;
};

router.get("/inbox", async (_req, res) => {
  const scope = orgScopeParams();

  const [profileRows, userRows, opRows] = await Promise.all([
    pool.query(
      `SELECT p.id, p.business_name, o.name AS organization_name, m.created_at
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
      `SELECT u.id, u.email, u.name, u.created_at, o.name AS organization_name, m.role
       FROM org_members m
       INNER JOIN users u ON u.id = m.user_id
       INNER JOIN organizations o ON o.id = m.organization_id
       WHERE u.status = 'pending'
         AND ${orgEqualsSql("m.organization_id")}
       ORDER BY u.created_at DESC
       LIMIT 100`,
      scope,
    ),
    pool.query(
      `SELECT id, party, kind, amount_inr, created_at
       FROM payment_ops
       WHERE approval_status = 'pending'
         AND ${orgEqualsSql("organization_id")}
       ORDER BY created_at DESC
       LIMIT 100`,
      scope,
    ),
  ]);

  const items: InboxItem[] = [];

  for (const row of Array.isArray(profileRows[0]) ? profileRows[0] : []) {
    const r = row as {
      id: number;
      business_name: string;
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
      href: `/admin/profiles?filter=pending&id=${r.id}`,
    });
  }

  for (const row of Array.isArray(userRows[0]) ? userRows[0] : []) {
    const r = row as {
      id: number;
      email: string;
      name: string | null;
      created_at: string | null;
      organization_name: string | null;
      role: string;
    };
    const role = String(r.role || "");
    const kindLabel =
      role === "owner" ? "New business Owner" : role ? `Join request (${role})` : "Join request";
    items.push({
      kind: "user",
      id: String(r.id),
      title: r.name || String(r.email),
      subtitle: r.organization_name ? `${kindLabel} · ${r.organization_name}` : kindLabel,
      status: "pending",
      createdAt: r.created_at ? String(r.created_at) : null,
      href: `/admin/team?filter=pending&user=${r.id}`,
      role,
    });
  }

  for (const row of Array.isArray(opRows[0]) ? opRows[0] : []) {
    const r = row as {
      id: number;
      party: string;
      kind: string;
      amount_inr: number;
      created_at: string | null;
    };
    items.push({
      kind: "payment_op",
      id: String(r.id),
      title: String(r.party),
      subtitle: `Payment desk · ${r.kind} · ₹${Number(r.amount_inr).toLocaleString("en-IN")}`,
      status: "pending",
      createdAt: r.created_at ? String(r.created_at) : null,
      href: `/admin/payments?tab=ops`,
    });
  }

  try {
    const claims = await listClaims("pending");
    for (const c of claims.slice(0, 100)) {
      items.push({
        kind: "upi_claim",
        id: String(c.id),
        title: c.payerName || c.payerEmail,
        subtitle: `UPI claim · ${c.planId} · UTR ${c.utr} · ₹${c.amountInr.toLocaleString("en-IN")}`,
        status: c.status,
        createdAt: c.createdAt,
        href: `/admin/payments?tab=upi`,
      });
    }
  } catch {
    // UPI schema may not exist yet on fresh installs
  }

  items.sort((a, b) => {
    const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
    const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
    return tb - ta;
  });

  res.json({
    items,
    summary: {
      total: items.length,
      profiles: items.filter((i) => i.kind === "profile").length,
      users: items.filter((i) => i.kind === "user").length,
      paymentOps: items.filter((i) => i.kind === "payment_op").length,
      upiClaims: items.filter((i) => i.kind === "upi_claim").length,
    },
  });
});

export default router;
