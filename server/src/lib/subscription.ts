import type { PoolConnection } from "mysql2/promise";
import { pool } from "../db.js";
import { FREE_RECORD_LIMIT, PROFILE_ID } from "./constants.js";
import {
  getOrganizationIdForProfile,
  syncOrgSubscription,
} from "./payments/org-subscription.js";
import {
  getCatalogPlan,
  getLimitedPlan,
  getUnlimitedPlan,
  type AccessMode,
  type CatalogPlan,
} from "./subscription-plans.js";
import { getToolSku } from "./tool-skus.js";
import { licensedOrIncluded } from "./tool-licenses.js";

export type SubscriptionStatus = "active" | "cancelled" | "past_due";

export type Subscription = {
  businessProfileId: number;
  planId: string;
  planName: string;
  status: SubscriptionStatus;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  paymentProvider: string | null;
  externalSubscriptionId: string | null;
  externalCustomerId: string | null;
  /** Freemium record cap for unlicensed paid tools (never null). */
  recordLimit: number;
  accessMode: AccessMode;
  /** True when org is on All Tools Pack plan — licenses are still the access source of truth. */
  isUnlimited: boolean;
  /** Alias of isUnlimited — kept so existing operator UI still works. */
  isPro: boolean;
};

type Queryable = typeof pool | PoolConnection;

type SubRow = {
  plan_id: string;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  payment_provider: string | null;
  external_subscription_id: string | null;
  external_customer_id: string | null;
};

function entitlements(plan: CatalogPlan, status: SubscriptionStatus, freemiumLimit: number): {
  accessMode: AccessMode;
  recordLimit: number;
  isUnlimited: boolean;
} {
  const paidActive = plan.accessMode === "unlimited" && status === "active";
  return {
    // accessMode/isUnlimited describe the All Tools Pack assignment (marketing / admin).
    // Entitlement for records is always per-tool license — freemiumLimit applies when unlicensed.
    accessMode: paidActive ? "unlimited" : "limited",
    recordLimit: freemiumLimit,
    isUnlimited: paidActive,
  };
}

function toSubscription(
  profileId: number,
  row: SubRow,
  plan: CatalogPlan,
  freemiumLimit: number,
): Subscription {
  const status = (row.status as SubscriptionStatus) ?? "active";
  const ent = entitlements(plan, status, freemiumLimit);
  return {
    businessProfileId: profileId,
    planId: plan.id,
    planName: plan.name,
    status,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    paymentProvider: row.payment_provider,
    externalSubscriptionId: row.external_subscription_id,
    externalCustomerId: row.external_customer_id,
    recordLimit: ent.recordLimit,
    accessMode: ent.accessMode,
    isUnlimited: ent.isUnlimited,
    isPro: ent.isUnlimited,
  };
}

async function loadPlanForId(planId: string): Promise<CatalogPlan> {
  const plan = await getCatalogPlan(planId);
  if (plan) return plan;
  if (planId === "pro") return getUnlimitedPlan();
  return getLimitedPlan();
}

export async function getSubscription(
  profileId = PROFILE_ID,
  conn?: PoolConnection,
): Promise<Subscription> {
  const q: Queryable = conn ?? pool;
  const limited = await getLimitedPlan();
  const freemiumLimit = limited.recordLimit ?? FREE_RECORD_LIMIT;

  const [orgRows] = await q.query(
    `SELECT os.plan_id, os.status, os.current_period_start, os.current_period_end,
            os.payment_provider, os.external_subscription_id, NULL AS external_customer_id,
            bp.organization_id AS organization_id
     FROM business_profiles bp
     INNER JOIN org_subscriptions os ON os.organization_id = bp.organization_id
     WHERE bp.id = :profileId
     LIMIT 1`,
    { profileId },
  );
  let row = Array.isArray(orgRows)
    ? (orgRows[0] as (SubRow & { organization_id?: number }) | undefined)
    : undefined;
  let orgId = row?.organization_id != null ? Number(row.organization_id) : null;

  if (!row) {
    const [profileRows] = await q.query(
      `SELECT s.plan_id, s.status, s.current_period_start, s.current_period_end,
              s.payment_provider, s.external_subscription_id, s.external_customer_id,
              bp.organization_id AS organization_id
       FROM subscriptions s
       INNER JOIN business_profiles bp ON bp.id = s.business_profile_id
       WHERE s.business_profile_id = :profileId`,
      { profileId },
    );
    row = Array.isArray(profileRows)
      ? (profileRows[0] as (SubRow & { organization_id?: number }) | undefined)
      : undefined;
    orgId = row?.organization_id != null ? Number(row.organization_id) : null;
  }

  if (!row) {
    const ent = entitlements(limited, "active", freemiumLimit);
    return {
      businessProfileId: profileId,
      planId: limited.id,
      planName: limited.name,
      status: "active",
      currentPeriodStart: null,
      currentPeriodEnd: null,
      paymentProvider: null,
      externalSubscriptionId: null,
      externalCustomerId: null,
      recordLimit: ent.recordLimit,
      accessMode: ent.accessMode,
      isUnlimited: false,
      isPro: false,
    };
  }

  const assigned = await loadPlanForId(String(row.plan_id));
  const status = (row.status as SubscriptionStatus) ?? "active";
  const onAllToolsPack = assigned.accessMode === "unlimited" && status === "active";
  const plan = onAllToolsPack ? assigned : limited;

  // Heal: All Tools Pack tenants must hold per-tool licenses (source of truth for access).
  if (onAllToolsPack && orgId) {
    const { ensureAllPaidLicenses } = await import("./tool-licenses.js");
    const periodEnd = row.current_period_end
      ? new Date(row.current_period_end)
      : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    await ensureAllPaidLicenses(orgId, periodEnd);
  }

  return toSubscription(profileId, { ...row, status }, plan, freemiumLimit);
}

export async function getRecordLimit(
  profileId = PROFILE_ID,
  conn?: PoolConnection,
  toolId?: string,
): Promise<number | null> {
  const sub = await getSubscription(profileId, conn);
  const freemiumCap = async (): Promise<number> => {
    if (sub.recordLimit != null) return sub.recordLimit;
    const limited = await getLimitedPlan();
    return limited.recordLimit ?? FREE_RECORD_LIMIT;
  };

  if (!toolId) {
    // Platform default only — per-tool entitlement always requires toolId.
    return freemiumCap();
  }

  const orgId = await getOrganizationIdForProfile(profileId);
  const sku = await getToolSku(toolId);
  if (orgId && (await licensedOrIncluded(orgId, toolId, sku))) return null;

  if (sku?.accessPolicy === "hard_lock") return 0;
  if (sku?.unlicensedRecordLimit != null) return sku.unlicensedRecordLimit;
  return freemiumCap();
}

export async function logSubscriptionEvent(
  profileId: number,
  eventType: string,
  provider: string | null,
  payload: Record<string, unknown>,
  conn?: PoolConnection,
): Promise<void> {
  const q: Queryable = conn ?? pool;
  await q.query(
    `INSERT INTO subscription_events (business_profile_id, event_type, provider, payload)
     VALUES (:profileId, :eventType, :provider, :payload)`,
    {
      profileId,
      eventType,
      provider,
      payload: JSON.stringify(payload),
    },
  );
}

export async function applyPlanToProfile(
  profileId: number,
  planId: string,
  status: SubscriptionStatus,
  provider: string | null,
  externalSubscriptionId?: string,
  externalCustomerId?: string,
  periodEnd?: Date,
): Promise<Subscription> {
  const plan = await loadPlanForId(planId);
  const end =
    plan.accessMode === "unlimited"
      ? (periodEnd ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
      : (periodEnd ?? null);

  await pool.query(
    `INSERT INTO subscriptions
     (business_profile_id, plan_id, status, current_period_start, current_period_end,
      payment_provider, external_subscription_id, external_customer_id)
     VALUES (:profileId, :planId, :status, NOW(), :periodEnd, :provider, :externalId, :customerId)
     ON DUPLICATE KEY UPDATE
       plan_id = :planId,
       status = :status,
       current_period_start = NOW(),
       current_period_end = :periodEnd,
       payment_provider = :provider,
       external_subscription_id = :externalId,
       external_customer_id = :customerId`,
    {
      profileId,
      planId: plan.id,
      status,
      periodEnd: end,
      provider,
      externalId: externalSubscriptionId ?? null,
      customerId: externalCustomerId ?? null,
    },
  );

  const orgId = await getOrganizationIdForProfile(profileId);
  if (orgId) {
    await syncOrgSubscription(
      orgId,
      plan.id,
      status,
      provider ?? "manual",
      externalSubscriptionId,
      plan.accessMode === "unlimited" ? plan.priceInr : 0,
      end ?? undefined,
    );
  }

  return getSubscription(profileId);
}

export async function activatePaidSubscription(
  profileId: number,
  provider: string,
  externalSubscriptionId: string,
  externalCustomerId?: string,
  periodEnd?: Date,
  planId?: string,
): Promise<Subscription> {
  const paid = planId ? await loadPlanForId(planId) : await getUnlimitedPlan();
  const end =
    periodEnd ??
    (paid.accessMode === "unlimited"
      ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      : undefined);
  const sub = await applyPlanToProfile(
    profileId,
    paid.id,
    "active",
    provider,
    externalSubscriptionId,
    externalCustomerId,
    end,
  );
  // All-tools pack semantics: Pro / unlimited activates per-tool licenses (source of truth).
  if (paid.accessMode === "unlimited") {
    const orgId = await getOrganizationIdForProfile(profileId);
    if (orgId) {
      const { grantAllPaidSkus } = await import("./tool-licenses.js");
      await grantAllPaidSkus(orgId, end ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
    }
  }
  await logSubscriptionEvent(profileId, "subscription.activated", provider, {
    externalSubscriptionId,
    planId: paid.id,
    periodEnd: end?.toISOString() ?? null,
  });
  return sub;
}

/** @deprecated Use activatePaidSubscription */
export const activateProSubscription = activatePaidSubscription;

export async function cancelSubscription(
  profileId: number,
  provider: string,
  externalSubscriptionId: string,
): Promise<Subscription> {
  const limited = await getLimitedPlan();
  const orgId = await getOrganizationIdForProfile(profileId);
  if (orgId) {
    const { revokeToolLicenses } = await import("./tool-licenses.js");
    await revokeToolLicenses(orgId);
  }
  const sub = await applyPlanToProfile(
    profileId,
    limited.id,
    "cancelled",
    provider,
    externalSubscriptionId,
  );
  await logSubscriptionEvent(profileId, "subscription.cancelled", provider, {
    externalSubscriptionId,
    planId: limited.id,
  });
  return { ...sub, status: "cancelled" };
}
