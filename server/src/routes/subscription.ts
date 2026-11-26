import { Router } from "express";
import { BRAND_DEFAULTS } from "@jbt/shared";
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
  listProfileEntitlements,
  paidNonExpiringToolIdSet,
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
  normalizeBillingCycle,
  periodEndForCycle,
  recommendPackForSelection,
  resolveUserCategory,
  type BillingCycle,
} from "../lib/pricing-engine.js";
import { isValidGstin, normalizeGstin } from "../lib/gstin.js";
import { getToolPersonalUsageMap } from "../lib/config/tool-personal-usage.js";
import {
  buildWorkspaceUsageTelemetry,
  fetchProfileRecordCounts,
} from "../lib/usage-summary.js";
import {
  countOrgPromoRedemptions,
  evaluatePromoCode,
  getPromoCode,
  listEligiblePublicPromos,
  normalizePromoCode,
  recordPromoRedemption,
} from "../lib/promo-codes.js";
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

async function fetchProfileCategoryMeta(profileId: number, orgId: number) {
  try {
    const [profileRows] = await pool.query(
      `SELECT gstin, business_name FROM business_profiles WHERE id = :id LIMIT 1`,
      { id: profileId },
    );
    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM business_profiles WHERE organization_id = :orgId`,
      { orgId },
    );
    const pRow = Array.isArray(profileRows)
      ? (profileRows[0] as { gstin?: string | null; business_name?: string | null } | undefined)
      : undefined;
    const cRow = Array.isArray(countRows)
      ? (countRows[0] as { cnt?: number } | undefined)
      : undefined;
    const rawGstin = normalizeGstin(pRow?.gstin);
    const hasGstin = isValidGstin(rawGstin);
    const branchCount = Math.max(1, Number(cRow?.cnt ?? 1) || 1);
    return {
      gstin: hasGstin ? rawGstin : null,
      hasGstin,
      branchCount,
      businessName: pRow?.business_name ? String(pRow.business_name) : null,
      userCategory: resolveUserCategory({ gstin: rawGstin, branchCount }),
    };
  } catch {
    return {
      gstin: null,
      hasGstin: false,
      branchCount: 1,
      businessName: null,
      userCategory: "business" as const,
    };
  }
}

async function quoteForProfile(
  profileId: number,
  toolIds: string[],
  bundleId?: string,
  billingCycle: BillingCycle = "month",
  orgId?: number,
): Promise<CartQuote | BundleCartQuote> {
  const blocked = await paidNonExpiringToolIdSet(profileId, orgId);
  if (bundleId) {
    return quoteBundleCart(bundleId, blocked, billingCycle);
  }
  return quoteToolCart(toolIds, blocked, billingCycle);
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
      listActiveLicenses(profileId),
      listSubscriptionItems(orgId),
      listAvailableProductBundles(),
      trialConsumedToolIdSet(profileId),
      listProfileEntitlements(profileId),
      fetchProfileRecordCounts(profileId),
      fetchProfileCategoryMeta(profileId, orgId),
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
    logRejected("listProfileEntitlements", 10);
    logRejected("fetchProfileRecordCounts", 11);
    logRejected("fetchProfileCategoryMeta", 12);

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
        : { enabled: false, vpa: "", payeeName: BRAND_DEFAULTS.legalName, merchantCode: "" };
    const claim = settled[3].status === "fulfilled" ? settled[3].value : null;
    const gateways = settled[4].status === "fulfilled" ? settled[4].value : [];
    const skus = settled[5].status === "fulfilled" ? settled[5].value : [];
    const licenses = settled[6].status === "fulfilled" ? settled[6].value : [];
    const items = settled[7].status === "fulfilled" ? settled[7].value : [];
    const packs = settled[8].status === "fulfilled" ? settled[8].value : [];
    const trialConsumed =
      settled[9].status === "fulfilled" ? settled[9].value : new Set<string>();
    const entitlements = settled[10].status === "fulfilled" ? settled[10].value : [];
    const recordCounts = settled[11].status === "fulfilled" ? settled[11].value : {};
    const profileMeta =
      settled[12].status === "fulfilled"
        ? settled[12].value
        : {
            gstin: null,
            hasGstin: false,
            branchCount: 1,
            businessName: null,
            userCategory: "business" as const,
          };

    if (settled[5].status === "rejected") {
      res.status(500).json({
        error:
          settled[5].reason instanceof Error
            ? settled[5].reason.message
            : "Could not load tool catalog",
      });
      return;
    }

    let personalUsageMap: Record<string, boolean> = {};
    try {
      personalUsageMap = await getToolPersonalUsageMap(skus.map((s) => s.toolId));
    } catch {
      /* fallback empty */
    }

    const usageTelemetry = buildWorkspaceUsageTelemetry({
      skus,
      licenses,
      entitlements,
      billingItems: items,
      recordCounts,
      freemiumRecordLimit: subscription.recordLimit ?? 28,
    });

    const licensed = new Set(licenses.map((l) => l.toolId));
    const pendingClaim =
      claim && (claim.status === "pending" || claim.status === "rejected")
        ? {
            id: claim.id,
            status: claim.status,
            utr: claim.utr,
            amountInr: claim.amountInr,
            billingCycle: claim.billingCycle,
            toolIds: claim.toolIds,
            createdAt: claim.createdAt,
            reviewNote: claim.reviewNote,
          }
        : null;

    res.json({
      ...subscription,
      provider: "upi",
      userCategory: profileMeta.userCategory,
      hasGstin: profileMeta.hasGstin,
      gstin: profileMeta.gstin,
      branchCount: profileMeta.branchCount,
      plans: plans.filter((p) => p.available).map(publicPlanPayload),
      catalog: catalogPayload(skus, licensed, trialConsumed, {
        personalUsageMap,
        usageByTool: usageTelemetry.byTool,
      }),
      packs: packs.map((p) => publicBundlePayload(p, { skus, personalUsageMap })),
      licenses,
      licensedToolIds: [...licensed],
      billingItems: items,
      mrrInr: items.reduce((sum, i) => sum + i.unitPriceInr * (i.quantity || 1), 0),
      usageSummary: usageTelemetry.summary,
      usageByTool: usageTelemetry.byTool,
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
              billingCycle: claim.billingCycle,
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

router.get("/history", async (_req, res) => {
  try {
    const orgId = getActiveOrgId();
    const profileId = getActiveProfileId();
    const [profileMeta, skus] = await Promise.all([
      fetchProfileCategoryMeta(profileId, orgId),
      listToolSkus(),
    ]);
    const nameById = new Map(skus.map((s) => [s.toolId, s.name]));

    const entries: Array<{
      id: string;
      kind: "upi_claim" | "gateway_txn";
      reference: string;
      status: string;
      amountInr: number;
      billingCycle: BillingCycle;
      provider: string;
      toolIds: string[];
      toolNames: string[];
      payerName: string | null;
      payerEmail: string | null;
      occurredAt: string;
      reviewNote: string | null;
    }> = [];

    const seenUtrs = new Set<string>();
    try {
      const [claimRows] = await pool.query(
        `SELECT id, utr, status, amount_inr, billing_cycle, tool_ids, payer_name, payer_email,
                review_note, created_at
         FROM upi_payment_claims
         WHERE organization_id = :orgId
         ORDER BY created_at DESC LIMIT 50`,
        { orgId },
      );
      for (const row of Array.isArray(claimRows) ? claimRows : []) {
        const r = row as Record<string, unknown>;
        const toolIds = parseToolIds(r.tool_ids);
        const ref = String(r.utr ?? "");
        if (ref) seenUtrs.add(ref.toUpperCase());
        entries.push({
          id: `upi:${r.id}`,
          kind: "upi_claim",
          reference: ref,
          status: String(r.status ?? "pending"),
          amountInr: Number(r.amount_inr ?? 0),
          billingCycle: normalizeBillingCycle(r.billing_cycle),
          provider: "upi",
          toolIds,
          toolNames: toolIds.map((id) => nameById.get(id) ?? id),
          payerName: r.payer_name ? String(r.payer_name) : null,
          payerEmail: r.payer_email ? String(r.payer_email) : null,
          occurredAt: String(r.created_at ?? ""),
          reviewNote: r.review_note ? String(r.review_note) : null,
        });
      }
    } catch {
      /* table may not exist yet */
    }

    try {
      const [txnRows] = await pool.query(
        `SELECT id, provider, external_id, type, status, amount_inr, occurred_at
         FROM payment_transactions
         WHERE organization_id = :orgId AND type = 'subscription_charge'
         ORDER BY occurred_at DESC LIMIT 50`,
        { orgId },
      );
      for (const row of Array.isArray(txnRows) ? txnRows : []) {
        const r = row as Record<string, unknown>;
        const ref = String(r.external_id ?? `TXN-${r.id}`);
        if (String(r.provider) === "upi" && seenUtrs.has(ref.toUpperCase())) continue;
        entries.push({
          id: `txn:${r.id}`,
          kind: "gateway_txn",
          reference: ref,
          status: String(r.status ?? "success"),
          amountInr: Number(r.amount_inr ?? 0),
          billingCycle: "month",
          provider: String(r.provider ?? "card"),
          toolIds: [],
          toolNames: [],
          payerName: null,
          payerEmail: null,
          occurredAt: String(r.occurred_at ?? ""),
          reviewNote: null,
        });
      }
    } catch {
      /* table may not exist yet */
    }

    entries.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
    res.json({
      entries: entries.slice(0, 50),
      account: {
        businessName: profileMeta.businessName,
        gstin: profileMeta.gstin,
        hasGstin: profileMeta.hasGstin,
        userCategory: profileMeta.userCategory,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Could not load billing history" });
  }
});

router.get("/quote", async (req, res) => {
  try {
    const profileId = getActiveProfileId();
    const orgId = getActiveOrgId();
    const bundleId = String(req.query.bundleId ?? req.query.pack ?? "").trim();
    const billingCycle = normalizeBillingCycle(req.query.cycle ?? req.query.billingCycle);
    const promoCodeRaw = normalizePromoCode(req.query.promo ?? req.query.promoCode);
    const toolIds = parseToolIds(req.query.tools ?? req.query.toolIds);
    const quote = await quoteForProfile(profileId, toolIds, bundleId || undefined, billingCycle, orgId);
    const [payee, skus, packs, blockedPaid, profileMeta] = await Promise.all([
      getUpiPayee(),
      listToolSkus(),
      listAvailableProductBundles(),
      paidNonExpiringToolIdSet(profileId, orgId),
      fetchProfileCategoryMeta(profileId, orgId),
    ]);
    let personalUsageMap: Record<string, boolean> = {};
    try {
      personalUsageMap = await getToolPersonalUsageMap(skus.map((s) => s.toolId));
    } catch {
      /* fallback */
    }
    const recommendedPack =
      !bundleId && toolIds.length > 0
        ? recommendPackForSelection({
            selectedToolIds: toolIds,
            licensedToolIds: blockedPaid,
            skus,
            packs,
            cycle: billingCycle,
            userCategory: profileMeta.userCategory,
            personalUsageMap,
          })
        : null;

    const subtotalInr = quote.totalInr;
    let finalTotalInr = subtotalInr;
    let promo: {
      code: string;
      description: string | null;
      discountInr: number;
      label: string;
    } | null = null;
    let promoError: string | null = null;

    if (promoCodeRaw) {
      const [promoRow, orgRedemptionsCount] = await Promise.all([
        getPromoCode(promoCodeRaw),
        countOrgPromoRedemptions(promoCodeRaw, orgId),
      ]);
      const evalRes = evaluatePromoCode(promoRow, {
        subtotalInr,
        userCategory: profileMeta.userCategory,
        billingCycle,
        orgRedemptionsCount,
      });
      if (evalRes.ok) {
        finalTotalInr = evalRes.finalTotalInr;
        promo = {
          code: evalRes.code,
          description: evalRes.description,
          discountInr: evalRes.discountInr,
          label: evalRes.label,
        };
      } else {
        promoError = evalRes.error;
      }
    }

    const availablePromos = await listEligiblePublicPromos({
      orgId,
      subtotalInr,
      userCategory: profileMeta.userCategory,
      billingCycle,
    });

    const cycleSuffix = billingCycle === "year" ? " (1Y)" : "";
    const label = isBundleQuote(quote)
      ? `${BRAND_DEFAULTS.appName} ${quote.packName}${cycleSuffix}`.slice(0, 50)
      : `${BRAND_DEFAULTS.appName} ${quote.lines.length} tool${quote.lines.length === 1 ? "" : "s"}${cycleSuffix}`.slice(0, 50);
    res.json({
      ...quote,
      subtotalInr,
      totalInr: finalTotalInr,
      promo,
      promoError,
      availablePromos,
      recommendedPack,
      upi: {
        ...publicPayee(payee),
        amountInr: finalTotalInr,
        intent: payee.enabled && payee.vpa ? buildUpiIntent(payee, finalTotalInr, label) : null,
      },
    });
  } catch (err) {
    const status = Number((err as { status?: number }).status) || 400;
    res.status(status).json({ error: err instanceof Error ? err.message : "Could not quote cart" });
  }
});

router.post("/upi-claims", async (req, res) => {
  try {
    const profileId = getActiveProfileId();
    const orgId = getActiveOrgId();
    const bundleId = String(req.body?.bundleId ?? req.body?.packId ?? "").trim();
    const billingCycle = normalizeBillingCycle(req.body?.billingCycle ?? req.body?.cycle);
    const promoCodeRaw = normalizePromoCode(req.body?.promoCode ?? req.body?.promo);
    const toolIds = parseToolIds(req.body?.toolIds ?? req.body?.tools);
    const quote = await quoteForProfile(
      profileId,
      toolIds,
      bundleId || undefined,
      billingCycle,
      orgId,
    );
    let finalTotalInr = quote.totalInr;
    let appliedPromoNote = "";
    let appliedPromoDiscount = 0;
    if (promoCodeRaw) {
      const [promoRow, profileMeta, orgRedemptionsCount] = await Promise.all([
        getPromoCode(promoCodeRaw),
        fetchProfileCategoryMeta(profileId, orgId),
        countOrgPromoRedemptions(promoCodeRaw, orgId),
      ]);
      const evalRes = evaluatePromoCode(promoRow, {
        subtotalInr: quote.totalInr,
        userCategory: profileMeta.userCategory,
        billingCycle,
        orgRedemptionsCount,
      });
      if (!evalRes.ok) {
        res.status(400).json({ error: evalRes.error });
        return;
      }
      finalTotalInr = evalRes.finalTotalInr;
      appliedPromoDiscount = evalRes.discountInr;
      appliedPromoNote = `[Promo ${evalRes.code}: -₹${evalRes.discountInr}]`;
    }
    const payerEmail = String(req.body?.payerEmail ?? "").trim();
    const payerName = String(req.body?.payerName ?? "").trim();
    const utr = String(req.body?.utr ?? "").trim();
    if (!payerEmail || !payerName || !utr) {
      res.status(400).json({ error: "Name, email, and UPI/UTR reference are required" });
      return;
    }
    const [orgRows] = await pool.query(`SELECT name FROM organizations WHERE id = :id`, {
      id: orgId,
    });
    const orgName = Array.isArray(orgRows)
      ? String((orgRows[0] as { name?: string } | undefined)?.name ?? "")
      : "";
    const rawNotes = req.body?.notes ? String(req.body.notes).trim() : "";
    const combinedNotes = [appliedPromoNote, rawNotes].filter(Boolean).join(" ") || null;
    const claim = await createClaim({
      orgId,
      userId: getActiveUserId(),
      profileId,
      planId: bundleId ? `pack:${bundleId}` : "cart",
      toolIds: quote.lines.map((l) => l.toolId),
      billingCycle,
      amountInr: finalTotalInr,
      payerName,
      payerEmail,
      payerPhone: req.body?.payerPhone ?? null,
      payerUpi: req.body?.payerUpi ?? null,
      utr,
      paidAt: req.body?.paidAt ?? null,
      notes: combinedNotes,
      orgName,
    });
    if (promoCodeRaw) {
      await recordPromoRedemption({
        code: promoCodeRaw,
        orgId,
        discountInr: appliedPromoDiscount,
        orderTotalInr: finalTotalInr,
        billingCycle,
      });
    }
    res.status(201).json({
      claim,
      message: `Submitted. ${BRAND_DEFAULTS.appName} will verify this UPI payment and notify you.`,
    });
  } catch (err) {
    const status = Number((err as { status?: number }).status) || 400;
    res.status(status).json({ error: err instanceof Error ? err.message : "Could not submit claim" });
  }
});

router.post("/checkout", async (req, res) => {
  try {
    const profileId = getActiveProfileId();
    const orgId = getActiveOrgId();
    const bundleId = String(req.body?.bundleId ?? req.body?.packId ?? "").trim();
    const billingCycle = normalizeBillingCycle(req.body?.billingCycle ?? req.body?.cycle);
    const promoCodeRaw = normalizePromoCode(req.body?.promoCode ?? req.body?.promo);
    const toolIds = parseToolIds(req.body?.toolIds ?? req.body?.tools);
    const quote = await quoteForProfile(
      profileId,
      toolIds,
      bundleId || undefined,
      billingCycle,
      orgId,
    );
    let finalTotalInr = quote.totalInr;
    let appliedPromoDiscount = 0;
    if (promoCodeRaw) {
      const [promoRow, profileMeta, orgRedemptionsCount] = await Promise.all([
        getPromoCode(promoCodeRaw),
        fetchProfileCategoryMeta(profileId, orgId),
        countOrgPromoRedemptions(promoCodeRaw, orgId),
      ]);
      const evalRes = evaluatePromoCode(promoRow, {
        subtotalInr: quote.totalInr,
        userCategory: profileMeta.userCategory,
        billingCycle,
        orgRedemptionsCount,
      });
      if (!evalRes.ok) {
        res.status(400).json({ error: evalRes.error });
        return;
      }
      finalTotalInr = evalRes.finalTotalInr;
      appliedPromoDiscount = evalRes.discountInr;
    }
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
      amountInr: finalTotalInr,
      toolIds: quote.lines.map((l) => l.toolId),
    });

    await createCheckoutIntent({
      orgId,
      profileId,
      sessionId: session.sessionId,
      toolIds: quote.lines.map((l) => l.toolId),
      amountInr: finalTotalInr,
      provider: provider.name,
      billingCycle,
    });
    if (promoCodeRaw) {
      await recordPromoRedemption({
        code: promoCodeRaw,
        orgId,
        discountInr: appliedPromoDiscount,
        orderTotalInr: finalTotalInr,
        billingCycle,
      });
    }

    const autoComplete = process.env.PAYMENT_AUTO_COMPLETE === "true";
    if (autoComplete && provider.name === "mock") {
      const periodEnd = periodEndForCycle(billingCycle);
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
          profileId,
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
        finalTotalInr,
        provider.name,
        session.sessionId,
      );
      notifyPaymentOutcome({
        organizationId: orgId,
        success: true,
        amountInr: finalTotalInr,
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
        quote: { ...quote, totalInr: finalTotalInr },
      });
      return;
    }

    notifyCheckoutStarted({
      organizationId: orgId,
      amountInr: finalTotalInr,
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
      licensedToolIdSet(profileId),
      trialConsumedToolIdSet(profileId),
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
      profileId,
      orgId,
      toolIds: eligible,
      source: "trial",
      preferTrial: true,
      externalRef: `trial:${profileId}:${Date.now()}`,
    });

    const subscription = await getSubscription(profileId);
    const [freshSkus, freshLicenses, freshConsumed, packs, items, entitlements, recordCounts, profileMeta] =
      await Promise.all([
        listToolSkus(),
        listActiveLicenses(profileId),
        trialConsumedToolIdSet(profileId),
        listAvailableProductBundles(),
        listSubscriptionItems(orgId),
        listProfileEntitlements(profileId),
        fetchProfileRecordCounts(profileId),
        fetchProfileCategoryMeta(profileId, orgId),
      ]);
    let personalUsageMap: Record<string, boolean> = {};
    try {
      personalUsageMap = await getToolPersonalUsageMap(freshSkus.map((s) => s.toolId));
    } catch {
      /* fallback */
    }
    const usageTelemetry = buildWorkspaceUsageTelemetry({
      skus: freshSkus,
      licenses: freshLicenses,
      entitlements,
      billingItems: items,
      recordCounts,
      freemiumRecordLimit: subscription.recordLimit ?? 28,
    });
    const licensedSet = new Set(freshLicenses.map((l) => l.toolId));

    res.json({
      granted: result.granted,
      periodEnd: result.periodEnd.toISOString(),
      rejected,
      subscription: {
        ...subscription,
        userCategory: profileMeta.userCategory,
        hasGstin: profileMeta.hasGstin,
        gstin: profileMeta.gstin,
        branchCount: profileMeta.branchCount,
        catalog: catalogPayload(freshSkus, licensedSet, freshConsumed, {
          personalUsageMap,
          usageByTool: usageTelemetry.byTool,
        }),
        packs: packs.map((p) => publicBundlePayload(p, { skus: freshSkus, personalUsageMap })),
        licenses: freshLicenses,
        licensedToolIds: [...licensedSet],
        billingItems: items,
        mrrInr: items.reduce((sum, i) => sum + i.unitPriceInr * (i.quantity || 1), 0),
        usageSummary: usageTelemetry.summary,
        usageByTool: usageTelemetry.byTool,
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
    await deactivateToolCommerce({ profileId, orgId, toolIds });
    res.json(await getSubscription(profileId));
    return;
  }
  await deactivateToolCommerce({ profileId, orgId });
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
