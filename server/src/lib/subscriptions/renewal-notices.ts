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
  toolId?: string | null;
  toolName?: string | null;
  isTrial?: boolean;
  checkoutHref?: string;
};

/** Pure copy + deep-link builder for org-level and per-tool paid/trial renewal notices. */
export function buildRenewalNotificationCopy(c: RenewalCandidate): {
  kind: "renewal" | "trial_ending";
  title: string;
  body: string;
  href: string;
  severity: "urgent" | "attention";
  dedupeKey: string;
} {
  const when = c.daysLeft <= 0 ? "today" : `in ${c.daysLeft} day(s)`;
  const orgLabel = c.organizationName || `Org ${c.organizationId}`;
  const severity: "urgent" | "attention" = c.daysLeft <= 3 ? "urgent" : "attention";
  if (c.toolId) {
    const label = c.toolName || c.planName || c.toolId;
    const href = `/subscription/checkout?tool=${encodeURIComponent(c.toolId)}&cycle=year`;
    if (c.isTrial) {
      return {
        kind: "trial_ending",
        title: `${label} trial ends ${when}`,
        body: `${orgLabel} · Your free trial for ${label} ends on ${c.periodEnd}. Convert to paid now and save 17% on yearly billing.`,
        href,
        severity,
        dedupeKey: `trial_end:${c.organizationId}:${c.toolId}:${c.periodEnd}`,
      };
    }
    return {
      kind: "renewal",
      title: `${label} renews ${when}`,
      body: `${orgLabel} · ${label} license ends on ${c.periodEnd}. Renew early to stack remaining days (or save 17% yearly).`,
      href,
      severity,
      dedupeKey: `tool_renewal:${c.organizationId}:${c.toolId}:${c.periodEnd}`,
    };
  }
  return {
    kind: "renewal",
    title: `Renewal due ${when}`,
    body: `${orgLabel} · ${c.planName} renews on ${c.periodEnd}. MRR ₹${Math.round(c.mrrInr)}.`,
    href: "/subscription?cycle=year",
    severity,
    dedupeKey: `renewal:${c.organizationId}:${c.periodEnd}`,
  };
}

function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86400000);
}

/** Orgs + per-tool licenses/trials with period ending within `withinDays` (inclusive of today). */
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

  const orgCandidates: RenewalCandidate[] = (Array.isArray(rows) ? rows : []).map((row) => {
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
      checkoutHref: "/subscription?cycle=year",
    };
  });

  // Also scan per-tool paid licenses and active trials expiring soon
  let toolCandidates: RenewalCandidate[] = [];
  try {
    const [toolRows] = await pool.query(
      `SELECT l.organization_id, o.name AS org_name, l.tool_id,
              COALESCE(sku.name, l.tool_id) AS tool_name,
              COALESCE(sku.price_inr, 0) AS price_inr,
              l.status, MIN(l.period_end) AS period_end
       FROM org_tool_licenses l
       LEFT JOIN organizations o ON o.id = l.organization_id
       LEFT JOIN tool_skus sku ON sku.tool_id = l.tool_id
       WHERE l.status IN ('active', 'trial')
         AND l.period_end IS NOT NULL
         AND l.period_end <= DATE_ADD(CURDATE(), INTERVAL ${days} DAY)
         AND l.period_end >= CURDATE()
         AND ${orgEqualsSql("l.organization_id")}
       GROUP BY l.organization_id, o.name, l.tool_id, sku.name, sku.price_inr, l.status
       ORDER BY period_end ASC
       LIMIT 200`,
      orgScopeParams(),
    );
    toolCandidates = (Array.isArray(toolRows) ? toolRows : []).map((row) => {
      const r = row as Record<string, unknown>;
      const toolId = String(r.tool_id);
      const toolName = String(r.tool_name ?? toolId);
      const isTrial = String(r.status) === "trial";
      const end = new Date(String(r.period_end));
      return {
        organizationId: Number(r.organization_id),
        organizationName: String(r.org_name ?? ""),
        planId: isTrial ? `trial:${toolId}` : `tool:${toolId}`,
        planName: isTrial ? `${toolName} (Trial)` : toolName,
        periodEnd: String(r.period_end).slice(0, 10),
        daysLeft: daysBetween(today, end),
        mrrInr: isTrial ? 0 : Number(r.price_inr ?? 0),
        toolId,
        toolName,
        isTrial,
        checkoutHref: `/subscription/checkout?tool=${encodeURIComponent(toolId)}&cycle=year`,
      };
    });
  } catch {
    /* org_tool_licenses table may not exist on minimal setups */
  }

  return [...orgCandidates, ...toolCandidates].sort((a, b) => a.daysLeft - b.daysLeft);
}

async function existingNotice(
  orgId: number,
  periodEnd: string,
  kind: string,
  titlePrefix?: string,
): Promise<boolean> {
  const [rows] = await pool.query(
    `SELECT id FROM subscription_notices
     WHERE organization_id = :orgId
       AND kind = :kind
       AND DATE(due_at) = DATE(:periodEnd)
       ${titlePrefix ? "AND title = :title" : ""}
     LIMIT 1`,
    { orgId, periodEnd, kind, ...(titlePrefix ? { title: titlePrefix } : {}) },
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
    const copy = buildRenewalNotificationCopy(c);
    if (await existingNotice(c.organizationId, c.periodEnd, copy.kind, c.toolId ? copy.title : undefined)) {
      skipped += 1;
      continue;
    }
    await pool.query(
      `INSERT INTO subscription_notices (organization_id, kind, channel, title, body, due_at)
       VALUES (:orgId, :kind, 'in_app', :title, :body, :dueAt)`,
      {
        orgId: c.organizationId,
        kind: copy.kind,
        title: copy.title,
        body: copy.body,
        dueAt: `${c.periodEnd} 09:00:00`,
      },
    );
    await enqueueInAppOutbox(c.organizationId, copy.title, copy.body);
    publishNotificationAsync({
      eventType: "billing.subscription_renewal",
      title: copy.title,
      body: copy.body,
      organizationId: c.organizationId,
      businessProfileId: null,
      href: copy.href,
      entityType: c.toolId ? "org_tool_license" : "org_subscription",
      entityId: c.toolId ? `${c.organizationId}:${c.toolId}` : String(c.organizationId),
      dedupeKey: copy.dedupeKey,
      dueAt: c.periodEnd,
      severity: copy.severity,
      meta: {
        planId: c.planId,
        planName: c.planName,
        toolId: c.toolId ?? null,
        isTrial: Boolean(c.isTrial),
        mrrInr: c.mrrInr,
        daysLeft: c.daysLeft,
      },
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
