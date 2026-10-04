import { Router } from "express";
import { pool } from "../../db.js";
import { logAudit } from "../../lib/audit.js";
import {
  FEATURE_SWITCHES,
  getOrgFeatureSwitches,
  isFeatureSwitchKey,
  setOrgFeatureSwitch,
} from "../../lib/feature-switches.js";
import { getActiveOrgId, getActiveUserId } from "../../lib/request-context.js";

const router = Router();

async function listSwitches(orgId: number) {
  const state = await getOrgFeatureSwitches(orgId);
  return FEATURE_SWITCHES.map((s) => ({ ...s, enabled: state[s.key] }));
}

router.get("/", async (_req, res) => {
  res.json({ switches: await listSwitches(getActiveOrgId()) });
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
  const orgId = getActiveOrgId();
  const enabled = req.body.enabled as boolean;
  await setOrgFeatureSwitch(orgId, key, enabled, getActiveUserId());
  await pool.query(`UPDATE business_profiles SET config_version = config_version + 1 WHERE organization_id = :orgId`, { orgId });
  await logAudit(enabled ? "feature.enable" : "feature.disable", "feature", key, { enabled }, req.ip);
  res.json({ switches: await listSwitches(orgId) });
});

export default router;
