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
import { getActiveUserId } from "../../lib/request-context.js";
import {
  adminResolveError,
  listAdminBusinessProfiles,
  resolveAdminBusinessProfile,
} from "../../lib/admin/tenant-guard.js";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const resolved = await resolveAdminBusinessProfile(
      req.query.businessProfileId ?? req.query.profileId,
    );
    if (adminResolveError(resolved)) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }
    const profiles = await listAdminBusinessProfiles(resolved?.organizationId ?? null);
    if (!resolved) {
      res.json({
        businessProfileId: null,
        organizationId: null,
        profiles,
        unrestricted: true,
        enabled: IMS_MODULE_CATALOG.map((m) => m.key),
        alwaysOn: [...IMS_ALWAYS_ON_MODULES],
        catalog: IMS_MODULE_CATALOG,
      });
      return;
    }
    const stored = await getProfileImsModules(pool, resolved.profileId);
    const unrestricted = stored == null;
    const enabled = unrestricted ? IMS_MODULE_CATALOG.map((m) => m.key) : stored;
    res.json({
      businessProfileId: resolved.profileId,
      organizationId: resolved.organizationId,
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
    const resolved = await resolveAdminBusinessProfile(
      req.body?.businessProfileId ?? req.body?.profileId,
      { required: true },
    );
    if (adminResolveError(resolved) || !resolved) {
      const err = adminResolveError(resolved)
        ? resolved
        : { status: 400, error: "businessProfileId required" };
      res.status(err.status).json({ error: err.error });
      return;
    }
    const unrestricted = req.body?.unrestricted === true;
    let stored;
    if (unrestricted) {
      stored = await setProfileImsModules(pool, resolved.profileId, null);
    } else {
      const raw = Array.isArray(req.body?.enabled) ? (req.body.enabled as unknown[]) : [];
      const keys = raw.filter((k): k is string => typeof k === "string");
      stored = await setProfileImsModules(pool, resolved.profileId, normalizeEnabledModules(keys));
    }
    await logAudit(
      "ims.modules.update",
      "business_profile",
      String(resolved.profileId),
      { unrestricted, enabled: stored, by: getActiveUserId() },
      req.ip,
    );
    const profiles = await listAdminBusinessProfiles(resolved.organizationId);
    res.json({
      businessProfileId: resolved.profileId,
      organizationId: resolved.organizationId,
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
