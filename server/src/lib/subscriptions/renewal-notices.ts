import { pool } from "../../db.js";
import { orgEqualsSql, orgScopeParams, isPlatformAdmin } from "../platform-admin.js";
import { publishNotificationAsync } from "../notification-publish.js";
import { notifySubscriptionExpired } from "../notification-billing.js";

export type RenewalCandidate = {
  organizationId: number;
  organizationName: string;
  planId: string;
  planName: string;
  periodEnd: string;
  daysLeft: number;
  mrrInr: number;
};

function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86400000);
}

/** Orgs with period ending within `withinDays` (inclusive of today). */
export async function listRenewalCandidates(withinDays = 14): Promise<RenewalCandidate[]> {
  const days = Math.max(1, Math.min(90, Math.floor(withinDays)));
  const [rows] = await pool.query(
    `SELECT s.organization_id, o.name AS org_name, s.plan_id, p.name AS plan_name,
            s.current_period_end, s.mrr_inr
     FROM org_subscriptions s
     LEFT JOIN organizations o ON o.id = s.organization_id
     LEFT JOIN subscription_plans p ON p.id = s.plan_id
     WHERE s.status = 'active'
       AND s.current_period_end IS NOT NULL
       AND s.current_period_end <= DATE_ADD(CURDATE(), INTERVAL ${days} DAY)
       AND s.current_period_end >= CURDATE()
       AND ${orgEqualsSql("s.organization_id")}
     ORDER BY s.current_period_end ASC`,
    orgScopeParams(),
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (Array.isArray(rows) ? rows : []).map((row) => {
    const r = row as Record<string, unknown>;
    const end = new Date(String(r.current_period_end));
    return {
      organizationId: Number(r.organization_id),
      organizationName: String(r.org_name ?? ""),
      planId: String(r.plan_id),
      planName: r.plan_name ? String(r.plan_name) : String(r.plan_id),
      periodEnd: String(r.current_period_end).slice(0, 10),
      daysLeft: daysBetween(today, end),
      mrrInr: Number(r.mrr_inr ?? 0),
    };
  });
}

async function existingNotice(orgId: number, periodEnd: string): Promise<boolean> {
  const [rows] = await pool.query(
    `SELECT id FROM subscription_notices
     WHERE organization_id = :orgId
       AND kind = 'renewal'
       AND DATE(due_at) = DATE(:periodEnd)
     LIMIT 1`,
    { orgId, periodEnd },
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function enqueueInAppOutbox(orgId: number, title: string, body: string): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO notify_outbox
         (channel, destination, subject, body, kind, claim_id, status, error_message)
       VALUES ('in_app', :dest, :subject, :body, 'subscription.renewal', NULL, 'queued', NULL)`,
      {
        dest: `org:${orgId}`,
        subject: title,
        body,
      },
    );
  } catch {
    /* outbox table may be missing on older DBs */
  }
}

/**
 * Create renewal notices + outbox rows for due subscriptions.
 * Idempotent per org + period end date.
 */
export async function runRenewalNoticeJob(withinDays = 14): Promise<{
  scanned: number;
  created: number;
  skipped: number;
  candidates: RenewalCandidate[];
}> {
  const candidates = await listRenewalCandidates(withinDays);
  let created = 0;
  let skipped = 0;

  for (const c of candidates) {
    if (await existingNotice(c.organizationId, c.periodEnd)) {
      skipped += 1;
      continue;
    }
    const title = `Renewal due${c.daysLeft === 0 ? " today" : ` in ${c.daysLeft} day(s)`}`;
    const body = `${c.organizationName || `Org ${c.organizationId}`} · ${c.planName} renews on ${c.periodEnd}. MRR ${c.mrrInr}.`;
    await pool.query(
      `INSERT INTO subscription_notices (organization_id, kind, channel, title, body, due_at)
       VALUES (:orgId, 'renewal', 'in_app', :title, :body, :dueAt)`,
      {
        orgId: c.organizationId,
        title,
        body,
        dueAt: `${c.periodEnd} 09:00:00`,
      },
    );
    await enqueueInAppOutbox(c.organizationId, title, body);
    publishNotificationAsync({
      eventType: "billing.subscription_renewal",
      title,
      body,
      organizationId: c.organizationId,
      businessProfileId: null,
      href: "/admin/subscriptions",
      entityType: "org_subscription",
      entityId: String(c.organizationId),
      dedupeKey: `renewal:${c.organizationId}:${c.periodEnd}`,
      dueAt: c.periodEnd,
      severity: c.daysLeft <= 3 ? "urgent" : "attention",
      meta: { planId: c.planId, planName: c.planName, mrrInr: c.mrrInr, daysLeft: c.daysLeft },
      expiresInHours: 336,
    });
    created += 1;
  }

  return { scanned: candidates.length, created, skipped, candidates };
}

/** Notify orgs whose paid period already ended (idempotent per period end). */
export async function runExpiredSubscriptionJob(): Promise<{
  scanned: number;
  created: number;
  skipped: number;
}> {
  const [rows] = await pool.query(
    `SELECT s.organization_id, o.name AS org_name, s.plan_id, p.name AS plan_name, s.current_period_end
     FROM org_subscriptions s
     LEFT JOIN organizations o ON o.id = s.organization_id
     LEFT JOIN subscription_plans p ON p.id = s.plan_id
     WHERE s.status IN ('active', 'past_due')
       AND s.current_period_end IS NOT NULL
       AND s.current_period_end < CURDATE()
       AND ${orgEqualsSql("s.organization_id")}
     ORDER BY s.current_period_end ASC
     LIMIT 200`,
    orgScopeParams(),
  );

  let created = 0;
  let skipped = 0;
  const list = Array.isArray(rows) ? rows : [];

  for (const row of list) {
    const r = row as Record<string, unknown>;
    const orgId = Number(r.organization_id);
    const periodEnd = String(r.current_period_end).slice(0, 10);
    const planName = r.plan_name ? String(r.plan_name) : String(r.plan_id);

    const [existing] = await pool.query(
      `SELECT id FROM subscription_notices
       WHERE organization_id = :orgId AND kind = 'expired' AND DATE(due_at) = DATE(:periodEnd)
       LIMIT 1`,
      { orgId, periodEnd },
    );
    if (Array.isArray(existing) && existing.length > 0) {
      skipped += 1;
      continue;
    }

    const title = "Subscription expired";
    const body = `${String(r.org_name ?? `Org ${orgId}`)} · ${planName} ended on ${periodEnd}.`;
    await pool.query(
      `INSERT INTO subscription_notices (organization_id, kind, channel, title, body, due_at)
       VALUES (:orgId, 'expired', 'in_app', :title, :body, :dueAt)`,
      { orgId, title, body, dueAt: `${periodEnd} 09:00:00` },
    );
    await enqueueInAppOutbox(orgId, title, body);
    notifySubscriptionExpired({ organizationId: orgId, planName, periodEnd });
    await pool.query(
      `UPDATE org_subscriptions SET status = 'past_due'
       WHERE organization_id = :orgId AND status = 'active'`,
      { orgId },
    );
    created += 1;
  }

  return { scanned: list.length, created, skipped };
}

export async function markDueNoticesSent(): Promise<number> {
  const scope = isPlatformAdmin()
    ? { sql: "1=1", params: {} }
    : { sql: "organization_id = :orgId", params: orgScopeParams() };
  const [result] = await pool.query(
    `UPDATE subscription_notices
     SET sent_at = CURRENT_TIMESTAMP
     WHERE sent_at IS NULL
       AND due_at IS NOT NULL
       AND due_at <= NOW()
       AND ${scope.sql}`,
    scope.params,
  );
  return Number((result as { affectedRows?: number }).affectedRows ?? 0);
}
