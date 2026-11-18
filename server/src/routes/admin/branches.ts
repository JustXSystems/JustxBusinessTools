import { Router } from "express";
import { pool } from "../../db.js";
import {
  adminResolveError,
  listAdminBusinessProfiles,
  requireAdminOrgId,
  resolveAdminBusinessProfile,
} from "../../lib/admin/tenant-guard.js";

const router = Router();

router.get("/", async (req, res) => {
  const profileHint = await resolveAdminBusinessProfile(
    req.query.businessProfileId ?? req.query.profileId,
  );
  if (adminResolveError(profileHint)) {
    res.status(profileHint.status).json({ error: profileHint.error });
    return;
  }

  const orgRaw = req.query.organizationId ?? profileHint?.organizationId;
  const orgResolved =
    orgRaw != null && orgRaw !== ""
      ? requireAdminOrgId(orgRaw)
      : null;
  if (orgResolved && adminResolveError(orgResolved)) {
    res.status(orgResolved.status).json({ error: orgResolved.error });
    return;
  }

  const orgId = typeof orgResolved === "number" ? orgResolved : null;
  const profiles = await listAdminBusinessProfiles(orgId);
  const branches = profiles.map((p) => ({
    id: p.id,
    businessName: p.businessName,
    gstin: null as string | null,
    isDefault: p.isDefault,
    organizationId: p.organizationId,
    organizationName: p.organizationName,
  }));

  // Enrich with gstin when scoped to one org (keeps payload lean for global lists).
  if (orgId != null) {
    const [rows] = await pool.query(
      `SELECT id, gstin, address_line1, state, phone, email
       FROM business_profiles WHERE organization_id = :orgId`,
      { orgId },
    );
    const extra = new Map(
      (Array.isArray(rows) ? rows : []).map((row) => {
        const r = row as Record<string, unknown>;
        return [
          Number(r.id),
          {
            gstin: (r.gstin as string | null) ?? null,
            addressLine1: (r.address_line1 as string | null) ?? null,
            state: (r.state as string | null) ?? null,
            phone: (r.phone as string | null) ?? null,
            email: (r.email as string | null) ?? null,
          },
        ] as const;
      }),
    );
    for (const b of branches) {
      const e = extra.get(b.id);
      if (e) Object.assign(b, e);
    }
  }

  res.json({
    branches,
    organizationId: orgId,
    businessProfileId: profileHint?.profileId ?? null,
  });
});

router.post("/", async (req, res) => {
  const orgResolved = requireAdminOrgId(req.body?.organizationId);
  if (adminResolveError(orgResolved)) {
    res.status(orgResolved.status).json({ error: orgResolved.error });
    return;
  }
  const orgId = orgResolved;
  const businessName = String(req.body?.businessName ?? "").trim();
  if (!businessName) {
    res.status(400).json({ error: "businessName required" });
    return;
  }

  const [result] = await pool.query(
    `INSERT INTO business_profiles (organization_id, business_name, is_default)
     VALUES (:orgId, :name, 0)`,
    { orgId, name: businessName },
  );
  const id = Number((result as { insertId: number }).insertId);

  await pool.query(
    `INSERT INTO subscriptions (business_profile_id, plan_id, status) VALUES (:id, 'free', 'active')`,
    { id },
  );

  res.status(201).json({ id, businessName, organizationId: orgId });
});

export default router;
