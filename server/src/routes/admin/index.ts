import { Router } from "express";
import { requireAdminRole } from "../../middleware/require-auth.js";
import analyticsRouter from "./analytics.js";
import approvalsInboxRouter from "./approvals-inbox.js";
import auditRouter from "./audit.js";
import branchesRouter from "./branches.js";
import catalogRouter from "./catalog.js";
import configRouter from "./config.js";
import gatewaysRouter from "./gateways.js";
import opsRouter from "./ops.js";
import paymentsRouter from "./payments.js";
import profilesRouter from "./profiles.js";
import skusRouter from "./skus.js";
import subscriptionsRouter from "./subscriptions.js";
import teamRouter from "./team.js";
import themesRouter from "./themes.js";

const router = Router();

router.use((req, res, next) => {
  void requireAdminRole(req, res, next);
});

router.get("/dashboard", async (_req, res) => {
  const { getAnalyticsOverview } = await import("../../lib/analytics/events.js");
  const { getCollectionsSummary } = await import("../../lib/payments/collections.js");
  const { getSaasPaymentSummary } = await import("../../lib/payments/saas.js");
  const { listRenewalCandidates } = await import("../../lib/subscriptions/renewal-notices.js");
  const { loadPendingInbox } = await import("../../lib/admin/pending-inbox.js");
  const { adminDeepLink } = await import("../../lib/admin/deep-links.js");
  const { pool } = await import("../../db.js");
  const { orgEqualsSql, orgScopeParams } = await import("../../lib/platform-admin.js");

  const scope = orgScopeParams();
  const orgPred = orgEqualsSql("organization_id");

  const [analytics, collections, saas, renewals, pendingInbox, gatewayRows, usagePulseRows] = await Promise.all([
    getAnalyticsOverview(30),
    getCollectionsSummary(),
    getSaasPaymentSummary(90),
    listRenewalCandidates(14),
    loadPendingInbox(),
    pool.query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) AS enabled,
         SUM(CASE WHEN enabled = 1 AND (last_health IS NULL OR last_health <> 'ok') THEN 1 ELSE 0 END) AS unhealthy
       FROM payment_gateways
       WHERE ${orgPred}`,
      scope,
    ),
    pool.query(
      `SELECT
         SUM(CASE WHEN occurred_at >= DATE_SUB(NOW(), INTERVAL 60 MINUTE) THEN 1 ELSE 0 END) AS last_hour,
         SUM(CASE WHEN occurred_at >= DATE_SUB(NOW(), INTERVAL 15 MINUTE) THEN 1 ELSE 0 END) AS last_15m,
         COUNT(DISTINCT CASE WHEN occurred_at >= DATE_SUB(NOW(), INTERVAL 60 MINUTE) THEN user_id END) AS actors_hour
       FROM usage_events
       WHERE ${orgPred}`,
      scope,
    ),
  ]);

  const profiles = pendingInbox.summary.profiles;
  const users = pendingInbox.summary.users;
  const desk = pendingInbox.summary.deskOps;
  const upiPending = pendingInbox.summary.upiClaims;
  const upiAmountInr = pendingInbox.summary.upiAmountInr;

  let deliveryFailed = 0;
  let deliveryPending = 0;
  try {
    const [deliveryRows] = await pool.query(
      `SELECT
         SUM(CASE WHEN sync_status = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN sync_status IN ('pending', 'in_progress') THEN 1 ELSE 0 END) AS pending
       FROM artifact_deliveries
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
         AND ${orgEqualsSql("organization_id")}`,
      scope,
    );
    const d = (Array.isArray(deliveryRows) ? deliveryRows[0] : null) as
      | { failed?: number; pending?: number }
      | null;
    deliveryFailed = Number(d?.failed) || 0;
    deliveryPending = Number(d?.pending) || 0;
  } catch {
    /* optional table */
  }

  let auditHighRisk = 0;
  try {
    const { getAuditOverview } = await import("../../lib/audit-query.js");
    const audit = await getAuditOverview(7);
    auditHighRisk = Number(audit.totals?.highRisk) || 0;
  } catch {
    /* optional */
  }

  const firstRow = (result: unknown) => {
    const rows = Array.isArray(result) ? result[0] : null;
    return (Array.isArray(rows) ? rows[0] : null) as Record<string, unknown> | null;
  };

  const renewalsSoon = renewals.length;
  const limitBlocks = Number(analytics.totals.limit_blocks) || 0;

  const gw = firstRow(gatewayRows);
  const gatewaysTotal = Number(gw?.total) || 0;
  const gatewaysEnabled = Number(gw?.enabled) || 0;
  const gatewaysUnhealthy = Number(gw?.unhealthy) || 0;

  const pulseRow = firstRow(usagePulseRows);
  const pulse = {
    lastHour: Number(pulseRow?.last_hour) || 0,
    last15m: Number(pulseRow?.last_15m) || 0,
    actorsHour: Number(pulseRow?.actors_hour) || 0,
  };

  type AttentionItem = {
    id: string;
    severity: "critical" | "high" | "medium" | "info";
    title: string;
    detail: string;
    count: number;
    href: string;
  };

  const attention: AttentionItem[] = [];
  if (profiles > 0) {
    attention.push({
      id: "profiles",
      severity: "high",
      title: "Branches awaiting approval",
      detail: `${profiles} GST branch${profiles === 1 ? "" : "es"} pending review`,
      count: profiles,
      href: adminDeepLink.approvals("profile"),
    });
  }
  if (users > 0) {
    attention.push({
      id: "users",
      severity: "high",
      title: "Users awaiting approval",
      detail: `${users} teammate${users === 1 ? "" : "s"} cannot sign in until approved`,
      count: users,
      href: adminDeepLink.approvals("user"),
    });
  }
  if (upiPending > 0) {
    attention.push({
      id: "upi",
      severity: "critical",
      title: "UPI claims pending",
      detail: `${upiPending} claim${upiPending === 1 ? "" : "s"} · ₹${Math.round(upiAmountInr).toLocaleString("en-IN")}`,
      count: upiPending,
      href: adminDeepLink.approvals("upi_claim"),
    });
  }
  if (desk > 0) {
    attention.push({
      id: "desk",
      severity: "medium",
      title: "Payment desk items",
      detail: `${desk} offline / manual payment${desk === 1 ? "" : "s"} need a decision`,
      count: desk,
      href: adminDeepLink.approvals("payment_op"),
    });
  }
  if (renewalsSoon > 0) {
    attention.push({
      id: "renewals",
      severity: "medium",
      title: "Renewals within 14 days",
      detail: `${renewalsSoon} subscription${renewalsSoon === 1 ? "" : "s"} approaching period end`,
      count: renewalsSoon,
      href: adminDeepLink.subscriptions(),
    });
  }
  if (limitBlocks > 0) {
    attention.push({
      id: "blocks",
      severity: "medium",
      title: "Limit blocks (30d)",
      detail: `${limitBlocks} blocked save${limitBlocks === 1 ? "" : "s"} — freemium friction / upgrade signal`,
      count: limitBlocks,
      href: adminDeepLink.analytics(),
    });
  }
  if (deliveryFailed > 0) {
    attention.push({
      id: "delivery",
      severity: "high",
      title: "Document delivery failures",
      detail: `${deliveryFailed} failed PDF deliver${deliveryFailed === 1 ? "y" : "ies"} in the last 7 days`,
      count: deliveryFailed,
      href: adminDeepLink.profiles(),
    });
  }
  if (gatewaysUnhealthy > 0) {
    attention.push({
      id: "gateways",
      severity: "high",
      title: "Gateway health needs check",
      detail: `${gatewaysUnhealthy} enabled gateway${gatewaysUnhealthy === 1 ? "" : "s"} untested or unhealthy`,
      count: gatewaysUnhealthy,
      href: adminDeepLink.gateways("unhealthy"),
    });
  }
  if (auditHighRisk > 0) {
    attention.push({
      id: "audit",
      severity: auditHighRisk >= 8 ? "critical" : "medium",
      title: "High-risk audit events (7d)",
      detail: `${auditHighRisk} security / access / billing events worth a look`,
      count: auditHighRisk,
      href: adminDeepLink.audit(),
    });
  }

  const severityRank = { critical: 0, high: 1, medium: 2, info: 3 } as const;
  attention.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || b.count - a.count);

  res.json({
    analytics: {
      totals: analytics.totals,
      topTools: analytics.byTool.slice(0, 5),
      dailyCreates: analytics.dailyCreates,
      daily: analytics.daily,
      grain: analytics.grain ?? "day",
    },
    collections: collections.summary,
    subscription: saas.subscription,
    payments: saas.summary,
    inbox: {
      profiles,
      users,
      deskOps: desk,
      upiClaims: upiPending,
      upiAmountInr,
      renewalsSoon,
      total: profiles + users + desk + upiPending,
    },
    attention,
    health: {
      gateways: {
        total: gatewaysTotal,
        enabled: gatewaysEnabled,
        unhealthy: gatewaysUnhealthy,
      },
      delivery: {
        failed7d: deliveryFailed,
        pending7d: deliveryPending,
      },
      audit: {
        highRisk7d: auditHighRisk,
      },
      payments: {
        failedCount: Number(saas.summary?.failedCount) || 0,
        failureRate: Number(saas.summary?.failureRate) || 0,
        collectedInr: Number(saas.summary?.collectedInr) || 0,
      },
    },
    pulse,
  });
});

router.use("/analytics", analyticsRouter);
router.use("/approvals", approvalsInboxRouter);
router.use("/audit", auditRouter);
router.use("/ops", opsRouter);
router.use("/payments", paymentsRouter);
router.use("/branches", branchesRouter);
router.use("/profiles", profilesRouter);
router.use("/team", teamRouter);
router.use("/catalog", catalogRouter);
router.use("/skus", skusRouter);
router.use("/subscriptions", subscriptionsRouter);
router.use("/gateways", gatewaysRouter);
router.use("/themes", themesRouter);
router.use("/config", configRouter);

export default router;
