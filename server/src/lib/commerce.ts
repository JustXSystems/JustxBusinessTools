import { pool } from "../db.js";
import { touchOrgBillingEnvelope } from "./payments/org-subscription.js";
import { getOrganizationIdForProfile, syncOrgSubscription } from "./payments/org-subscription.js";
import {
  grantAllPaidSkus,
  grantToolLicenses,
  listActiveLicenses,
  revokeToolLicenses,
} from "./tool-licenses.js";
import { getToolSku, listToolSkus } from "./tool-skus.js";
import { notifyLicensesGranted } from "./notification-billing.js";
import {
  listSubscriptionItems,
  syncSubscriptionItemsFromLicenses,
  type SubscriptionItem,
} from "./subscription-items.js";

export type CommerceSource = "upi" | "card" | "admin" | "trial" | "pack" | "webhook" | "heal";

function daysFromNow(days: number): Date {
  return new Date(Date.now() + Math.max(1, days) * 24 * 60 * 60 * 1000);
}

/**
 * Single commercial activation path: licenses + billing line items + billing envelope.
 * Used by UPI approval, card checkout, admin grant, packs, and webhooks.
 */
export async function activateToolCommerce(input: {
  orgId: number;
  toolIds: string[];
  source: CommerceSource;
  sourceClaimId?: number | null;
  externalRef?: string | null;
  periodEnd?: Date;
  defaultDays?: number;
  preferTrial?: boolean;
}): Promise<{ granted: string[]; periodEnd: Date; items: SubscriptionItem[] }> {
  const unique = [...new Set(input.toolIds.map(String).filter(Boolean))];
  if (unique.length === 0) {
    return {
      granted: [],
      periodEnd: input.periodEnd ?? daysFromNow(input.defaultDays ?? 30),
      items: await listSubscriptionItems(input.orgId),
    };
  }

  const existing = await listActiveLicenses(input.orgId);
  const have = new Set(existing.map((l) => l.toolId));
  const defaultDays = input.defaultDays ?? 30;
  const sharedEnd = input.periodEnd ?? daysFromNow(defaultDays);

  const usePerToolTrial = Boolean(input.preferTrial && !input.periodEnd);
  if (!usePerToolTrial) {
    await grantToolLicenses(input.orgId, unique, sharedEnd, input.sourceClaimId);
  } else {
    let farthest = sharedEnd;
    for (const toolId of unique) {
      let end = sharedEnd;
      if (!have.has(toolId)) {
        const sku = await getToolSku(toolId);
        if (sku && sku.trialDays > 0) end = daysFromNow(sku.trialDays);
      }
      if (end > farthest) farthest = end;
      await pool.query(
        `INSERT INTO org_tool_licenses
           (organization_id, tool_id, status, source_claim_id, current_period_end)
         VALUES (:orgId, :toolId, 'active', :claimId, :periodEnd)
         ON DUPLICATE KEY UPDATE
           status = 'active',
           source_claim_id = COALESCE(:claimId, source_claim_id),
           current_period_end = :periodEnd`,
        {
          orgId: input.orgId,
          toolId,
          claimId: input.sourceClaimId ?? null,
          periodEnd: end,
        },
      );
    }
    const { refreshOrgMrr } = await import("./tool-licenses.js");
    await refreshOrgMrr(input.orgId);
    notifyLicensesGranted({
      organizationId: input.orgId,
      toolIds: unique,
      periodEnd: farthest,
      source: input.source,
    });
  }

  const items = await syncSubscriptionItemsFromLicenses(input.orgId, {
    source: input.source,
    externalRef: input.externalRef ?? null,
  });

  const licenses = await listActiveLicenses(input.orgId);
  let farthest = sharedEnd;
  for (const lic of licenses) {
    if (!lic.periodEnd) continue;
    const end = new Date(lic.periodEnd);
    if (end > farthest) farthest = end;
  }

  await touchOrgBillingEnvelope(input.orgId, {
    provider: input.source,
    externalSubscriptionId: input.externalRef ?? undefined,
    periodEnd: farthest,
  });

  return { granted: unique, periodEnd: farthest, items };
}

export async function activateAllToolsPack(input: {
  orgId: number;
  source: CommerceSource;
  periodEnd?: Date;
  externalRef?: string | null;
  defaultDays?: number;
}): Promise<{ granted: string[]; items: SubscriptionItem[] }> {
  const end = input.periodEnd ?? daysFromNow(input.defaultDays ?? 365);
  const granted = await grantAllPaidSkus(input.orgId, end);
  const items = await syncSubscriptionItemsFromLicenses(input.orgId, {
    source: input.source,
    externalRef: input.externalRef ?? null,
  });
  await syncOrgSubscription(
    input.orgId,
    "pro",
    "active",
    input.source,
    input.externalRef ?? undefined,
    undefined,
    end,
  );
  return { granted, items };
}

export async function deactivateToolCommerce(input: {
  orgId: number;
  toolIds?: string[];
}): Promise<SubscriptionItem[]> {
  await revokeToolLicenses(input.orgId, input.toolIds);
  return syncSubscriptionItemsFromLicenses(input.orgId);
}

export async function activateToolCommerceForProfile(input: {
  profileId: number;
  toolIds: string[];
  source: CommerceSource;
  externalRef?: string | null;
  periodEnd?: Date;
  defaultDays?: number;
}): Promise<{ orgId: number | null; granted: string[]; items: SubscriptionItem[] }> {
  const orgId = await getOrganizationIdForProfile(input.profileId);
  if (!orgId) return { orgId: null, granted: [], items: [] };
  const result = await activateToolCommerce({
    orgId,
    toolIds: input.toolIds,
    source: input.source,
    externalRef: input.externalRef,
    periodEnd: input.periodEnd,
    defaultDays: input.defaultDays,
  });
  return { orgId, granted: result.granted, items: result.items };
}

export async function quoteMrrPreview(toolIds: string[]): Promise<number> {
  const skus = await listToolSkus();
  const set = new Set(toolIds);
  return skus.reduce((sum, s) => {
    if (!set.has(s.toolId) || s.includedFree) return sum;
    return sum + s.priceInr;
  }, 0);
}
