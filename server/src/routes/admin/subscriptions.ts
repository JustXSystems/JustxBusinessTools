import { Router } from "express";
import { pool } from "../../db.js";
import { logAudit } from "../../lib/audit.js";
import { applyPlanToOrganization } from "../../lib/payments/org-subscription.js";
import { getActiveOrgId } from "../../lib/request-context.js";
import { isPlatformAdmin, orgEqualsSql, orgScopeParams } from "../../lib/platform-admin.js";
import {
  ensureSubscriptionPlanSchema,
  getCatalogPlan,
  listCatalogPlans,
} from "../../lib/subscription-plans.js";
import { grantAllPaidSkus, revokeToolLicenses } from "../../lib/tool-licenses.js";
import {
  listRenewalCandidates,
  runRenewalNoticeJob,
  markDueNoticesSent,
  runExpiredSubscriptionJob,
} from "../../lib/subscriptions/renewal-notices.js";
import { notifySubscriptionAssigned } from "../../lib/notification-billing.js";

const router = Router();

function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86400000);
}

router.get("/plans", async (_req, res) => {
  res.json({ plans: await listCatalogPlans() });
});

router.post("/plans", async (_req, res) => {
  res.status(400).json({
    error: "Only two modes exist (limited / unlimited). Edit the Free or Pro plan instead of creating more.",
  });
});

router.put("/plans/:id", async (req, res) => {
  await ensureSubscriptionPlanSchema();
  const id = req.params.id;
  if (id !== "free" && id !== "pro") {
    res.status(400).json({ error: "Only the limited (free) and unlimited (pro) plans can be edited" });
    return;
  }

  // Availability-only patch
  if (req.body?.available != null && typeof req.body?.name !== "string") {
    await pool.query(`UPDATE subscription_plans SET available = :available WHERE id = :id`, {
      id,
      available: req.body.available ? 1 : 0,
    });
    await logAudit("plan.availability", "subscription_plan", id, { available: Boolean(req.body.available) }, req.ip);
    res.json({ ok: true, plan: await getCatalogPlan(id) });
    return;
  }

  const fullEdit = typeof req.body?.name === "string";
  if (!fullEdit) {
    res.status(400).json({ error: "Send the full plan fields to save" });
    return;
  }

  const accessMode = id === "pro" ? "unlimited" : "limited";
  const recordLimit =
    accessMode === "unlimited" ? null : Math.max(1, Number(req.body?.recordLimit ?? 28));
  const available = req.body?.available == null ? 1 : req.body.available ? 1 : 0;
  await pool.query(
    `UPDATE subscription_plans SET
       name = :name,
       tagline = :tagline,
       description = :description,
       price_inr = :price,
       billing_interval = :interval,
       record_limit = :limit,
       access_mode = :accessMode,
       features = :features,
       available = :available,
       highlighted = :highlighted,
       trial_days = :trialDays,
       tier_label = :tierLabel
     WHERE id = :id`,
    {
      id,
      name: String(req.body.name).trim(),
      tagline: req.body?.tagline ?? null,
      description: req.body?.description ?? null,
      price: Number(req.body?.priceInr ?? 0),
      interval: req.body?.billingInterval ?? "month",
      limit: recordLimit,
      accessMode,
      features: JSON.stringify(Array.isArray(req.body?.features) ? req.body.features : []),
      available,
      highlighted: Number(accessMode === "unlimited"),
      trialDays: Math.max(0, Math.min(365, Number(req.body?.trialDays ?? 0))),
      tierLabel: req.body?.tierLabel ? String(req.body.tierLabel).trim().slice(0, 40) : null,
    },
  );
  await logAudit("plan.update", "subscription_plan", id, { name: req.body.name, accessMode, available }, req.ip);
  res.json({ ok: true, plan: await getCatalogPlan(id) });
});

router.delete("/plans/:id", async (_req, res) => {
  res.status(400).json({ error: "The two modes cannot be deleted" });
});

router.post("/assign", async (req, res) => {
  const planId = String(req.body?.planId ?? "");
  const plan = await getCatalogPlan(planId);
  if (!plan || (planId !== "free" && planId !== "pro")) {
    res.status(400).json({ error: "Assign free (limited) or pro (unlimited)" });
    return;
  }
  let orgId = Number(req.body?.organizationId) || getActiveOrgId();
  if (!isPlatformAdmin() && orgId !== getActiveOrgId()) {
    res.status(403).json({ error: "Cannot assign for another organization" });
    return;
  }
  if (!Number.isInteger(orgId) || orgId < 1) orgId = getActiveOrgId();

  await applyPlanToOrganization(orgId, plan.id, {
    trialDays: plan.trialDays,
  });
  if (plan.id === "pro") {
    const licenseDays = plan.trialDays > 0 ? plan.trialDays : 365;
    await grantAllPaidSkus(orgId, new Date(Date.now() + licenseDays * 24 * 60 * 60 * 1000));
  } else {
    await revokeToolLicenses(orgId);
  }
  await logAudit("subscription.assign", "org_subscription", String(orgId), { planId: plan.id }, req.ip);
  await notifySubscriptionAssigned({
    organizationId: orgId,
    planId: plan.id,
    planName: plan.name,
    trialDays: plan.trialDays,
  });
  res.json({ ok: true, planId: plan.id, accessMode: plan.accessMode, organizationId: orgId });
});

router.get("/active", async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT s.plan_id, s.status, s.current_period_start, s.current_period_end, s.mrr_inr, s.payment_provider,
            s.organization_id, o.name AS org_name,
            p.name AS plan_name, p.price_inr, p.access_mode, p.record_limit
     FROM org_subscriptions s
     LEFT JOIN subscription_plans p ON p.id = s.plan_id
     LEFT JOIN organizations o ON o.id = s.organization_id
     WHERE ${orgEqualsSql("s.organization_id")}
     ORDER BY o.name, s.organization_id`,
    orgScopeParams(),
  );
  const list = Array.isArray(rows) ? rows : [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tenants = list.map((item) => {
    const r = item as Record<string, unknown>;
    const periodEnd = r.current_period_end ? String(r.current_period_end) : null;
    let daysLeft: number | null = null;
    if (periodEnd) {
      daysLeft = daysBetween(today, new Date(periodEnd));
    }
    return {
      organizationId: Number(r.organization_id),
      organizationName: String(r.org_name ?? ""),
      planId: String(r.plan_id),
      planName: r.plan_name ? String(r.plan_name) : String(r.plan_id),
      status: String(r.status),
      mrrInr: Number(r.mrr_inr ?? 0),
      periodStart: r.current_period_start ? String(r.current_period_start).slice(0, 10) : null,
      periodEnd: periodEnd ? periodEnd.slice(0, 10) : null,
      daysLeft,
      accessMode: String(r.access_mode ?? (r.plan_id === "pro" ? "unlimited" : "limited")),
      recordLimit: r.record_limit == null ? null : Number(r.record_limit),
      provider: (r.payment_provider as string | null) ?? null,
    };
  });

  const row = list[0] as Record<string, unknown> | undefined;
  const r = row ?? null;
  res.json({
    subscription: r
      ? {
          planId: String(r.plan_id),
          planName: r.plan_name ? String(r.plan_name) : String(r.plan_id),
          status: String(r.status),
          periodStart: r.current_period_start ? String(r.current_period_start) : null,
          periodEnd: r.current_period_end ? String(r.current_period_end) : null,
          mrrInr: Number(r.mrr_inr ?? 0),
          provider: (r.payment_provider as string | null) ?? null,
          priceInr: Number(r.price_inr ?? 0),
          accessMode: String(r.access_mode ?? (r.plan_id === "pro" ? "unlimited" : "limited")),
          recordLimit: r.record_limit == null ? null : Number(r.record_limit),
        }
      : null,
    tenants,
    summary: {
      total: tenants.length,
      unlimited: tenants.filter((t) => t.accessMode === "unlimited" || t.planId === "pro").length,
      limited: tenants.filter((t) => t.accessMode !== "unlimited" && t.planId !== "pro").length,
      renewingSoon: tenants.filter((t) => t.daysLeft != null && t.daysLeft >= 0 && t.daysLeft <= 14).length,
      totalMrr: tenants.reduce((sum, t) => sum + t.mrrInr, 0),
    },
  });
});

router.get("/renewals", async (req, res) => {
  const withinDays = Math.max(1, Number(req.query.withinDays ?? 14));
  res.json({ candidates: await listRenewalCandidates(withinDays), withinDays });
});

router.post("/renewals/run", async (req, res) => {
  const withinDays = Math.max(1, Number(req.body?.withinDays ?? 14));
  const result = await runRenewalNoticeJob(withinDays);
  const expired = await runExpiredSubscriptionJob();
  const autoSent = await markDueNoticesSent();
  await logAudit(
    "subscription.renewals.run",
    "subscription_notice",
    "batch",
    { ...result, expired, autoSent, withinDays },
    req.ip,
  );
  res.json({ ...result, expired, autoSent, withinDays });
});

router.get("/notices", async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT id, organization_id, kind, channel, title, body, due_at, sent_at, created_at
     FROM subscription_notices WHERE ${orgEqualsSql("organization_id")} ORDER BY created_at DESC LIMIT 50`,
    orgScopeParams(),
  );
  res.json({
    notices: (Array.isArray(rows) ? rows : []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: Number(r.id),
        organizationId: Number(r.organization_id),
        kind: String(r.kind),
        channel: String(r.channel),
        title: String(r.title),
        body: String(r.body),
        dueAt: r.due_at ? String(r.due_at) : null,
        sentAt: r.sent_at ? String(r.sent_at) : null,
        createdAt: String(r.created_at),
      };
    }),
  });
});

router.post("/notices", async (req, res) => {
  const orgId = Number(req.body?.organizationId) || getActiveOrgId();
  if (!isPlatformAdmin() && orgId !== getActiveOrgId()) {
    res.status(403).json({ error: "Cannot schedule for another organization" });
    return;
  }
  const title = String(req.body?.title ?? "").trim();
  const body = String(req.body?.body ?? "").trim();
  if (!title || !body) {
    res.status(400).json({ error: "title and body required" });
    return;
  }
  const [result] = await pool.query(
    `INSERT INTO subscription_notices (organization_id, kind, channel, title, body, due_at)
     VALUES (:orgId, :kind, :channel, :title, :body, :dueAt)`,
    {
      orgId,
      kind: req.body?.kind ?? "renewal",
      channel: req.body?.channel ?? "in_app",
      title,
      body,
      dueAt: req.body?.dueAt ?? null,
    },
  );
  res.status(201).json({ id: Number((result as { insertId: number }).insertId) });
});

router.post("/notices/:id/send", async (req, res) => {
  await pool.query(
    `UPDATE subscription_notices SET sent_at = CURRENT_TIMESTAMP
     WHERE id = :id AND ${orgEqualsSql("organization_id")}`,
    { id: Number(req.params.id), ...orgScopeParams() },
  );
  await logAudit("subscription.notice.send", "subscription_notice", req.params.id, undefined, req.ip);
  res.json({ ok: true });
});

export default router;
