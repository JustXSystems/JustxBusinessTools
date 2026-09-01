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
  trialConsumedToolIdSet,
} from "../lib/tool-licenses.js";
import { activateToolCommerce, deactivateToolCommerce } from "../lib/commerce.js";
import {
  alignOrgItemPricesWithSkus,
  createCheckoutIntent,
  listSubscriptionItems,
} from "../lib/subscription-items.js";
import {
  listAvailableProductBundles,
  publicBundlePayload,
  quoteBundleCart,
  type BundleCartQuote,
} from "../lib/product-bundles.js";
import { type CartQuote } from "../lib/tool-skus.js";
import {
  notifyCheckoutStarted,
  notifyPaymentOutcome,
  notifySubscriptionActivated,
  notifySubscriptionCancelled,
} from "../lib/notification-billing.js";

const router = Router();

function isBundleQuote(quote: CartQuote | BundleCartQuote): quote is BundleCartQuote {
  return "bundleId" in quote && typeof quote.bundleId === "string" && quote.bundleId.length > 0;
}

async function listEnabledGateways(orgId: number) {
  try {
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
  } catch (err) {
    console.warn("[subscription] listEnabledGateways:", err);
    return [];
  }
}

async function quoteForOrg(
  orgId: number,
  toolIds: string[],
  bundleId?: string,
): Promise<CartQuote | BundleCartQuote> {
  const licensed = await licensedToolIdSet(orgId);
  if (bundleId) {
    return quoteBundleCart(bundleId, licensed);
  }
  return quoteToolCart(toolIds, licensed);
}

router.get("/", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  try {
    const profileId = getActiveProfileId();
    const orgId = getActiveOrgId();
    // Keep active MRR lines on current SKU list prices (trials stay 0).
    try {
      await alignOrgItemPricesWithSkus(orgId);
    } catch (err) {
      console.warn("[subscription] alignOrgItemPricesWithSkus:", err);
    }

    const settled = await Promise.allSettled([
      getSubscription(profileId),
      listCatalogPlans(),
      getUpiPayee(),
      getLatestClaimForOrg(orgId),
      listEnabledGateways(orgId),
      listToolSkus(),
      listActiveLicenses(orgId),
      listSubscriptionItems(orgId),
      listAvailableProductBundles(),
      trialConsumedToolIdSet(orgId),
    ]);

    const logRejected = (label: string, idx: number) => {
      const r = settled[idx];
      if (r.status === "rejected") console.error(`[subscription] ${label}:`, r.reason);
    };
    logRejected("getSubscription", 0);
    logRejected("listCatalogPlans", 1);
    logRejected("getUpiPayee", 2);
    logRejected("getLatestClaimForOrg", 3);
    logRejected("listEnabledGateways", 4);
    logRejected("listToolSkus", 5);
    logRejected("listActiveLicenses", 6);
    logRejected("listSubscriptionItems", 7);
    logRejected("listAvailableProductBundles", 8);
    logRejected("trialConsumedToolIdSet", 9);

    const subscription =
      settled[0].status === "fulfilled"
        ? settled[0].value
        : {
            businessProfileId: profileId,
            planId: "free",
            planName: "Freemium",
            status: "active" as const,
            currentPeriodStart: null,
            currentPeriodEnd: null,
            paymentProvider: null,
            externalSubscriptionId: null,
            externalCustomerId: null,
            recordLimit: 28,
            accessMode: "limited" as const,
            isUnlimited: false,
            isPro: false,
          };
    if (settled[0].status === "rejected") {
      res.status(500).json({
        error:
          settled[0].reason instanceof Error
            ? settled[0].reason.message
            : "Could not load subscription",
      });
      return;
    }

    const plans = settled[1].status === "fulfilled" ? settled[1].value : [];
    const payee =
      settled[2].status === "fulfilled"
        ? settled[2].value
        : { enabled: false, vpa: "", payeeName: "JustXSystems LLP", merchantCode: "" };
    const claim = settled[3].status === "fulfilled" ? settled[3].value : null;
    const gateways = settled[4].status === "fulfilled" ? settled[4].value : [];
    const skus = settled[5].status === "fulfilled" ? settled[5].value : [];
    const licenses = settled[6].status === "fulfilled" ? settled[6].value : [];
    const items = settled[7].status === "fulfilled" ? settled[7].value : [];
    const packs = settled[8].status === "fulfilled" ? settled[8].value : [];
    const trialConsumed =
      settled[9].status === "fulfilled" ? settled[9].value : new Set<string>();

    if (settled[5].status === "rejected") {
      res.status(500).json({
        error:
          settled[5].reason instanceof Error
            ? settled[5].reason.message
            : "Could not load tool catalog",
      });
      return;
    }

    const licensed = new Set(licenses.map((l) => l.toolId));
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
      catalog: catalogPayload(skus, licensed, trialConsumed),
      packs: packs.map(publicBundlePayload),
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
  } catch (err) {
    console.error("[subscription] GET / failed:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Could not load subscription",
    });
  }
});

router.get("/quote", async (req, res) => {
  try {
    const orgId = getActiveOrgId();
    const bundleId = String(req.query.bundleId ?? req.query.pack ?? "").trim();
    const toolIds = parseToolIds(req.query.tools ?? req.query.toolIds);
    const quote = await quoteForOrg(orgId, toolIds, bundleId || undefined);
    const payee = await getUpiPayee();
    const label = isBundleQuote(quote)
      ? `JustXSystems ${quote.packName}`.slice(0, 50)
      : `JustXSystems ${quote.lines.length} tool${quote.lines.length === 1 ? "" : "s"}`.slice(0, 50);
    res.json({
      ...quote,
      upi: {
        ...publicPayee(payee),
        amountInr: quote.totalInr,
        intent: payee.enabled && payee.vpa ? buildUpiIntent(payee, quote.totalInr, label) : null,
      },
    });
  } catch (err) {
    const status = Number((err as { status?: number }).status) || 400;
    res.status(status).json({ error: err instanceof Error ? err.message : "Could not quote cart" });
  }
});

router.post("/upi-claims", async (req, res) => {
  try {
    const bundleId = String(req.body?.bundleId ?? req.body?.packId ?? "").trim();
    const toolIds = parseToolIds(req.body?.toolIds ?? req.body?.tools);
    const quote = await quoteForOrg(getActiveOrgId(), toolIds, bundleId || undefined);
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
      planId: bundleId ? `pack:${bundleId}` : "cart",
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
    const bundleId = String(req.body?.bundleId ?? req.body?.packId ?? "").trim();
    const toolIds = parseToolIds(req.body?.toolIds ?? req.body?.tools);
    const quote = await quoteForOrg(getActiveOrgId(), toolIds, bundleId || undefined);
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
    const planId = bundleId ? `pack:${bundleId}` : "cart";
    const session = await provider.createCheckoutSession({
      profileId,
      planId,
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
      if (bundleId === "all_tools") {
        const { activateAllToolsPack } = await import("../lib/commerce.js");
        await activateAllToolsPack({
          orgId,
          source: "pack",
          externalRef: session.sessionId,
          periodEnd,
        });
      } else {
        await activateToolCommerce({
          orgId,
          toolIds: tools,
          source: bundleId ? "pack" : "card",
          externalRef: session.sessionId,
          periodEnd,
        });
      }
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
        planId,
        planName: isBundleQuote(quote)
          ? quote.packName
          : `${tools.length} tool license(s)`,
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

/**
 * Self-serve trial: one per tool per org after any commercial ledger row
 * (trial or paid). Cancelled licenses with no ledger row do not block.
 * Line items stay at ₹0 MRR until a paid activation updates the ledger.
 */
router.post("/trial", async (req, res) => {
  try {
    const orgId = getActiveOrgId();
    const profileId = getActiveProfileId();
    const toolIds = parseToolIds(req.body?.toolIds ?? req.body?.tools ?? req.body?.toolId);
    if (toolIds.length === 0) {
      res.status(400).json({ error: "Select at least one tool for trial" });
      return;
    }

    const [skus, licensed, trialConsumed] = await Promise.all([
      listToolSkus(),
      licensedToolIdSet(orgId),
      trialConsumedToolIdSet(orgId),
    ]);
    const byId = new Map(skus.map((s) => [s.toolId, s]));
    const eligible: string[] = [];
    const rejected: Array<{ toolId: string; reason: string }> = [];

    for (const toolId of toolIds) {
      const sku = byId.get(toolId);
      if (!sku || !sku.available) {
        rejected.push({ toolId, reason: "Tool is not available" });
        continue;
      }
      if (sku.includedFree || sku.priceInr <= 0) {
        rejected.push({ toolId, reason: "Included tools do not need a trial" });
        continue;
      }
      if (licensed.has(toolId)) {
        rejected.push({ toolId, reason: "Already licensed" });
        continue;
      }
      if (sku.trialDays <= 0) {
        rejected.push({ toolId, reason: "No trial configured for this tool" });
        continue;
      }
      if (trialConsumed.has(toolId)) {
        rejected.push({ toolId, reason: "Trial already used for this tool" });
        continue;
      }
      eligible.push(toolId);
    }

    if (eligible.length === 0) {
      res.status(400).json({
        error: rejected[0]?.reason ?? "No tools eligible for trial",
        rejected,
      });
      return;
    }

    const result = await activateToolCommerce({
      orgId,
      toolIds: eligible,
      source: "trial",
      preferTrial: true,
      externalRef: `trial:${profileId}:${Date.now()}`,
    });

    const subscription = await getSubscription(profileId);
    const [freshSkus, freshLicenses, freshConsumed, packs, items] = await Promise.all([
      listToolSkus(),
      listActiveLicenses(orgId),
      trialConsumedToolIdSet(orgId),
      listAvailableProductBundles(),
      listSubscriptionItems(orgId),
    ]);
    const licensedSet = new Set(freshLicenses.map((l) => l.toolId));

    res.json({
      granted: result.granted,
      periodEnd: result.periodEnd.toISOString(),
      rejected,
      subscription: {
        ...subscription,
        catalog: catalogPayload(freshSkus, licensedSet, freshConsumed),
        packs: packs.map(publicBundlePayload),
        licenses: freshLicenses,
        licensedToolIds: [...licensedSet],
        billingItems: items,
        mrrInr: items.reduce((sum, i) => sum + i.unitPriceInr, 0),
      },
    });
  } catch (err) {
    const status = Number((err as { status?: number }).status) || 400;
    res.status(status).json({ error: err instanceof Error ? err.message : "Could not start trial" });
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
