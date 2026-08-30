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
  recordLimit: number | null;
  accessMode: AccessMode;
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

function entitlements(plan: CatalogPlan, status: SubscriptionStatus): {
  accessMode: AccessMode;
  recordLimit: number | null;
  isUnlimited: boolean;
} {
  const paidActive = plan.accessMode === "unlimited" && status === "active";
  if (paidActive) {
    return { accessMode: "unlimited", recordLimit: null, isUnlimited: true };
  }
  return {
    accessMode: "limited",
    recordLimit: plan.accessMode === "limited" ? plan.recordLimit : (plan.recordLimit ?? FREE_RECORD_LIMIT),
    isUnlimited: false,
  };
}

function toSubscription(
  profileId: number,
  row: SubRow,
  plan: CatalogPlan,
): Subscription {
  const status = (row.status as SubscriptionStatus) ?? "active";
  const ent = entitlements(plan, status);
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

  const [orgRows] = await q.query(
    `SELECT os.plan_id, os.status, os.current_period_start, os.current_period_end,
            os.payment_provider, os.external_subscription_id, NULL AS external_customer_id
     FROM business_profiles bp
     INNER JOIN org_subscriptions os ON os.organization_id = bp.organization_id
     WHERE bp.id = :profileId
     LIMIT 1`,
    { profileId },
  );
  let row = Array.isArray(orgRows) ? (orgRows[0] as SubRow | undefined) : undefined;

  if (!row) {
    const [profileRows] = await q.query(
      `SELECT plan_id, status, current_period_start, current_period_end,
              payment_provider, external_subscription_id, external_customer_id
       FROM subscriptions WHERE business_profile_id = :profileId`,
      { profileId },
    );
    row = Array.isArray(profileRows) ? (profileRows[0] as SubRow | undefined) : undefined;
  }

  if (!row) {
    const limited = await getLimitedPlan();
    const ent = entitlements(limited, "active");
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
  const plan =
    assigned.accessMode === "unlimited" && status === "active"
      ? assigned
      : await getLimitedPlan();
  return toSubscription(profileId, { ...row, status }, plan);
}

export async function getRecordLimit(
  profileId = PROFILE_ID,
  conn?: PoolConnection,
  toolId?: string,
): Promise<number | null> {
  const sub = await getSubscription(profileId, conn);
  if (sub.isUnlimited) return null;
  if (!toolId) return sub.recordLimit;

  const orgId = await getOrganizationIdForProfile(profileId);
  if (orgId) {
    const sku = await getToolSku(toolId);
    if (await licensedOrIncluded(orgId, toolId, sku)) return null;
  }
  return sub.recordLimit;
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
  const sub = await applyPlanToProfile(
    profileId,
    paid.id,
    "active",
    provider,
    externalSubscriptionId,
    externalCustomerId,
    periodEnd,
  );
  await logSubscriptionEvent(profileId, "subscription.activated", provider, {
    externalSubscriptionId,
    planId: paid.id,
    periodEnd: periodEnd?.toISOString() ?? null,
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
