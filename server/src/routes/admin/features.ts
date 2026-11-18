import { Router } from "express";
import { pool } from "../../db.js";
import { logAudit } from "../../lib/audit.js";
import {
  FEATURE_SWITCHES,
  getOrgFeatureSwitches,
  isFeatureSwitchKey,
  setOrgFeatureSwitch,
} from "../../lib/feature-switches.js";
import { getActiveUserId } from "../../lib/request-context.js";
import {
  adminResolveError,
  requireAdminOrgId,
  resolveAdminBusinessProfile,
} from "../../lib/admin/tenant-guard.js";

const router = Router();

async function listSwitches(orgId: number) {
  const state = await getOrgFeatureSwitches(orgId);
  return FEATURE_SWITCHES.map((s) => ({ ...s, enabled: state[s.key] }));
}

async function resolveFeatureOrg(input: {
  organizationId?: unknown;
  businessProfileId?: unknown;
  profileId?: unknown;
}): Promise<number | { error: string; status: number }> {
  const profile = await resolveAdminBusinessProfile(
    input.businessProfileId ?? input.profileId,
  );
  if (adminResolveError(profile)) return profile;
  return requireAdminOrgId(input.organizationId ?? profile?.organizationId);
}

router.get("/", async (req, res) => {
  const orgResolved = await resolveFeatureOrg({
    organizationId: req.query.organizationId,
    businessProfileId: req.query.businessProfileId,
    profileId: req.query.profileId,
  });
  if (adminResolveError(orgResolved)) {
    res.status(orgResolved.status).json({ error: orgResolved.error });
    return;
  }
  res.json({ switches: await listSwitches(orgResolved), organizationId: orgResolved });
});

router.put("/:key", async (req, res) => {
  const key = req.params.key;
  if (!isFeatureSwitchKey(key)) {
    res.status(404).json({ error: "Unknown switch" });
    return;
  }
  if (typeof req.body?.enabled !== "boolean") {
    res.status(400).json({ error: "enabled (true/false) is required" });
    return;
  }
  const orgResolved = await resolveFeatureOrg({
    organizationId: req.body?.organizationId,
    businessProfileId: req.body?.businessProfileId,
    profileId: req.body?.profileId,
  });
  if (adminResolveError(orgResolved)) {
    res.status(orgResolved.status).json({ error: orgResolved.error });
    return;
  }
  const orgId = orgResolved;
  const enabled = req.body.enabled as boolean;
  await setOrgFeatureSwitch(orgId, key, enabled, getActiveUserId());
  await pool.query(
    `UPDATE business_profiles SET config_version = config_version + 1 WHERE organization_id = :orgId`,
    { orgId },
  );
  await logAudit(enabled ? "feature.enable" : "feature.disable", "feature", key, { enabled }, req.ip);
  res.json({ switches: await listSwitches(orgId), organizationId: orgId });
});

export default router;
