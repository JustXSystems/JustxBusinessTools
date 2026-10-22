import { Router } from "express";
import { pool } from "../../db.js";
import { logAudit } from "../../lib/audit.js";
import { getActiveOrgId, getActiveProfileId } from "../../lib/request-context.js";
import { isPlatformAdmin } from "../../lib/platform-admin.js";
import {
  getToolSku,
  listToolSkus,
  updateToolSku,
  upsertToolSku,
} from "../../lib/tool-skus.js";
import {
  extendToolLicenses,
  getProfileToolEntitlement,
  listActiveLicenses,
  listActiveLicensesForOrg,
  listProfileEntitlements,
  setRecordLimitOverride,
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

async function resolveProfileId(raw: unknown): Promise<number> {
  const orgId = getActiveOrgId();
  const requested = Number(raw);
  if (Number.isInteger(requested) && requested > 0) {
    const [rows] = await pool.query(
      `SELECT id FROM business_profiles
       WHERE id = :id AND organization_id = :orgId LIMIT 1`,
      { id: requested, orgId },
    );
    if (Array.isArray(rows) && rows.length > 0) return requested;
    throw Object.assign(new Error("Business profile not found in this organization"), {
      status: 404,
    });
  }
  return getActiveProfileId();
}

async function listOrgProfiles(orgId: number) {
  const [rows] = await pool.query(
    `SELECT id, business_name, is_default FROM business_profiles
     WHERE organization_id = :orgId
     ORDER BY is_default DESC, business_name ASC`,
    { orgId },
  );
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: Number(r.id),
      businessName: String(r.business_name ?? `Profile #${r.id}`),
      isDefault: Boolean(r.is_default),
    };
  });
}

router.get("/", async (req, res) => {
  try {
    const orgId = getActiveOrgId();
    const profileId = await resolveProfileId(req.query.businessProfileId ?? req.query.profileId);
    const [skus, licenses, entitlements, orgLicenses, bundles, billingItems, profiles] =
      await Promise.all([
        listToolSkus(),
        listActiveLicenses(profileId),
        listProfileEntitlements(profileId),
        listActiveLicensesForOrg(orgId),
        listProductBundles(),
        listSubscriptionItems(orgId),
        listOrgProfiles(orgId),
      ]);
    res.json({
      skus,
      licenses,
      entitlements,
      orgLicenses,
      bundles,
      billingItems,
      profiles,
      businessProfileId: profileId,
    });
  } catch (err) {
    const status = Number((err as { status?: number }).status) || 500;
    res.status(status).json({ error: err instanceof Error ? err.message : "Failed to load SKUs" });
  }
});

router.post("/", async (req, res) => {
  if (!isPlatformAdmin()) {
    res.status(403).json({ error: "Platform admin required to manage SKUs" });
    return;
  }
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
  if (!isPlatformAdmin()) {
    res.status(403).json({ error: "Platform admin required to manage bundles" });
    return;
  }
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
  if (!isPlatformAdmin()) {
    res.status(403).json({ error: "Platform admin required to manage bundles" });
    return;
  }
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
  if (!isPlatformAdmin()) {
    res.status(403).json({ error: "Platform admin required to manage bundles" });
    return;
  }
  await deleteProductBundle(req.params.id);
  await logAudit("bundle.delete", "product_bundle", req.params.id, undefined, req.ip);
  res.json({ ok: true });
});

router.post("/grant", async (req, res) => {
  try {
    const orgId = getActiveOrgId();
    const profileId = await resolveProfileId(req.body?.businessProfileId ?? req.body?.profileId);
    const days = Math.max(1, Number(req.body?.days ?? 30));
    const periodEnd = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const all = Boolean(req.body?.allPaid);
    const preferTrial = Boolean(req.body?.preferTrial);
    const allProfiles = Boolean(req.body?.allProfiles);
    const bundleId = req.body?.bundleId ? String(req.body.bundleId) : "";
    const toolIds = Array.isArray(req.body?.toolIds) ? req.body.toolIds.map(String) : [];
    let granted: string[];
    if (bundleId) {
      granted = await resolveBundleToolIds(bundleId);
      if (bundleId === "all_tools" || allProfiles) {
        await activateAllToolsPack({
          orgId,
          source: "pack",
          periodEnd,
        });
      } else {
        await activateToolCommerce({
          profileId,
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
      if (allProfiles) {
        const { grantToolLicensesToOrg } = await import("../../lib/tool-licenses.js");
        await grantToolLicensesToOrg(orgId, toolIds, periodEnd);
        granted = toolIds;
      } else {
        granted = (
          await activateToolCommerce({
            profileId,
            orgId,
            toolIds,
            source: preferTrial ? "trial" : "admin",
            periodEnd: preferTrial ? undefined : periodEnd,
            preferTrial,
            defaultDays: days,
          })
        ).granted;
      }
    } else {
      res.status(400).json({ error: "Select tools, a pack (bundleId), or pass allPaid" });
      return;
    }
    await logAudit(
      "sku.grant",
      "profile_tool_license",
      String(profileId),
      { granted, days, bundleId: bundleId || null, preferTrial, allProfiles, orgId },
      req.ip,
    );
    res.json({
      ok: true,
      granted,
      businessProfileId: profileId,
      periodEnd: periodEnd.toISOString(),
      licenses: await listActiveLicenses(profileId),
      orgLicenses: await listActiveLicensesForOrg(orgId),
      billingItems: await listSubscriptionItems(orgId),
    });
  } catch (err) {
    const status = Number((err as { status?: number }).status) || 500;
    res.status(status).json({ error: err instanceof Error ? err.message : "Grant failed" });
  }
});

router.post("/extend", async (req, res) => {
  try {
    const orgId = getActiveOrgId();
    const profileId = await resolveProfileId(req.body?.businessProfileId ?? req.body?.profileId);
    const days = Math.max(1, Number(req.body?.days ?? 30));
    const toolIds = Array.isArray(req.body?.toolIds) ? req.body.toolIds.map(String) : [];
    if (toolIds.length === 0) {
      res.status(400).json({ error: "toolIds required" });
      return;
    }
    const periodEnd = await extendToolLicenses(profileId, toolIds, days);
    await logAudit(
      "sku.extend",
      "profile_tool_license",
      String(profileId),
      { toolIds, days },
      req.ip,
    );
    res.json({
      ok: true,
      businessProfileId: profileId,
      periodEnd: periodEnd.toISOString(),
      licenses: await listActiveLicenses(profileId),
      orgLicenses: await listActiveLicensesForOrg(orgId),
      billingItems: await listSubscriptionItems(orgId),
    });
  } catch (err) {
    const status = Number((err as { status?: number }).status) || 500;
    res.status(status).json({ error: err instanceof Error ? err.message : "Extend failed" });
  }
});

/** Extend / set freemium record cap for a profile+tool (does not grant a paid license). */
router.post("/record-limit", async (req, res) => {
  try {
    const profileId = await resolveProfileId(req.body?.businessProfileId ?? req.body?.profileId);
    const toolId = String(req.body?.toolId ?? "").trim();
    if (!toolId) {
      res.status(400).json({ error: "toolId required" });
      return;
    }
    const raw = req.body?.recordLimit;
    const recordLimit =
      raw === null || raw === undefined || raw === ""
        ? null
        : Math.max(0, Math.floor(Number(raw)));
    if (recordLimit != null && Number.isNaN(recordLimit)) {
      res.status(400).json({ error: "recordLimit must be a number or null" });
      return;
    }
    const entitlement = await setRecordLimitOverride(profileId, toolId, recordLimit);
    await logAudit(
      "sku.record_limit",
      "profile_tool_license",
      String(profileId),
      { toolId, recordLimit },
      req.ip,
    );
    res.json({
      ok: true,
      businessProfileId: profileId,
      entitlement,
      licenses: await listActiveLicenses(profileId),
    });
  } catch (err) {
    const status = Number((err as { status?: number }).status) || 500;
    res.status(status).json({ error: err instanceof Error ? err.message : "Record limit update failed" });
  }
});

router.get("/entitlement", async (req, res) => {
  try {
    const profileId = await resolveProfileId(req.query.businessProfileId ?? req.query.profileId);
    const toolId = String(req.query.toolId ?? "").trim();
    if (!toolId) {
      res.status(400).json({ error: "toolId required" });
      return;
    }
    const entitlement = await getProfileToolEntitlement(profileId, toolId);
    res.json({ businessProfileId: profileId, toolId, entitlement });
  } catch (err) {
    const status = Number((err as { status?: number }).status) || 500;
    res.status(status).json({ error: err instanceof Error ? err.message : "Lookup failed" });
  }
});

router.post("/revoke", async (req, res) => {
  try {
    const orgId = getActiveOrgId();
    const allProfiles = Boolean(req.body?.allProfiles);
    const toolIds = Array.isArray(req.body?.toolIds) ? req.body.toolIds.map(String) : undefined;
    let profileId = getActiveProfileId();
    if (!allProfiles) {
      profileId = await resolveProfileId(req.body?.businessProfileId ?? req.body?.profileId);
      await deactivateToolCommerce({ profileId, orgId, toolIds });
    } else {
      await deactivateToolCommerce({ orgId, toolIds });
    }
    await logAudit(
      "sku.revoke",
      "profile_tool_license",
      allProfiles ? String(orgId) : String(profileId),
      { toolIds: toolIds ?? "all", allProfiles },
      req.ip,
    );
    res.json({
      ok: true,
      businessProfileId: allProfiles ? null : profileId,
      licenses: allProfiles ? [] : await listActiveLicenses(profileId),
      orgLicenses: await listActiveLicensesForOrg(orgId),
      billingItems: await listSubscriptionItems(orgId),
    });
  } catch (err) {
    const status = Number((err as { status?: number }).status) || 500;
    res.status(status).json({ error: err instanceof Error ? err.message : "Revoke failed" });
  }
});

router.put("/:toolId", async (req, res) => {
  if (!isPlatformAdmin()) {
    res.status(403).json({ error: "Platform admin required to manage SKUs" });
    return;
  }
  if (
    req.params.toolId === "bundles" ||
    req.params.toolId === "grant" ||
    req.params.toolId === "extend" ||
    req.params.toolId === "revoke" ||
    req.params.toolId === "record-limit" ||
    req.params.toolId === "entitlement"
  ) {
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
