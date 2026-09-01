import type {
  CheckoutSession,
  PaymentProvider,
  PaymentWebhookEvent,
} from "./types.js";

export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";

  async createCheckoutSession(input: {
    profileId: number;
    planId: string;
    amountInr: number;
    toolIds?: string[];
  }): Promise<CheckoutSession> {
    const sessionId = `mock_${input.profileId}_${Date.now()}`;
    return {
      sessionId,
      checkoutUrl: null,
      provider: this.name,
    };
  }

  verifyWebhook(
    headers: Record<string, string | string[] | undefined>,
    _body: unknown,
  ): boolean {
    const secret = process.env.PAYMENT_WEBHOOK_SECRET ?? "dev-webhook-secret";
    const header = headers["x-webhook-secret"];
    const value = Array.isArray(header) ? header[0] : header;
    return value === secret;
  }

  parseWebhookEvent(body: unknown): PaymentWebhookEvent | null {
    if (!body || typeof body !== "object") return null;
    const payload = body as Record<string, unknown>;
    const type = payload.type;
    if (type !== "subscription.activated" && type !== "subscription.cancelled") {
      return null;
    }
    const profileId = Number(payload.profileId);
    if (!profileId) return null;
    const planId = String(payload.planId ?? "pro");
    const externalSubscriptionId = String(payload.sessionId ?? payload.externalSubscriptionId ?? "");
    if (!externalSubscriptionId) return null;
    const periodEndRaw = payload.periodEnd;
    const periodEnd =
      periodEndRaw ? new Date(String(periodEndRaw)) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const toolIds = Array.isArray(payload.toolIds) ? payload.toolIds.map(String) : undefined;
    return {
      type,
      profileId,
      planId,
      externalSubscriptionId,
      externalCustomerId: payload.externalCustomerId
        ? String(payload.externalCustomerId)
        : undefined,
      periodEnd,
      toolIds,
      amountInr: payload.amountInr != null ? Number(payload.amountInr) : undefined,
    };
  }
}
