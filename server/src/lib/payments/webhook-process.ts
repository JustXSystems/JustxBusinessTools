import { pool } from "../../db.js";
import { getPaymentProvider } from "./index.js";
import { recordSaasTransaction } from "./saas.js";
import { getOrganizationIdForProfile } from "./org-subscription.js";
import { activatePaidSubscription, cancelSubscription } from "../subscription.js";
import {
  activateToolCommerceForProfile,
} from "../commerce.js";
import { completeCheckoutIntent } from "../subscription-items.js";
import {
  notifyPaymentOutcome,
  notifySubscriptionActivated,
  notifySubscriptionCancelled,
} from "../notification-billing.js";

const PRO_PRICE_INR = Number(process.env.SUBSCRIPTION_PRO_PRICE_INR ?? 499);

export type ProcessedWebhook = {
  received: boolean;
  type?: string;
  profileId?: number;
  provider: string;
};

export async function logGatewayWebhookEvent(input: {
  provider: string;
  eventType: string;
  message: string;
  payload: unknown;
  organizationId?: number | null;
}): Promise<number | null> {
  try {
    const [gwRows] = await pool.query(
      `SELECT id FROM payment_gateways
       WHERE LOWER(provider) = LOWER(:provider)
         AND (:orgId IS NULL OR organization_id = :orgId)
       ORDER BY enabled DESC, id ASC
       LIMIT 1`,
      { provider: input.provider, orgId: input.organizationId ?? null },
    );
    const gw = Array.isArray(gwRows) ? (gwRows[0] as { id: number } | undefined) : undefined;
    if (!gw) return null;
    const [result] = await pool.query(
      `INSERT INTO gateway_events (gateway_id, event_type, message, payload)
       VALUES (:id, :type, :message, :payload)`,
      {
        id: Number(gw.id),
        type: input.eventType,
        message: input.message.slice(0, 250),
        payload: JSON.stringify(input.payload ?? {}),
      },
    );
    return Number((result as { insertId: number }).insertId);
  } catch {
    return null;
  }
}

/** Apply a parsed provider webhook event (activate / cancel / fail). */
export async function applyWebhookEvent(
  providerName: string,
  body: unknown,
  opts?: { skipVerify?: boolean; skipLog?: boolean; headers?: Record<string, unknown> },
): Promise<ProcessedWebhook> {
  const provider = getPaymentProvider(providerName);

  if (!opts?.skipVerify && provider.verifyWebhook) {
    const headers = (opts?.headers ?? {}) as Record<string, string | string[] | undefined>;
    if (!provider.verifyWebhook(headers, body)) {
      const err = new Error("Invalid webhook signature");
      (err as Error & { status: number }).status = 401;
      throw err;
    }
  }

  const event = provider.parseWebhookEvent(body);
  if (!event) {
    const err = new Error("Unrecognized webhook payload");
    (err as Error & { status: number }).status = 400;
    throw err;
  }

  const orgId = await getOrganizationIdForProfile(event.profileId);

  if (event.type === "subscription.activated") {
    const intent = await completeCheckoutIntent(event.externalSubscriptionId);
    const toolIds =
      (event.toolIds && event.toolIds.length > 0 ? event.toolIds : null) ??
      (intent?.toolIds && intent.toolIds.length > 0 ? intent.toolIds : null);
    const amountInr = event.amountInr ?? intent?.amountInr ?? PRO_PRICE_INR;
    const periodEnd = event.periodEnd ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    if (toolIds && toolIds.length > 0) {
      await activateToolCommerceForProfile({
        profileId: event.profileId,
        toolIds,
        source: "webhook",
        externalRef: event.externalSubscriptionId,
        periodEnd,
      });
    } else if (event.planId === "pro" || event.planId === "unlimited") {
      // Activates All Tools Pack plan + per-tool licenses.
      await activatePaidSubscription(
        event.profileId,
        provider.name,
        event.externalSubscriptionId,
        event.externalCustomerId,
        periodEnd,
        "pro",
      );
    }

    if (orgId) {
      await recordSaasTransaction(
        orgId,
        "subscription_charge",
        "success",
        amountInr,
        provider.name,
        event.externalSubscriptionId,
      );
      notifySubscriptionActivated({
        organizationId: orgId,
        profileId: event.profileId,
        planId: event.planId ?? (toolIds ? "cart" : "pro"),
        planName: toolIds ? `${toolIds.length} tool license(s)` : undefined,
        provider: provider.name,
      });
      notifyPaymentOutcome({
        organizationId: orgId,
        success: true,
        amountInr,
        provider: provider.name,
        reference: event.externalSubscriptionId,
      });
    }
  } else if (event.type === "subscription.cancelled") {
    await cancelSubscription(event.profileId, provider.name, event.externalSubscriptionId);
    if (orgId) {
      await recordSaasTransaction(
        orgId,
        "subscription_cancel",
        "success",
        0,
        provider.name,
        event.externalSubscriptionId,
      );
      notifySubscriptionCancelled({
        organizationId: orgId,
        profileId: event.profileId,
        provider: provider.name,
      });
    }
  } else if (event.type === "payment.failed" && orgId) {
    await recordSaasTransaction(
      orgId,
      "subscription_charge",
      "failed",
      event.amountInr ?? PRO_PRICE_INR,
      provider.name,
      event.externalSubscriptionId,
      event.errorCode,
      event.errorMessage,
    );
    notifyPaymentOutcome({
      organizationId: orgId,
      success: false,
      amountInr: event.amountInr ?? PRO_PRICE_INR,
      provider: provider.name,
      reference: event.externalSubscriptionId,
      errorMessage: event.errorMessage ?? event.errorCode ?? null,
    });
  }

  if (!opts?.skipLog) {
    await logGatewayWebhookEvent({
      provider: providerName,
      eventType: `webhook.${event.type}`,
      message: `Processed ${event.type} for profile ${event.profileId}`,
      payload: body,
      organizationId: orgId,
    });
    if (orgId) {
      const { publishNotificationAsync } = await import("../notification-publish.js");
      publishNotificationAsync({
        eventType: "admin.gateway_event",
        title: `Payment gateway · ${event.type}`,
        body: `${providerName} processed ${event.type} for profile ${event.profileId}.`,
        organizationId: orgId,
        businessProfileId: event.profileId,
        href: "/admin/payments",
        entityType: "gateway_event",
        entityId: event.externalSubscriptionId || String(event.profileId),
        dedupeKey: `gw:${providerName}:${event.type}:${event.externalSubscriptionId || event.profileId}`,
        expiresInHours: 168,
      });
    }
  }

  return {
    received: true,
    type: event.type,
    profileId: event.profileId,
    provider: provider.name,
  };
}
