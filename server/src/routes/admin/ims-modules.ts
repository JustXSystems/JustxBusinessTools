import { Router } from "express";
import { pool } from "../../db.js";
import { logAudit } from "../../lib/audit.js";
import {
  IMS_ALWAYS_ON_MODULES,
  IMS_MODULE_CATALOG,
  getProfileImsModules,
  normalizeEnabledModules,
  setProfileImsModules,
} from "../../lib/ims-profile-modules.js";
import { getActiveOrgId, getActiveProfileId, getActiveUserId } from "../../lib/request-context.js";

const router = Router();

async function resolveProfileId(raw: unknown): Promise<number> {
  const orgId = getActiveOrgId();
  const requested = Number(raw);
  if (Number.isInteger(requested) && requested > 0) {
    const [rows] = await pool.query(
      `SELECT id FROM business_profiles WHERE id = :id AND organization_id = :orgId LIMIT 1`,
      { id: requested, orgId },
    );
    if (Array.isArray(rows) && rows.length > 0) return requested;
    throw Object.assign(new Error("Business profile not found in this organization"), { status: 404 });
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
    const businessProfileId = await resolveProfileId(req.query.businessProfileId ?? req.query.profileId);
    const [stored, profiles] = await Promise.all([
      getProfileImsModules(pool, businessProfileId),
      listOrgProfiles(orgId),
    ]);
    const unrestricted = stored == null;
    const enabled = unrestricted ? IMS_MODULE_CATALOG.map((m) => m.key) : stored;
    res.json({
      businessProfileId,
      profiles,
      unrestricted,
      enabled,
      alwaysOn: [...IMS_ALWAYS_ON_MODULES],
      catalog: IMS_MODULE_CATALOG,
    });
  } catch (err) {
    const status = Number((err as { status?: number }).status) || 500;
    res.status(status).json({ error: err instanceof Error ? err.message : "Failed to load IMS modules" });
  }
});

router.put("/", async (req, res) => {
  try {
    const businessProfileId = await resolveProfileId(req.body?.businessProfileId ?? req.body?.profileId);
    const unrestricted = req.body?.unrestricted === true;
    let stored;
    if (unrestricted) {
      stored = await setProfileImsModules(pool, businessProfileId, null);
    } else {
      const raw = Array.isArray(req.body?.enabled) ? (req.body.enabled as unknown[]) : [];
      const keys = raw.filter((k): k is string => typeof k === "string");
      stored = await setProfileImsModules(pool, businessProfileId, normalizeEnabledModules(keys));
    }
    await logAudit(
      "ims.modules.update",
      "business_profile",
      String(businessProfileId),
      { unrestricted, enabled: stored, by: getActiveUserId() },
      req.ip,
    );
    const profiles = await listOrgProfiles(getActiveOrgId());
    res.json({
      businessProfileId,
      profiles,
      unrestricted: stored == null,
      enabled: stored ?? IMS_MODULE_CATALOG.map((m) => m.key),
      alwaysOn: [...IMS_ALWAYS_ON_MODULES],
      catalog: IMS_MODULE_CATALOG,
    });
  } catch (err) {
    const status = Number((err as { status?: number }).status) || 500;
    res.status(status).json({ error: err instanceof Error ? err.message : "Failed to save IMS modules" });
  }
});

export default router;
