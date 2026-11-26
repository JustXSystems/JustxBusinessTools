import { pool } from "../db.js";
import type { ToolLicense } from "./tool-licenses.js";
import type { ToolSku } from "./tool-skus.js";
import type { SubscriptionItem } from "./subscription-items.js";

export type ToolUsageStatus =
  | "included"
  | "licensed"
  | "trial"
  | "expiring_soon"
  | "near_limit"
  | "at_limit"
  | "hard_locked"
  | "freemium";

export type ToolUsageTelemetry = {
  toolId: string;
  recordCount: number;
  limit: number | null;
  utilizationPct: number | null;
  nearLimit: boolean;
  atLimit: boolean;
  status: ToolUsageStatus;
  isTrial: boolean;
  daysLeft: number | null;
  periodEnd: string | null;
};

export type WorkspaceUsageSummary = {
  totalRecords: number;
  activeToolsUsed: number;
  licensedCount: number;
  trialCount: number;
  trialsExpiringSoon: number;
  licensesExpiringSoon: number;
  toolsNearLimit: number;
  toolsAtLimit: number;
  hardLockedCount: number;
};

function computeDaysLeft(periodEnd: string | null, now: Date = new Date()): number | null {
  if (!periodEnd) return null;
  const end = new Date(periodEnd);
  if (Number.isNaN(end.getTime())) return null;
  const diffMs = end.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / 86_400_000));
}

/**
 * Pure computation of per-tool usage telemetry and workspace summary.
 * Separated from SQL so unit tests can exercise every edge case deterministically.
 */
export function buildWorkspaceUsageTelemetry(input: {
  skus: ToolSku[];
  licenses: ToolLicense[];
  entitlements?: ToolLicense[];
  billingItems?: SubscriptionItem[];
  recordCounts: Record<string, number>;
  freemiumRecordLimit: number;
  now?: Date;
}): {
  byTool: Record<string, ToolUsageTelemetry>;
  summary: WorkspaceUsageSummary;
} {
  const { skus, licenses, entitlements = [], billingItems = [], recordCounts, freemiumRecordLimit } =
    input;
  const now = input.now ?? new Date();

  const activeLicenseByTool = new Map(licenses.map((l) => [l.toolId, l]));
  const entitlementByTool = new Map(entitlements.map((e) => [e.toolId, e]));
  const itemByTool = new Map(billingItems.map((i) => [i.toolId, i]));

  const byTool: Record<string, ToolUsageTelemetry> = {};
  const summary: WorkspaceUsageSummary = {
    totalRecords: 0,
    activeToolsUsed: 0,
    licensedCount: 0,
    trialCount: 0,
    trialsExpiringSoon: 0,
    licensesExpiringSoon: 0,
    toolsNearLimit: 0,
    toolsAtLimit: 0,
    hardLockedCount: 0,
  };

  for (const sku of skus) {
    if (!sku.available) continue;
    const recordCount = Math.max(0, Number(recordCounts[sku.toolId] ?? 0));
    summary.totalRecords += recordCount;
    if (recordCount > 0) summary.activeToolsUsed += 1;

    const includedFree = sku.includedFree || sku.priceInr <= 0;
    const lic = activeLicenseByTool.get(sku.toolId);
    const ent = entitlementByTool.get(sku.toolId);
    const billingItem = itemByTool.get(sku.toolId);

    if (includedFree) {
      byTool[sku.toolId] = {
        toolId: sku.toolId,
        recordCount,
        limit: null,
        utilizationPct: null,
        nearLimit: false,
        atLimit: false,
        status: "included",
        isTrial: false,
        daysLeft: null,
        periodEnd: null,
      };
      continue;
    }

    if (lic) {
      const isTrial = billingItem?.source === "trial";
      const daysLeft = computeDaysLeft(lic.periodEnd, now);
      const expiringSoon = daysLeft != null && daysLeft <= 7;
      if (isTrial) {
        summary.trialCount += 1;
        if (expiringSoon) summary.trialsExpiringSoon += 1;
      } else {
        summary.licensedCount += 1;
        if (expiringSoon) summary.licensesExpiringSoon += 1;
      }

      byTool[sku.toolId] = {
        toolId: sku.toolId,
        recordCount,
        limit: null,
        utilizationPct: null,
        nearLimit: false,
        atLimit: false,
        status: expiringSoon ? "expiring_soon" : isTrial ? "trial" : "licensed",
        isTrial,
        daysLeft,
        periodEnd: lic.periodEnd,
      };
      continue;
    }

    // Unlicensed paid tool: resolve effective cap matching getRecordLimit()
    let limit: number;
    if (ent?.recordLimitOverride != null) {
      limit = ent.recordLimitOverride;
    } else if (sku.accessPolicy === "hard_lock") {
      limit = 0;
    } else if (sku.unlicensedRecordLimit != null) {
      limit = sku.unlicensedRecordLimit;
    } else {
      limit = freemiumRecordLimit;
    }

    const atLimit = recordCount >= limit;
    const nearLimit = limit > 0 && recordCount >= Math.max(1, limit - 4);
    const utilizationPct =
      limit > 0 ? Math.min(100, Math.round((recordCount / limit) * 100)) : 100;

    let status: ToolUsageStatus;
    if (limit === 0) {
      status = "hard_locked";
      summary.hardLockedCount += 1;
    } else if (atLimit) {
      status = "at_limit";
      summary.toolsAtLimit += 1;
    } else if (nearLimit) {
      status = "near_limit";
      summary.toolsNearLimit += 1;
    } else {
      status = "freemium";
    }

    byTool[sku.toolId] = {
      toolId: sku.toolId,
      recordCount,
      limit,
      utilizationPct,
      nearLimit,
      atLimit,
      status,
      isTrial: false,
      daysLeft: null,
      periodEnd: null,
    };
  }

  return { byTool, summary };
}

/**
 * Fetch aggregated record counts across `tool_records` and `document_records` for a profile.
 */
export async function fetchProfileRecordCounts(profileId: number): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const addRows = (rows: unknown) => {
    for (const row of Array.isArray(rows) ? rows : []) {
      const r = row as { tool_id?: string; cnt?: number };
      const id = String(r.tool_id ?? "").trim();
      if (!id) continue;
      counts[id] = (counts[id] ?? 0) + (Number(r.cnt) || 0);
    }
  };

  try {
    const [trackerRows] = await pool.query(
      `SELECT tool_id, COUNT(*) AS cnt FROM tool_records
       WHERE business_profile_id = :profileId
       GROUP BY tool_id`,
      { profileId },
    );
    addRows(trackerRows);
  } catch {
    /* table may not exist on fresh boot */
  }

  try {
    const [docRows] = await pool.query(
      `SELECT tool_id, COUNT(*) AS cnt FROM document_records
       WHERE business_profile_id = :profileId
       GROUP BY tool_id`,
      { profileId },
    );
    addRows(docRows);
  } catch {
    /* table may not exist on fresh boot */
  }

  return counts;
}
