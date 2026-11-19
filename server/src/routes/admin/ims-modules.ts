/**
 * Compat shim — IMS module ceilings now live on Access Fabric via
 * `/admin/tool-capabilities/imsdealer`. Kept so older clients/scripts keep working.
 */
import { Router } from "express";
import { pool } from "../../db.js";
import { logAudit } from "../../lib/audit.js";
import { getActiveUserId } from "../../lib/request-context.js";
import {
  adminResolveError,
  listAdminBusinessProfiles,
  resolveAdminBusinessProfile,
} from "../../lib/admin/tenant-guard.js";
import { imsCapabilityAdapter } from "../../lib/tool-capabilities/ims-adapter.js";
import { coveragePct, snapshotFromStored } from "../../lib/tool-capabilities/types.js";
import { listActiveLicenses } from "../../lib/tool-licenses.js";
import { collectAssignedToolIds } from "../../lib/tool-capabilities/assigned.js";

const router = Router();
const TOOL_ID = imsCapabilityAdapter.toolId;

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
        enabled: imsCapabilityAdapter.catalog.map((m) => m.key),
        alwaysOn: [...imsCapabilityAdapter.alwaysOn],
        catalog: imsCapabilityAdapter.catalog,
      });
      return;
    }
    const stored = await imsCapabilityAdapter.get(pool, resolved.profileId);
    const snap = snapshotFromStored(imsCapabilityAdapter, stored);
    res.json({
      businessProfileId: resolved.profileId,
      organizationId: resolved.organizationId,
      profiles,
      unrestricted: snap.unrestricted,
      enabled: snap.enabled,
      alwaysOn: snap.alwaysOn,
      catalog: snap.catalog,
      coveragePct: coveragePct(snap.unrestricted, snap.enabled, snap.catalog, snap.alwaysOn),
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

    const licenses = await listActiveLicenses(resolved.profileId);
    const { assigned } = collectAssignedToolIds(licenses);
    if (!assigned.has(TOOL_ID)) {
      res.status(409).json({
        error: "License Justxsystems IMS on this Business Profile before tuning module ceilings.",
      });
      return;
    }

    const unrestricted = req.body?.unrestricted === true;
    let stored: string[] | null;
    if (unrestricted) {
      stored = await imsCapabilityAdapter.set(pool, resolved.profileId, null);
    } else {
      const raw = Array.isArray(req.body?.enabled) ? (req.body.enabled as unknown[]) : [];
      const keys = raw.filter((k): k is string => typeof k === "string");
      stored = await imsCapabilityAdapter.set(pool, resolved.profileId, keys);
    }

    await logAudit(
      "tool.capabilities.update",
      "business_profile",
      String(resolved.profileId),
      { toolId: TOOL_ID, unrestricted, enabled: stored, by: getActiveUserId(), via: "ims-modules" },
      req.ip,
    );

    const profiles = await listAdminBusinessProfiles(resolved.organizationId);
    const snap = snapshotFromStored(imsCapabilityAdapter, stored);
    res.json({
      businessProfileId: resolved.profileId,
      organizationId: resolved.organizationId,
      profiles,
      unrestricted: snap.unrestricted,
      enabled: snap.enabled,
      alwaysOn: snap.alwaysOn,
      catalog: snap.catalog,
      coveragePct: coveragePct(snap.unrestricted, snap.enabled, snap.catalog, snap.alwaysOn),
    });
  } catch (err) {
    const status = Number((err as { status?: number }).status) || 500;
    res.status(status).json({ error: err instanceof Error ? err.message : "Failed to save IMS modules" });
  }
});

export default router;
