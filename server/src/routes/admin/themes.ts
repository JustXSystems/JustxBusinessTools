import { Router } from "express";
import { pool } from "../../db.js";
import { jsonVal } from "../../lib/admin/approvals.js";
import { getActiveOrgId } from "../../lib/request-context.js";
import { DEFAULT_THEME_TOKENS, THEME_PRESETS } from "../../lib/theme-presets.js";

const router = Router();

router.get("/", async (_req, res) => {
  const orgId = getActiveOrgId();
  const [rows] = await pool.query(
    `SELECT id, name, is_active, tokens, updated_at FROM org_themes WHERE organization_id = :orgId ORDER BY is_active DESC, id`,
    { orgId },
  );
  res.json({
    presets: THEME_PRESETS,
    themes: (Array.isArray(rows) ? rows : []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: Number(r.id),
        name: String(r.name),
        isActive: Boolean(r.is_active),
        tokens: jsonVal(r.tokens) ?? DEFAULT_THEME_TOKENS,
        updatedAt: String(r.updated_at),
      };
    }),
  });
});

router.post("/", async (req, res) => {
  const orgId = getActiveOrgId();
  const name = String(req.body?.name ?? "Custom theme").trim();
  const tokens = req.body?.tokens ?? DEFAULT_THEME_TOKENS;
  const [result] = await pool.query(
    `INSERT INTO org_themes (organization_id, name, is_active, tokens) VALUES (:orgId, :name, 0, :tokens)`,
    { orgId, name, tokens: JSON.stringify(tokens) },
  );
  res.status(201).json({ id: Number((result as { insertId: number }).insertId) });
});

router.put("/:id", async (req, res) => {
  await pool.query(
    `UPDATE org_themes SET name = COALESCE(:name, name), tokens = COALESCE(:tokens, tokens)
     WHERE id = :id AND organization_id = :orgId`,
    {
      id: Number(req.params.id),
      orgId: getActiveOrgId(),
      name: req.body?.name ?? null,
      tokens: req.body?.tokens ? JSON.stringify(req.body.tokens) : null,
    },
  );
  res.json({ ok: true });
});

router.post("/:id/activate", async (req, res) => {
  const orgId = getActiveOrgId();
  const id = Number(req.params.id);
  await pool.query(`UPDATE org_themes SET is_active = 0 WHERE organization_id = :orgId`, { orgId });
  await pool.query(
    `UPDATE org_themes SET is_active = 1 WHERE id = :id AND organization_id = :orgId`,
    { id, orgId },
  );
  res.json({ ok: true });
});

router.delete("/:id", async (req, res) => {
  await pool.query(
    `DELETE FROM org_themes WHERE id = :id AND organization_id = :orgId AND is_active = 0`,
    { id: Number(req.params.id), orgId: getActiveOrgId() },
  );
  res.json({ ok: true });
});

export default router;
