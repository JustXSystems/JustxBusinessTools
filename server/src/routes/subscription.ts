import { Router } from "express";
import { pool } from "../db.js";
import { getConfiguredProviderName, getPaymentProvider } from "../lib/payments/index.js";
import { getActiveOrgId, getActiveProfileId, getActiveUserId } from "../lib/request-context.js";
import { recordSaasTransaction } from "../lib/payments/saas.js";
import { cancelSubscription, getSubscription } from "../lib/subscription.js";
import { listCatalogPlans, publicPlanPayload } from "../lib/subscription-plans.js";
import { buildUpiIntent, getUpiPayee, publicPayee } from "../lib/upi/config.js";
import { createClaim, getLatestClaimForOrg } from "../lib/upi/claims.js";
import { parseToolIds, quoteToolCart, listToolSkus } from "../lib/tool-skus.js";
import {
  catalogPayload,
  licensedToolIdSet,
  listActiveLicenses,
} from "../lib/tool-licenses.js";
import { activateToolCommerce, deactivateToolCommerce } from "../lib/commerce.js";
import {
  createCheckoutIntent,
  listSubscriptionItems,
} from "../lib/subscription-items.js";
import {
  notifyCheckoutStarted,
  notifyPaymentOutcome,
  notifySubscriptionActivated,
  notifySubscriptionCancelled,
} from "../lib/notification-billing.js";

const router = Router();

async function listEnabledGateways(orgId: number) {
  const [rows] = await pool.query(
    `SELECT id, provider, display_name, mode FROM payment_gateways
     WHERE organization_id = :orgId AND enabled = 1 ORDER BY id`,
    { orgId },
  );
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: Number(r.id),
      provider: String(r.provider),
      displayName: String(r.display_name),
      mode: String(r.mode),
      methods:
        String(r.provider).toLowerCase() === "stripe"
          ? ["debit", "credit"]
          : ["upi", "debit", "credit"],
    };
  });
}

async function quoteForOrg(orgId: number, toolIds: string[]) {
  const licensed = await licensedToolIdSet(orgId);
  return quoteToolCart(toolIds, licensed);
}

router.get("/", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  const profileId = getActiveProfileId();
  const orgId = getActiveOrgId();
  const [subscription, plans, payee, claim, gateways, skus, licenses, items] = await Promise.all([
    getSubscription(profileId),
    listCatalogPlans(),
    getUpiPayee(),
    getLatestClaimForOrg(orgId),
    listEnabledGateways(orgId),
    listToolSkus(),
    listActiveLicenses(orgId),
    listSubscriptionItems(orgId),
  ]);
  const licensed = new Set(licenses.map((l) => l.toolId));
  // Only surface actionable claims — approved claims must never keep the owner on "under review".
  const pendingClaim =
    claim && (claim.status === "pending" || claim.status === "rejected")
      ? {
          id: claim.id,
          status: claim.status,
          utr: claim.utr,
          amountInr: claim.amountInr,
          toolIds: claim.toolIds,
          createdAt: claim.createdAt,
          reviewNote: claim.reviewNote,
        }
      : null;
  res.json({
    ...subscription,
    provider: "upi",
    plans: plans.filter((p) => p.available).map(publicPlanPayload),
    catalog: catalogPayload(skus, licensed),
    licenses,
    licensedToolIds: [...licensed],
    billingItems: items,
    mrrInr: items.reduce((sum, i) => sum + i.unitPriceInr, 0),
    upi: {
      ...publicPayee(payee),
      amountInr: 0,
      intent: null,
    },
    pendingClaim,
    latestClaim:
      claim
        ? {
            id: claim.id,
            status: claim.status,
            utr: claim.utr,
            amountInr: claim.amountInr,
            toolIds: claim.toolIds,
            createdAt: claim.createdAt,
            reviewNote: claim.reviewNote,
          }
        : null,
    gateways,
    serverTime: new Date().toISOString(),
  });
});

router.get("/quote", async (req, res) => {
  try {
    const orgId = getActiveOrgId();
    const toolIds = parseToolIds(req.query.tools ?? req.query.toolIds);
    const quote = await quoteForOrg(orgId, toolIds);
    const payee = await getUpiPayee();
    const note = `JustXSystems ${quote.lines.length} tool${quote.lines.length === 1 ? "" : "s"}`.slice(0, 50);
    res.json({
      ...quote,
      upi: {
        ...publicPayee(payee),
        amountInr: quote.totalInr,
        intent: payee.enabled && payee.vpa ? buildUpiIntent(payee, quote.totalInr, note) : null,
      },
    });
  } catch (err) {
    const status = Number((err as { status?: number }).status) || 400;
    res.status(status).json({ error: err instanceof Error ? err.message : "Could not quote cart" });
  }
});

router.post("/upi-claims", async (req, res) => {
  try {
    const toolIds = parseToolIds(req.body?.toolIds ?? req.body?.tools);
    const quote = await quoteForOrg(getActiveOrgId(), toolIds);
    const payerEmail = String(req.body?.payerEmail ?? "").trim();
    const payerName = String(req.body?.payerName ?? "").trim();
    const utr = String(req.body?.utr ?? "").trim();
    if (!payerEmail || !payerName || !utr) {
      res.status(400).json({ error: "Name, email, and UPI/UTR reference are required" });
      return;
    }
    const [orgRows] = await pool.query(`SELECT name FROM organizations WHERE id = :id`, {
      id: getActiveOrgId(),
    });
    const orgName = Array.isArray(orgRows)
      ? String((orgRows[0] as { name?: string } | undefined)?.name ?? "")
      : "";
    const claim = await createClaim({
      orgId: getActiveOrgId(),
      userId: getActiveUserId(),
      profileId: getActiveProfileId(),
      planId: "cart",
      toolIds: quote.lines.map((l) => l.toolId),
      amountInr: quote.totalInr,
      payerName,
      payerEmail,
      payerPhone: req.body?.payerPhone ?? null,
      payerUpi: req.body?.payerUpi ?? null,
      utr,
      paidAt: req.body?.paidAt ?? null,
      notes: req.body?.notes ?? null,
      orgName,
    });
    res.status(201).json({
      claim,
      message: "Submitted. JustXSystems will verify this UPI payment and notify you.",
    });
  } catch (err) {
    const status = Number((err as { status?: number }).status) || 400;
    res.status(status).json({ error: err instanceof Error ? err.message : "Could not submit claim" });
  }
});

router.post("/checkout", async (req, res) => {
  try {
    const toolIds = parseToolIds(req.body?.toolIds ?? req.body?.tools);
    const quote = await quoteForOrg(getActiveOrgId(), toolIds);
    const profileId = getActiveProfileId();
    const orgId = getActiveOrgId();
    const gatewayId = Number(req.body?.gatewayId ?? 0);
    let providerName = getConfiguredProviderName();
    if (gatewayId) {
      const [gwRows] = await pool.query(
        `SELECT provider FROM payment_gateways
         WHERE id = :id AND organization_id = :orgId AND enabled = 1 LIMIT 1`,
        { id: gatewayId, orgId },
      );
      const gw = Array.isArray(gwRows) ? (gwRows[0] as { provider?: string } | undefined) : undefined;
      if (!gw?.provider) {
        res.status(400).json({ error: "Selected payment gateway is not available" });
        return;
      }
      providerName = String(gw.provider);
    }
    let provider;
    try {
      provider = getPaymentProvider(providerName);
    } catch {
      provider = getPaymentProvider("mock");
    }
    const session = await provider.createCheckoutSession({
      profileId,
      planId: "cart",
      amountInr: quote.totalInr,
      toolIds: quote.lines.map((l) => l.toolId),
    });

    await createCheckoutIntent({
      orgId,
      profileId,
      sessionId: session.sessionId,
      toolIds: quote.lines.map((l) => l.toolId),
      amountInr: quote.totalInr,
      provider: provider.name,
    });

    const autoComplete = process.env.PAYMENT_AUTO_COMPLETE === "true";
    if (autoComplete && provider.name === "mock") {
      const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const tools = quote.lines.map((l) => l.toolId);
      await activateToolCommerce({
        orgId,
        toolIds: tools,
        source: "card",
        externalRef: session.sessionId,
        periodEnd,
      });
      const { completeCheckoutIntent } = await import("../lib/subscription-items.js");
      await completeCheckoutIntent(session.sessionId);
      await recordSaasTransaction(
        orgId,
        "subscription_charge",
        "success",
        quote.totalInr,
        provider.name,
        session.sessionId,
      );
      notifyPaymentOutcome({
        organizationId: orgId,
        success: true,
        amountInr: quote.totalInr,
        provider: provider.name,
        reference: session.sessionId,
      });
      notifySubscriptionActivated({
        organizationId: orgId,
        profileId,
        planId: "cart",
        planName: `${tools.length} tool license(s)`,
        provider: provider.name,
      });
      const subscription = await getSubscription(profileId);
      res.json({
        ...session,
        activated: true,
        subscription,
        quote,
      });
      return;
    }

    notifyCheckoutStarted({
      organizationId: orgId,
      amountInr: quote.totalInr,
      toolIds: quote.lines.map((l) => l.toolId),
      provider: provider.name,
    });

    res.json({
      ...session,
      activated: false,
      quote,
      message:
        "Complete card payment on the payment gateway. Tools activate after the provider webhook confirms the charge.",
    });
  } catch (err) {
    const status = Number((err as { status?: number }).status) || 400;
    res.status(status).json({ error: err instanceof Error ? err.message : "Checkout failed" });
  }
});

router.post("/cancel", async (req, res) => {
  const profileId = getActiveProfileId();
  const orgId = getActiveOrgId();
  const toolIds = parseToolIds(req.body?.toolIds);
  const current = await getSubscription(profileId);
  if (toolIds.length > 0) {
    await deactivateToolCommerce({ orgId, toolIds });
    res.json(await getSubscription(profileId));
    return;
  }
  await deactivateToolCommerce({ orgId });
  // If they held the All Tools Pack plan, step workspace back to freemium.
  if (current.isUnlimited || current.planId === "pro") {
    const subscription = await cancelSubscription(
      profileId,
      current.paymentProvider ?? getConfiguredProviderName(),
      current.externalSubscriptionId ?? "manual_cancel",
    );
    notifySubscriptionCancelled({
      organizationId: orgId,
      profileId,
      provider: current.paymentProvider,
    });
    res.json(subscription);
    return;
  }
  res.json(await getSubscription(profileId));
});

export default router;
