import { Router } from "express";
import { pool } from "../../db.js";
import { getActiveOrgId } from "../../lib/request-context.js";

const router = Router();

router.get("/", async (_req, res) => {
  const orgId = getActiveOrgId();
  const [rows] = await pool.query(
    `SELECT id, business_name, gstin, is_default, address_line1, state, phone, email
     FROM business_profiles WHERE organization_id = :orgId ORDER BY is_default DESC, id`,
    { orgId },
  );
  const branches = (Array.isArray(rows) ? rows : []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: Number(r.id),
      businessName: String(r.business_name),
      gstin: r.gstin as string | null,
      isDefault: Boolean(r.is_default),
      addressLine1: r.address_line1 as string | null,
      state: r.state as string | null,
      phone: r.phone as string | null,
      email: r.email as string | null,
    };
  });
  res.json({ branches });
});

router.post("/", async (req, res) => {
  const orgId = getActiveOrgId();
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

  res.status(201).json({ id, businessName });
});

export default router;
