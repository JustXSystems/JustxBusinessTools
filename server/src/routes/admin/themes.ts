import { Router } from "express";
import { pool } from "../../db.js";
import { jsonVal } from "../../lib/admin/approvals.js";
import { orgEqualsSql, orgScopeParams } from "../../lib/platform-admin.js";
import {
  adminResolveError,
  optionalAdminOrgFilter,
  requireAdminOrgId,
  resolveAdminResourceOrgId,
} from "../../lib/admin/tenant-guard.js";
import { DEFAULT_THEME_TOKENS, THEME_PRESETS } from "../../lib/theme-presets.js";

const router = Router();

router.get("/", async (req, res) => {
  const filter = optionalAdminOrgFilter(req.query.organizationId);
  if (adminResolveError(filter)) {
    res.status(filter.status).json({ error: filter.error });
    return;
  }
  const orgPred =
    filter.orgId != null ? "t.organization_id = :filterOrgId" : orgEqualsSql("t.organization_id");
  const [rows] = await pool.query(
    `SELECT t.id, t.organization_id, o.name AS organization_name, t.name, t.is_active, t.tokens, t.updated_at
     FROM org_themes t
     LEFT JOIN organizations o ON o.id = t.organization_id
     WHERE ${orgPred}
     ORDER BY o.name ASC, t.is_active DESC, t.id`,
    { filterOrgId: filter.orgId, ...orgScopeParams() },
  );
  res.json({
    presets: THEME_PRESETS,
    organizationId: filter.orgId,
    themes: (Array.isArray(rows) ? rows : []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: Number(r.id),
        organizationId: Number(r.organization_id),
        organizationName: r.organization_name == null ? null : String(r.organization_name),
        name: String(r.name),
        isActive: Boolean(r.is_active),
        tokens: jsonVal(r.tokens) ?? DEFAULT_THEME_TOKENS,
        updatedAt: String(r.updated_at),
      };
    }),
  });
});

router.post("/", async (req, res) => {
  const orgResolved = requireAdminOrgId(req.body?.organizationId);
  if (adminResolveError(orgResolved)) {
    res.status(orgResolved.status).json({ error: orgResolved.error });
    return;
  }
  const orgId = orgResolved;
  const name = String(req.body?.name ?? "Custom theme").trim();
  const tokens = req.body?.tokens ?? DEFAULT_THEME_TOKENS;
  const [result] = await pool.query(
    `INSERT INTO org_themes (organization_id, name, is_active, tokens) VALUES (:orgId, :name, 0, :tokens)`,
    { orgId, name, tokens: JSON.stringify(tokens) },
  );
  res.status(201).json({ id: Number((result as { insertId: number }).insertId), organizationId: orgId });
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const orgResolved = await resolveAdminResourceOrgId("org_themes", id);
  if (adminResolveError(orgResolved)) {
    res.status(orgResolved.status).json({ error: orgResolved.error });
    return;
  }
  await pool.query(
    `UPDATE org_themes SET name = COALESCE(:name, name), tokens = COALESCE(:tokens, tokens)
     WHERE id = :id AND organization_id = :orgId`,
    {
      id,
      orgId: orgResolved,
      name: req.body?.name ?? null,
      tokens: req.body?.tokens ? JSON.stringify(req.body.tokens) : null,
    },
  );
  res.json({ ok: true, organizationId: orgResolved });
});

router.post("/:id/activate", async (req, res) => {
  const id = Number(req.params.id);
  const orgResolved = await resolveAdminResourceOrgId("org_themes", id);
  if (adminResolveError(orgResolved)) {
    res.status(orgResolved.status).json({ error: orgResolved.error });
    return;
  }
  const orgId = orgResolved;
  await pool.query(`UPDATE org_themes SET is_active = 0 WHERE organization_id = :orgId`, { orgId });
  await pool.query(
    `UPDATE org_themes SET is_active = 1 WHERE id = :id AND organization_id = :orgId`,
    { id, orgId },
  );
  res.json({ ok: true, organizationId: orgId });
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const orgResolved = await resolveAdminResourceOrgId("org_themes", id);
  if (adminResolveError(orgResolved)) {
    res.status(orgResolved.status).json({ error: orgResolved.error });
    return;
  }
  await pool.query(
    `DELETE FROM org_themes WHERE id = :id AND organization_id = :orgId AND is_active = 0`,
    { id, orgId: orgResolved },
  );
  res.json({ ok: true });
});

export default router;
