import { pool } from "../db.js";
import { touchOrgBillingEnvelope } from "./payments/org-subscription.js";
import { getOrganizationIdForProfile, syncOrgSubscription } from "./payments/org-subscription.js";
import {
  grantAllPaidSkus,
  grantToolLicenses,
  listActiveLicenses,
  listActiveLicensesForOrg,
  revokeToolLicenses,
  revokeToolLicensesForOrg,
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
 * Single commercial activation path for one business profile:
 * licenses + billing line items + billing envelope.
 * Used by UPI approval, card checkout, admin grant, packs, and webhooks.
 */
export async function activateToolCommerce(input: {
  profileId: number;
  orgId?: number;
  toolIds: string[];
  source: CommerceSource;
  sourceClaimId?: number | null;
  externalRef?: string | null;
  periodEnd?: Date;
  defaultDays?: number;
  preferTrial?: boolean;
}): Promise<{ granted: string[]; periodEnd: Date; items: SubscriptionItem[]; orgId: number | null }> {
  const orgId = input.orgId ?? (await getOrganizationIdForProfile(input.profileId));
  const unique = [...new Set(input.toolIds.map(String).filter(Boolean))];
  if (!orgId || unique.length === 0) {
    return {
      granted: [],
      periodEnd: input.periodEnd ?? daysFromNow(input.defaultDays ?? 30),
      items: orgId ? await listSubscriptionItems(orgId) : [],
      orgId,
    };
  }

  const existing = await listActiveLicenses(input.profileId);
  const have = new Set(existing.map((l) => l.toolId));
  const defaultDays = input.defaultDays ?? 30;
  const sharedEnd = input.periodEnd ?? daysFromNow(defaultDays);

  // Prefer trial period end from SKU; keep billing line at ₹0 until paid activation.
  const usePerToolTrial = Boolean(input.preferTrial && !input.periodEnd);
  if (!usePerToolTrial) {
    await grantToolLicenses(input.profileId, unique, sharedEnd, input.sourceClaimId);
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
        `INSERT INTO profile_tool_licenses
           (business_profile_id, tool_id, status, source_claim_id, current_period_end)
         VALUES (:profileId, :toolId, 'active', :claimId, :periodEnd)
         ON DUPLICATE KEY UPDATE
           status = 'active',
           source_claim_id = COALESCE(:claimId, source_claim_id),
           current_period_end = :periodEnd`,
        {
          profileId: input.profileId,
          toolId,
          claimId: input.sourceClaimId ?? null,
          periodEnd: end,
        },
      );
    }
    notifyLicensesGranted({
      organizationId: orgId,
      toolIds: unique,
      periodEnd: farthest,
      source: input.source,
    });
  }

  const items = await syncSubscriptionItemsFromLicenses(orgId, {
    source: input.source,
    externalRef: input.externalRef ?? null,
  });

  // Trial path skips grantToolLicenses (and its MRR refresh); keep org_subscriptions.mrr_inr aligned.
  if (usePerToolTrial) {
    const { refreshOrgMrr } = await import("./tool-licenses.js");
    await refreshOrgMrr(orgId);
  }

  const licenses = await listActiveLicenses(input.profileId);
  let farthest = sharedEnd;
  for (const lic of licenses) {
    if (!lic.periodEnd) continue;
    const end = new Date(lic.periodEnd);
    if (end > farthest) farthest = end;
  }

  await touchOrgBillingEnvelope(orgId, {
    provider: input.source,
    externalSubscriptionId: input.externalRef ?? undefined,
    periodEnd: farthest,
  });

  // External JBT product: Meridian SEO SaaS (path app) — auto-mint license key via webhook
  try {
    const { provisionMeridianSaasLicenses } = await import("./meridian-saas-provision.js");
    await provisionMeridianSaasLicenses({
      orgId,
      toolIds: unique,
      externalRef: input.externalRef ?? null,
    });
  } catch (e) {
    console.error("[commerce] meridian saas provision", e);
  }

  return { granted: unique, periodEnd: farthest, items, orgId };
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
  profileId?: number;
  orgId?: number;
  toolIds?: string[];
}): Promise<SubscriptionItem[]> {
  if (input.profileId != null) {
    await revokeToolLicenses(input.profileId, input.toolIds);
    const orgId = input.orgId ?? (await getOrganizationIdForProfile(input.profileId));
    if (orgId) {
      try {
        const { revokeMeridianSaasLicenses } = await import("./meridian-saas-provision.js");
        await revokeMeridianSaasLicenses({ orgId, toolIds: input.toolIds });
      } catch (e) {
        console.error("[commerce] meridian saas revoke", e);
      }
      return syncSubscriptionItemsFromLicenses(orgId);
    }
    return [];
  }
  if (input.orgId == null) return [];
  await revokeToolLicensesForOrg(input.orgId, input.toolIds);
  try {
    const { revokeMeridianSaasLicenses } = await import("./meridian-saas-provision.js");
    await revokeMeridianSaasLicenses({ orgId: input.orgId, toolIds: input.toolIds });
  } catch (e) {
    console.error("[commerce] meridian saas revoke", e);
  }
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
  const result = await activateToolCommerce({
    profileId: input.profileId,
    toolIds: input.toolIds,
    source: input.source,
    externalRef: input.externalRef,
    periodEnd: input.periodEnd,
    defaultDays: input.defaultDays,
  });
  return { orgId: result.orgId, granted: result.granted, items: result.items };
}

export async function quoteMrrPreview(toolIds: string[]): Promise<number> {
  const skus = await listToolSkus();
  const set = new Set(toolIds);
  return skus.reduce((sum, s) => {
    if (!set.has(s.toolId) || s.includedFree) return sum;
    return sum + s.priceInr;
  }, 0);
}

/** Admin helper: seats currently licensed per tool across an org. */
export async function seatCountsForOrg(orgId: number): Promise<Map<string, number>> {
  const licenses = await listActiveLicensesForOrg(orgId);
  const seats = new Map<string, number>();
  for (const lic of licenses) {
    seats.set(lic.toolId, (seats.get(lic.toolId) ?? 0) + 1);
  }
  return seats;
}
