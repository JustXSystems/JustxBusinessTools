import { pool } from "../../db.js";

export async function getOrganizationIdForProfile(profileId: number): Promise<number | null> {
  const [rows] = await pool.query(
    `SELECT organization_id FROM business_profiles WHERE id = :id`,
    { id: profileId },
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return null;
  const orgId = (row as { organization_id: number | null }).organization_id;
  return orgId ? Number(orgId) : null;
}

export async function syncOrgSubscription(
  organizationId: number,
  planId: string,
  status: "active" | "cancelled" | "past_due",
  provider: string,
  externalSubscriptionId?: string,
  mrrInr?: number,
  periodEnd?: Date,
): Promise<void> {
  await pool.query(
    `INSERT INTO org_subscriptions
     (organization_id, plan_id, status, current_period_start, current_period_end,
      payment_provider, external_subscription_id, mrr_inr)
     VALUES (:orgId, :planId, :status, NOW(), :periodEnd, :provider, :externalId, :mrr)
     ON DUPLICATE KEY UPDATE
       plan_id = :planId,
       status = :status,
       current_period_start = NOW(),
       current_period_end = :periodEnd,
       payment_provider = :provider,
       external_subscription_id = :externalId,
       mrr_inr = IF(:mrr IS NOT NULL, :mrr, mrr_inr)`,
    {
      orgId: organizationId,
      planId,
      status,
      periodEnd: periodEnd ?? null,
      provider,
      externalId: externalSubscriptionId ?? null,
      mrr: mrrInr ?? null,
    },
  );

  await pool.query(
    `UPDATE organizations SET plan_id = :planId WHERE id = :orgId`,
    { orgId: organizationId, planId },
  );
}

export async function applyPlanToOrganization(
  organizationId: number,
  planId: string,
  opts?: { trialDays?: number },
): Promise<void> {
  const trialDays = Math.max(0, Number(opts?.trialDays ?? 0));
  const periodEnd =
    trialDays > 0 ? new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000) : undefined;
  await syncOrgSubscription(
    organizationId,
    planId,
    "active",
    trialDays > 0 ? "trial" : "admin",
    undefined,
    undefined,
    periodEnd,
  );
  await pool.query(
    `UPDATE subscriptions s
     INNER JOIN business_profiles bp ON bp.id = s.business_profile_id
     SET s.plan_id = :planId, s.status = 'active'
     WHERE bp.organization_id = :orgId`,
    { planId, orgId: organizationId },
  );
  await pool.query(
    `INSERT INTO subscriptions (business_profile_id, plan_id, status)
     SELECT bp.id, :planId, 'active'
     FROM business_profiles bp
     WHERE bp.organization_id = :orgId
       AND NOT EXISTS (
         SELECT 1 FROM subscriptions s WHERE s.business_profile_id = bp.id
       )`,
    { planId, orgId: organizationId },
  );
}
