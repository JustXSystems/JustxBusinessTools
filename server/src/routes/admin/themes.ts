import { Router } from "express";
import { pool } from "../../db.js";
import { jsonVal } from "../../lib/admin/approvals.js";
import { getActiveOrgId } from "../../lib/request-context.js";

/** JustXSystems Electric — deep royal blue surfaces + electric cyan (brand strip). */
const JUSTX_ELECTRIC = {
  accent: "#00dfff",
  teal: "#00dfff",
  accentStrong: "#1a6fd4",
  bg0: "#081018",
  bg1: "#0c1829",
  bg2: "#122440",
  radius: "16px",
  font: "system-ui",
  scheme: "dark",
};

const JUSTX_LIGHT = {
  accent: "#007a99",
  teal: "#0f766e",
  accentStrong: "#1a6fd4",
  bg0: "#eef3f8",
  bg1: "#f7fafc",
  bg2: "#ffffff",
  radius: "16px",
  font: "system-ui",
  scheme: "light",
};

const DEFAULT_TOKENS = { ...JUSTX_ELECTRIC };

const PRESETS = [
  { name: "JustXSystems Electric", tokens: JUSTX_ELECTRIC },
  { name: "JustXSystems Light", tokens: JUSTX_LIGHT },
  {
    name: "Midnight Cyan",
    tokens: {
      accent: "#00dfff",
      teal: "#2dd4bf",
      accentStrong: "#00b8d4",
      bg0: "#0a0b0f",
      bg1: "#12141c",
      bg2: "#1a1d28",
      radius: "14px",
      font: "system-ui",
      scheme: "dark",
    },
  },
  {
    name: "Royal Indigo",
    tokens: {
      ...DEFAULT_TOKENS,
      accent: "#818cf8",
      teal: "#a78bfa",
      accentStrong: "#6366f1",
      bg0: "#0b0a12",
      bg1: "#151322",
      bg2: "#1e1b2e",
    },
  },
  {
    name: "Emerald Ledger",
    tokens: {
      ...DEFAULT_TOKENS,
      accent: "#34d399",
      teal: "#6ee7b7",
      accentStrong: "#059669",
      bg0: "#07110c",
      bg1: "#0f1c16",
      bg2: "#16261e",
    },
  },
  {
    name: "Sunset Gold",
    tokens: {
      ...DEFAULT_TOKENS,
      accent: "#fbbf24",
      teal: "#fb923c",
      accentStrong: "#d97706",
      bg0: "#120d07",
      bg1: "#1c150c",
      bg2: "#2a1f12",
    },
  },
];

const router = Router();

router.get("/", async (_req, res) => {
  const orgId = getActiveOrgId();
  const [rows] = await pool.query(
    `SELECT id, name, is_active, tokens, updated_at FROM org_themes WHERE organization_id = :orgId ORDER BY is_active DESC, id`,
    { orgId },
  );
  res.json({
    presets: PRESETS,
    themes: (Array.isArray(rows) ? rows : []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: Number(r.id),
        name: String(r.name),
        isActive: Boolean(r.is_active),
        tokens: jsonVal(r.tokens) ?? DEFAULT_TOKENS,
        updatedAt: String(r.updated_at),
      };
    }),
  });
});

router.post("/", async (req, res) => {
  const orgId = getActiveOrgId();
  const name = String(req.body?.name ?? "Custom theme").trim();
  const tokens = req.body?.tokens ?? DEFAULT_TOKENS;
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
