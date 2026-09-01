import { Router } from "express";
import { logAudit } from "../../lib/audit.js";
import { getActiveOrgId } from "../../lib/request-context.js";
import {
  getToolSku,
  listToolSkus,
  updateToolSku,
  upsertToolSku,
} from "../../lib/tool-skus.js";
import {
  extendToolLicenses,
  listActiveLicenses,
} from "../../lib/tool-licenses.js";
import { activateAllToolsPack, activateToolCommerce, deactivateToolCommerce } from "../../lib/commerce.js";
import {
  deleteProductBundle,
  listProductBundles,
  resolveBundleToolIds,
  upsertProductBundle,
} from "../../lib/product-bundles.js";
import { listSubscriptionItems } from "../../lib/subscription-items.js";

const router = Router();

router.get("/", async (_req, res) => {
  const orgId = getActiveOrgId();
  const [skus, licenses, bundles, billingItems] = await Promise.all([
    listToolSkus(),
    listActiveLicenses(orgId),
    listProductBundles(),
    listSubscriptionItems(orgId),
  ]);
  res.json({ skus, licenses, bundles, billingItems });
});

router.post("/", async (req, res) => {
  const toolId = String(req.body?.toolId ?? req.body?.id ?? "").trim();
  const name = String(req.body?.name ?? "").trim();
  if (!toolId || !name) {
    res.status(400).json({ error: "toolId and name required" });
    return;
  }
  const sku = await upsertToolSku(toolId, {
    name,
    category: req.body?.category,
    priceInr: req.body?.priceInr,
    includedFree: req.body?.includedFree,
    available: req.body?.available,
    tagline: req.body?.tagline,
    description: req.body?.description,
    annualPriceInr: req.body?.annualPriceInr,
    trialDays: req.body?.trialDays,
    accessPolicy: req.body?.accessPolicy,
    unlicensedRecordLimit: req.body?.unlicensedRecordLimit,
    featured: req.body?.featured,
    billingInterval: req.body?.billingInterval,
  });
  await logAudit("sku.upsert", "tool_sku", toolId, { priceInr: sku.priceInr }, req.ip);
  res.status(201).json({ sku });
});

router.get("/bundles", async (_req, res) => {
  res.json({ bundles: await listProductBundles() });
});

router.post("/bundles", async (req, res) => {
  const bundle = await upsertProductBundle({
    id: String(req.body?.id ?? ""),
    name: String(req.body?.name ?? ""),
    tagline: req.body?.tagline,
    description: req.body?.description,
    discountPct: req.body?.discountPct,
    fixedPriceInr: req.body?.fixedPriceInr,
    available: req.body?.available,
    highlighted: req.body?.highlighted,
    sortOrder: req.body?.sortOrder,
    toolIds: Array.isArray(req.body?.toolIds) ? req.body.toolIds.map(String) : [],
  });
  await logAudit("bundle.create", "product_bundle", bundle.id, undefined, req.ip);
  res.status(201).json({ bundle });
});

router.put("/bundles/:id", async (req, res) => {
  const bundle = await upsertProductBundle({
    id: req.params.id,
    name: String(req.body?.name ?? req.params.id),
    tagline: req.body?.tagline,
    description: req.body?.description,
    discountPct: req.body?.discountPct,
    fixedPriceInr: req.body?.fixedPriceInr,
    available: req.body?.available,
    highlighted: req.body?.highlighted,
    sortOrder: req.body?.sortOrder,
    toolIds: Array.isArray(req.body?.toolIds) ? req.body.toolIds.map(String) : undefined,
  });
  await logAudit("bundle.upsert", "product_bundle", bundle.id, { priceInr: bundle.priceInr }, req.ip);
  res.json({ bundle });
});

router.delete("/bundles/:id", async (req, res) => {
  await deleteProductBundle(req.params.id);
  await logAudit("bundle.delete", "product_bundle", req.params.id, undefined, req.ip);
  res.json({ ok: true });
});

router.post("/grant", async (req, res) => {
  const orgId = getActiveOrgId();
  const days = Math.max(1, Number(req.body?.days ?? 30));
  const periodEnd = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const all = Boolean(req.body?.allPaid);
  const preferTrial = Boolean(req.body?.preferTrial);
  const bundleId = req.body?.bundleId ? String(req.body.bundleId) : "";
  const toolIds = Array.isArray(req.body?.toolIds) ? req.body.toolIds.map(String) : [];
  let granted: string[];
  if (bundleId) {
    granted = await resolveBundleToolIds(bundleId);
    if (bundleId === "all_tools") {
      await activateAllToolsPack({
        orgId,
        source: "pack",
        periodEnd,
      });
    } else {
      await activateToolCommerce({
        orgId,
        toolIds: granted,
        source: "pack",
        periodEnd: preferTrial ? undefined : periodEnd,
        preferTrial,
        defaultDays: days,
      });
    }
  } else if (all) {
    granted = (
      await activateAllToolsPack({
        orgId,
        source: "admin",
        periodEnd,
      })
    ).granted;
  } else if (toolIds.length > 0) {
    granted = (
      await activateToolCommerce({
        orgId,
        toolIds,
        source: preferTrial ? "trial" : "admin",
        periodEnd: preferTrial ? undefined : periodEnd,
        preferTrial,
        defaultDays: days,
      })
    ).granted;
  } else {
    res.status(400).json({ error: "Select tools, a pack (bundleId), or pass allPaid" });
    return;
  }
  await logAudit(
    "sku.grant",
    "org_tool_license",
    String(orgId),
    { granted, days, bundleId: bundleId || null, preferTrial },
    req.ip,
  );
  res.json({
    ok: true,
    granted,
    periodEnd: periodEnd.toISOString(),
    licenses: await listActiveLicenses(orgId),
    billingItems: await listSubscriptionItems(orgId),
  });
});

router.post("/extend", async (req, res) => {
  const orgId = getActiveOrgId();
  const days = Math.max(1, Number(req.body?.days ?? 30));
  const toolIds = Array.isArray(req.body?.toolIds) ? req.body.toolIds.map(String) : [];
  if (toolIds.length === 0) {
    res.status(400).json({ error: "toolIds required" });
    return;
  }
  const periodEnd = await extendToolLicenses(orgId, toolIds, days);
  await logAudit("sku.extend", "org_tool_license", String(orgId), { toolIds, days }, req.ip);
  res.json({
    ok: true,
    periodEnd: periodEnd.toISOString(),
    licenses: await listActiveLicenses(orgId),
    billingItems: await listSubscriptionItems(orgId),
  });
});

router.post("/revoke", async (req, res) => {
  const orgId = getActiveOrgId();
  const toolIds = Array.isArray(req.body?.toolIds) ? req.body.toolIds.map(String) : undefined;
  await deactivateToolCommerce({ orgId, toolIds });
  await logAudit("sku.revoke", "org_tool_license", String(orgId), { toolIds: toolIds ?? "all" }, req.ip);
  res.json({ ok: true, licenses: await listActiveLicenses(orgId), billingItems: await listSubscriptionItems(orgId) });
});

router.put("/:toolId", async (req, res) => {
  if (req.params.toolId === "bundles" || req.params.toolId === "grant") {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const existing = await getToolSku(req.params.toolId);
  if (!existing && req.body?.name) {
    const sku = await upsertToolSku(req.params.toolId, {
      name: String(req.body.name),
      category: req.body?.category,
      priceInr: req.body?.priceInr,
      includedFree: req.body?.includedFree,
      available: req.body?.available,
      tagline: req.body?.tagline,
      description: req.body?.description,
      annualPriceInr: req.body?.annualPriceInr,
      trialDays: req.body?.trialDays,
      accessPolicy: req.body?.accessPolicy,
      unlicensedRecordLimit: req.body?.unlicensedRecordLimit,
      featured: req.body?.featured,
      billingInterval: req.body?.billingInterval,
    });
    await logAudit("sku.upsert", "tool_sku", req.params.toolId, { priceInr: sku.priceInr }, req.ip);
    res.json({ sku });
    return;
  }
  const sku = await updateToolSku(req.params.toolId, {
    name: req.body?.name,
    category: req.body?.category,
    tagline: req.body?.tagline,
    description: req.body?.description,
    priceInr: req.body?.priceInr,
    annualPriceInr: req.body?.annualPriceInr,
    billingInterval: req.body?.billingInterval,
    includedFree: req.body?.includedFree,
    available: req.body?.available,
    sortOrder: req.body?.sortOrder,
    trialDays: req.body?.trialDays,
    accessPolicy: req.body?.accessPolicy,
    unlicensedRecordLimit: req.body?.unlicensedRecordLimit,
    featured: req.body?.featured,
  });
  await logAudit(
    "sku.update",
    "tool_sku",
    req.params.toolId,
    { priceInr: sku.priceInr, accessPolicy: sku.accessPolicy },
    req.ip,
  );
  res.json({ sku });
});

export default router;
