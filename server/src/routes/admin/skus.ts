import { Router } from "express";
import { logAudit } from "../../lib/audit.js";
import { getActiveOrgId } from "../../lib/request-context.js";
import { listToolSkus, updateToolSku } from "../../lib/tool-skus.js";
import {
  grantAllPaidSkus,
  grantToolLicenses,
  listActiveLicenses,
  revokeToolLicenses,
} from "../../lib/tool-licenses.js";

const router = Router();

router.get("/", async (_req, res) => {
  const orgId = getActiveOrgId();
  const [skus, licenses] = await Promise.all([listToolSkus(), listActiveLicenses(orgId)]);
  res.json({ skus, licenses });
});

router.put("/:toolId", async (req, res) => {
  const sku = await updateToolSku(req.params.toolId, {
    name: req.body?.name,
    category: req.body?.category,
    priceInr: req.body?.priceInr,
    billingInterval: req.body?.billingInterval,
    includedFree: req.body?.includedFree,
    available: req.body?.available,
    sortOrder: req.body?.sortOrder,
  });
  await logAudit("sku.update", "tool_sku", req.params.toolId, { priceInr: sku.priceInr }, req.ip);
  res.json({ sku });
});

router.post("/grant", async (req, res) => {
  const orgId = getActiveOrgId();
  const days = Math.max(1, Number(req.body?.days ?? 30));
  const periodEnd = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const all = Boolean(req.body?.allPaid);
  const toolIds = Array.isArray(req.body?.toolIds) ? req.body.toolIds.map(String) : [];
  if (!all && toolIds.length === 0) {
    res.status(400).json({ error: "Select tools to grant, or pass allPaid" });
    return;
  }
  let granted: string[];
  if (all) {
    granted = await grantAllPaidSkus(orgId, periodEnd);
  } else {
    await grantToolLicenses(orgId, toolIds, periodEnd);
    granted = toolIds;
  }
  await logAudit("sku.grant", "org_tool_license", String(orgId), { granted }, req.ip);
  res.json({ ok: true, granted, licenses: await listActiveLicenses(orgId) });
});

router.post("/revoke", async (req, res) => {
  const orgId = getActiveOrgId();
  const toolIds = Array.isArray(req.body?.toolIds) ? req.body.toolIds.map(String) : undefined;
  await revokeToolLicenses(orgId, toolIds);
  await logAudit("sku.revoke", "org_tool_license", String(orgId), { toolIds: toolIds ?? "all" }, req.ip);
  res.json({ ok: true, licenses: await listActiveLicenses(orgId) });
});

export default router;
