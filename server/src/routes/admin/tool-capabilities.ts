import { Router } from "express";
import { pool } from "../../db.js";
import { logAudit } from "../../lib/audit.js";
import {
  adminResolveError,
  resolveAdminBusinessProfile,
} from "../../lib/admin/tenant-guard.js";
import { getActiveUserId } from "../../lib/request-context.js";
import { listToolSkus } from "../../lib/tool-skus.js";
import { listActiveLicenses } from "../../lib/tool-licenses.js";
import { collectAssignedToolIds } from "../../lib/tool-capabilities/assigned.js";
import { getCapabilityAdapter, listCeilingAdapters } from "../../lib/tool-capabilities/registry.js";
import {
  coveragePct,
  snapshotFromStored,
  type ToolCapabilitySnapshot,
} from "../../lib/tool-capabilities/types.js";

const router = Router();

type CapabilityToolRow = {
  toolId: string;
  name: string;
  entitled: boolean;
  hasCeiling: boolean;
  unrestricted: boolean | null;
  coveragePct: number | null;
  enabledCount: number | null;
  catalogCount: number | null;
  alwaysOnCount: number | null;
};

async function assignedToolIds(profileId: number): Promise<{
  assigned: Set<string>;
  names: Map<string, string>;
}> {
  const [skus, licenses] = await Promise.all([listToolSkus(), listActiveLicenses(profileId)]);
  return collectAssignedToolIds(licenses, skus);
}

async function loadSnapshot(
  toolId: string,
  profileId: number,
  displayName?: string,
): Promise<ToolCapabilitySnapshot | null> {
  const adapter = getCapabilityAdapter(toolId);
  if (!adapter) {
    return {
      toolId,
      name: displayName ?? toolId,
      hasCeiling: false,
      unrestricted: true,
      enabled: [],
      alwaysOn: [],
      catalog: [],
    };
  }
  const stored = await adapter.get(pool, profileId);
  const snap = snapshotFromStored(adapter, stored);
  if (displayName) snap.name = displayName;
  return snap;
}

/** Summary: every entitled tool on the profile + ceiling coverage where registered. */
router.get("/", async (req, res) => {
  try {
    const resolved = await resolveAdminBusinessProfile(
      req.query.businessProfileId ?? req.query.profileId,
      { required: true },
    );
    if (adminResolveError(resolved) || !resolved) {
      const err = adminResolveError(resolved)
        ? resolved
        : { status: 400, error: "businessProfileId required" };
      res.status(err.status).json({ error: err.error });
      return;
    }

    const { assigned, names } = await assignedToolIds(resolved.profileId);
    const tools: CapabilityToolRow[] = [];

    for (const toolId of [...assigned].sort()) {
      const adapter = getCapabilityAdapter(toolId);
      const name = names.get(toolId) ?? adapter?.name ?? toolId;
      if (!adapter) {
        tools.push({
          toolId,
          name,
          entitled: true,
          hasCeiling: false,
          unrestricted: null,
          coveragePct: null,
          enabledCount: null,
          catalogCount: null,
          alwaysOnCount: null,
        });
        continue;
      }
      const stored = await adapter.get(pool, resolved.profileId);
      const unrestricted = stored == null;
      const enabled = unrestricted ? adapter.catalog.map((m) => m.key) : stored;
      tools.push({
        toolId,
        name,
        entitled: true,
        hasCeiling: true,
        unrestricted,
        coveragePct: coveragePct(unrestricted, enabled, adapter.catalog, adapter.alwaysOn),
        enabledCount: enabled.length,
        catalogCount: adapter.catalog.length,
        alwaysOnCount: adapter.alwaysOn.length,
      });
    }

    // Surface ceiling-capable tools that are not yet assigned so admins see the gap.
    for (const adapter of listCeilingAdapters()) {
      if (assigned.has(adapter.toolId)) continue;
      tools.push({
        toolId: adapter.toolId,
        name: names.get(adapter.toolId) ?? adapter.name,
        entitled: false,
        hasCeiling: true,
        unrestricted: null,
        coveragePct: null,
        enabledCount: null,
        catalogCount: adapter.catalog.length,
        alwaysOnCount: adapter.alwaysOn.length,
      });
    }

    tools.sort((a, b) => {
      if (a.entitled !== b.entitled) return a.entitled ? -1 : 1;
      if (a.hasCeiling !== b.hasCeiling) return a.hasCeiling ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    res.json({
      businessProfileId: resolved.profileId,
      organizationId: resolved.organizationId,
      tools,
    });
  } catch (err) {
    const status = Number((err as { status?: number }).status) || 500;
    res.status(status).json({
      error: err instanceof Error ? err.message : "Failed to load tool capabilities",
    });
  }
});

router.get("/:toolId", async (req, res) => {
  try {
    const toolId = String(req.params.toolId || "");
    if (!toolId) {
      res.status(400).json({ error: "toolId required" });
      return;
    }
    const resolved = await resolveAdminBusinessProfile(
      req.query.businessProfileId ?? req.query.profileId,
      { required: true },
    );
    if (adminResolveError(resolved) || !resolved) {
      const err = adminResolveError(resolved)
        ? resolved
        : { status: 400, error: "businessProfileId required" };
      res.status(err.status).json({ error: err.error });
      return;
    }

    const { assigned, names } = await assignedToolIds(resolved.profileId);
    const snap = await loadSnapshot(toolId, resolved.profileId, names.get(toolId));
    if (!snap) {
      res.status(404).json({ error: "Tool not found" });
      return;
    }

    res.json({
      businessProfileId: resolved.profileId,
      organizationId: resolved.organizationId,
      entitled: assigned.has(toolId),
      ...snap,
      coveragePct: snap.hasCeiling
        ? coveragePct(snap.unrestricted, snap.enabled, snap.catalog, snap.alwaysOn)
        : null,
    });
  } catch (err) {
    const status = Number((err as { status?: number }).status) || 500;
    res.status(status).json({
      error: err instanceof Error ? err.message : "Failed to load tool capability",
    });
  }
});

router.put("/:toolId", async (req, res) => {
  try {
    const toolId = String(req.params.toolId || "");
    if (!toolId) {
      res.status(400).json({ error: "toolId required" });
      return;
    }
    const adapter = getCapabilityAdapter(toolId);
    if (!adapter) {
      res.status(400).json({
        error: "This tool uses whole-tool access — grant or revoke the license on Access Fabric.",
      });
      return;
    }

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

    const { assigned, names } = await assignedToolIds(resolved.profileId);
    if (!assigned.has(toolId)) {
      res.status(409).json({
        error: `License ${adapter.name} on this Business Profile before tuning module ceilings.`,
      });
      return;
    }

    const unrestricted = req.body?.unrestricted === true;
    let stored: string[] | null;
    if (unrestricted) {
      stored = await adapter.set(pool, resolved.profileId, null);
    } else {
      const raw = Array.isArray(req.body?.enabled) ? (req.body.enabled as unknown[]) : [];
      const keys = raw.filter((k): k is string => typeof k === "string");
      // Always-on enforced inside adapter.set / normalize
      stored = await adapter.set(pool, resolved.profileId, keys);
    }

    await logAudit(
      "tool.capabilities.update",
      "business_profile",
      String(resolved.profileId),
      { toolId, unrestricted, enabled: stored, by: getActiveUserId() },
      req.ip,
    );

    const snap = snapshotFromStored(adapter, stored);
    if (names.get(toolId)) snap.name = names.get(toolId)!;
    res.json({
      businessProfileId: resolved.profileId,
      organizationId: resolved.organizationId,
      entitled: true,
      ...snap,
      coveragePct: coveragePct(snap.unrestricted, snap.enabled, snap.catalog, snap.alwaysOn),
    });
  } catch (err) {
    const status = Number((err as { status?: number }).status) || 500;
    res.status(status).json({
      error: err instanceof Error ? err.message : "Failed to save tool capability",
    });
  }
});

export default router;
