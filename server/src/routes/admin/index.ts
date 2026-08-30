import { Router } from "express";
import { requireAdminRole } from "../../middleware/require-auth.js";
import analyticsRouter from "./analytics.js";
import approvalsInboxRouter from "./approvals-inbox.js";
import auditRouter from "./audit.js";
import branchesRouter from "./branches.js";
import catalogRouter from "./catalog.js";
import configRouter from "./config.js";
import gatewaysRouter from "./gateways.js";
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
  const { pool } = await import("../../db.js");
  const { orgEqualsSql, orgScopeParams } = await import("../../lib/platform-admin.js");

  const [analytics, collections, saas, renewals, profilePending, userPending, deskPending] =
    await Promise.all([
      getAnalyticsOverview(30),
      getCollectionsSummary(),
      getSaasPaymentSummary(90),
      listRenewalCandidates(14),
      pool.query(
        `SELECT COUNT(*) AS cnt
         FROM business_profiles p
         LEFT JOIN business_profile_meta m ON m.business_profile_id = p.id
         WHERE COALESCE(m.approval_status, 'approved') = 'pending'
           AND ${orgEqualsSql("p.organization_id")}`,
        orgScopeParams(),
      ),
      pool.query(
        `SELECT COUNT(*) AS cnt
         FROM org_members m
         INNER JOIN users u ON u.id = m.user_id
         WHERE u.status = 'pending' AND ${orgEqualsSql("m.organization_id")}`,
        orgScopeParams(),
      ),
      pool.query(
        `SELECT COUNT(*) AS cnt FROM payment_ops
         WHERE approval_status = 'pending' AND ${orgEqualsSql("organization_id")}`,
        orgScopeParams(),
      ),
    ]);

  let upiPending = 0;
  let upiAmountInr = 0;
  try {
    const { listClaims } = await import("../../lib/upi/claims.js");
    const claims = await listClaims("pending");
    upiPending = claims.length;
    upiAmountInr = claims.reduce((sum, c) => sum + c.amountInr, 0);
  } catch {
    /* optional */
  }

  const countOf = (result: unknown) => {
    const rows = Array.isArray(result) ? result[0] : null;
    const first = Array.isArray(rows) ? rows[0] : null;
    return Number((first as { cnt?: number } | null)?.cnt ?? 0);
  };

  const profiles = countOf(profilePending);
  const users = countOf(userPending);
  const desk = countOf(deskPending);

  res.json({
    analytics: {
      totals: analytics.totals,
      topTools: analytics.byTool.slice(0, 5),
      dailyCreates: analytics.dailyCreates,
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
      renewalsSoon: renewals.length,
      total: profiles + users + desk + upiPending,
    },
  });
});

router.use("/analytics", analyticsRouter);
router.use("/approvals", approvalsInboxRouter);
router.use("/audit", auditRouter);
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
