import { Router } from "express";
import { pool } from "../../db.js";
import { logAudit } from "../../lib/audit.js";
import { jsonVal } from "../../lib/admin/approvals.js";
import { getActiveOrgId } from "../../lib/request-context.js";
import { publishToolDefinition, listToolDefinitions } from "../../lib/config/effective.js";
import { appendToolToOrgHomeSelections } from "../../lib/home-tools.js";

const DEFAULT_TOOLS = [
  ["quotation", "Sales & Business"],
  ["quotationv1", "Sales & Business"],
  ["salesorder", "Sales & Business"],
  ["invoice", "Sales & Business"],
  ["paymenttracker", "Sales & Business"],
  ["po", "Procurement"],
  ["vendors", "Procurement"],
  ["stock", "Inventory"],
  ["projects", "Projects & Service"],
  ["amc", "Projects & Service"],
  ["servicetasks", "Projects & Service"],
  ["installation", "Projects & Service"],
  ["sitesurvey", "Solar Solutions"],
  ["sitesurveyv1", "Solar Solutions"],
  ["solarroi", "Finance & Calculators"],
  ["gstcalc", "Finance & Calculators"],
  ["tdscalc", "Finance & Calculators"],
  ["taxcalc", "Finance & Calculators"],
  ["profitcalc", "Finance & Calculators"],
  ["emicalc", "Finance & Calculators"],
  ["loancalc", "Finance & Calculators"],
  ["dealercommission", "Dealers / Distributors"],
  ["pricelist", "Dealers / Distributors"],
  ["creditlimit", "Dealers / Distributors"],
  ["targettracker", "Dealers / Distributors"],
  ["dealerorders", "Dealers / Distributors"],
  ["visitors", "Utilities"],
  ["qrscanner", "Utilities"],
] as const;

const router = Router();

async function bumpOrgConfigVersions(orgId: number): Promise<void> {
  await pool.query(
    `UPDATE business_profiles SET config_version = config_version + 1 WHERE organization_id = :orgId`,
    { orgId },
  );
}

async function ensureCatalog(orgId: number): Promise<void> {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM tool_catalog WHERE organization_id = :orgId`,
    { orgId },
  );
  const first = Array.isArray(rows) ? (rows[0] as { cnt: number }) : { cnt: 0 };
  if (Number(first.cnt) === 0) {
    let order = 0;
    for (const [toolId, group] of DEFAULT_TOOLS) {
      await pool.query(
        `INSERT INTO tool_catalog (organization_id, tool_id, group_name, sort_order, available)
         VALUES (:orgId, :toolId, :groupName, :sortOrder, 1)`,
        { orgId, toolId, groupName: group, sortOrder: order++ },
      );
    }
  } else {
    await pool.query(
      `INSERT IGNORE INTO tool_catalog (organization_id, tool_id, group_name, sort_order, available)
       VALUES (:orgId, 'quotationv1', 'Sales & Business', 1, 1)`,
      { orgId },
    );
    await pool.query(
      `INSERT IGNORE INTO tool_catalog (organization_id, tool_id, group_name, sort_order, available)
       VALUES (:orgId, 'sitesurveyv1', 'Solar Solutions', 14, 1)`,
      { orgId },
    );
  }

  // New tools added after branch home allowlists were saved stay invisible unless we opt them in.
  const [liveRows] = await pool.query(
    `SELECT tool_id FROM tool_catalog
     WHERE organization_id = :orgId AND available = 1
       AND tool_id IN ('sitesurveyv1', 'quotationv1')`,
    { orgId },
  );
  for (const row of Array.isArray(liveRows) ? liveRows : []) {
    await appendToolToOrgHomeSelections(orgId, String((row as { tool_id: string }).tool_id));
  }
}

router.get("/", async (_req, res) => {
  const orgId = getActiveOrgId();
  await ensureCatalog(orgId);
  const defs = await listToolDefinitions();
  const defMap = new Map(defs.map((d) => [d.id, d]));
  const [rows] = await pool.query(
    `SELECT tool_id, group_name, sort_order, available, formula, field_overrides
     FROM tool_catalog WHERE organization_id = :orgId ORDER BY sort_order, tool_id`,
    { orgId },
  );
  const tools = (Array.isArray(rows) ? rows : []).map((row) => {
    const r = row as Record<string, unknown>;
    const id = String(r.tool_id);
    const def = defMap.get(id);
    return {
      id,
      groupName: String(r.group_name),
      sortOrder: Number(r.sort_order),
      available: Boolean(r.available),
      formula: (r.formula as string | null) ?? null,
      fieldOverrides: jsonVal(r.field_overrides),
      toolType: def?.toolType ?? "tracker",
      definition: def?.definition ?? {},
    };
  });
  res.json({ tools });
});

router.post("/", async (req, res) => {
  const orgId = getActiveOrgId();
  const toolId = String(req.body?.id ?? "").trim();
  const title = String(req.body?.title ?? "").trim();
  if (!toolId || !title) {
    res.status(400).json({ error: "id and title required" });
    return;
  }
  const definition = (req.body?.definition as Record<string, unknown>) ?? {
    type: "tracker",
    key: toolId,
    title,
    icon: req.body?.icon ?? "📋",
    subtitle: req.body?.subtitle ?? "",
    category: req.body?.groupName ?? "Custom Tools",
    fields: [{ key: "name", label: "Name", type: "text", required: true }],
    titleField: "name",
  };
  await publishToolDefinition(toolId, definition);
  const [maxRows] = await pool.query(
    `SELECT COALESCE(MAX(sort_order), 0) + 1 AS nextOrd FROM tool_catalog WHERE organization_id = :orgId`,
    { orgId },
  );
  const maxFirst = Array.isArray(maxRows) ? (maxRows[0] as { nextOrd: number }) : { nextOrd: 1 };
  const nextOrd = Number(maxFirst.nextOrd);
  await pool.query(
    `INSERT INTO tool_catalog (organization_id, tool_id, group_name, sort_order, available, formula)
     VALUES (:orgId, :toolId, :groupName, :sortOrder, 1, :formula)
     ON DUPLICATE KEY UPDATE group_name = VALUES(group_name)`,
    {
      orgId,
      toolId,
      groupName: String(req.body?.groupName ?? "Custom Tools"),
      sortOrder: nextOrd,
      formula: req.body?.formula ?? null,
    },
  );
  await logAudit("tool.create", "tool", toolId, { title }, req.ip);
  res.status(201).json({ id: toolId });
});

router.put("/:toolId", async (req, res) => {
  const orgId = getActiveOrgId();
  const toolId = req.params.toolId;
  if (req.body?.definition && typeof req.body.definition === "object") {
    await publishToolDefinition(toolId, req.body.definition as Record<string, unknown>);
  }
  await pool.query(
    `INSERT INTO tool_catalog (organization_id, tool_id, group_name, sort_order, available, formula, field_overrides)
     VALUES (:orgId, :toolId, COALESCE(:groupName, 'General'), COALESCE(:sortOrder, 0), COALESCE(:available, 1), :formula, :overrides)
     ON DUPLICATE KEY UPDATE
       group_name = COALESCE(:groupName, group_name),
       sort_order = COALESCE(:sortOrder, sort_order),
       available = COALESCE(:available, available),
       formula = COALESCE(:formula, formula),
       field_overrides = COALESCE(:overrides, field_overrides)`,
    {
      orgId,
      toolId,
      groupName: req.body?.groupName ?? null,
      sortOrder: req.body?.sortOrder ?? null,
      available: req.body?.available == null ? null : Number(Boolean(req.body.available)),
      formula: req.body?.formula ?? null,
      overrides: req.body?.fieldOverrides ? JSON.stringify(req.body.fieldOverrides) : null,
    },
  );

  const makingLive = req.body?.available == null ? true : Boolean(req.body.available);
  if (makingLive) {
    await appendToolToOrgHomeSelections(orgId, toolId);
  }
  await bumpOrgConfigVersions(orgId);
  await logAudit("tool.update", "tool", toolId, undefined, req.ip);
  res.json({ ok: true });
});

router.post("/reorder", async (req, res) => {
  const orgId = getActiveOrgId();
  const items = Array.isArray(req.body?.items) ? req.body.items as Array<{ id: string; sortOrder: number; groupName?: string }> : [];
  for (const item of items) {
    await pool.query(
      `UPDATE tool_catalog SET sort_order = :sortOrder, group_name = COALESCE(:groupName, group_name)
       WHERE organization_id = :orgId AND tool_id = :toolId`,
      { orgId, toolId: item.id, sortOrder: item.sortOrder, groupName: item.groupName ?? null },
    );
  }
  res.json({ ok: true });
});

router.delete("/:toolId", async (req, res) => {
  const orgId = getActiveOrgId();
  const toolId = req.params.toolId;
  await pool.query(
    `UPDATE tool_catalog SET available = 0 WHERE organization_id = :orgId AND tool_id = :toolId`,
    { orgId, toolId },
  );
  await bumpOrgConfigVersions(orgId);
  await logAudit("tool.disable", "tool", toolId, undefined, req.ip);
  res.json({ ok: true, available: false });
});

export default router;
