import crypto from "node:crypto";
import type {
  CheckoutSession,
  PaymentProvider,
  PaymentWebhookEvent,
} from "./types.js";

type RazorpayOrder = {
  id: string;
  short_url?: string;
};

/**
 * Razorpay payment provider — uses Orders API for checkout links.
 * Configure: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET
 */
export class RazorpayPaymentProvider implements PaymentProvider {
  readonly name = "razorpay";

  private getKeyId(): string {
    const key = process.env.RAZORPAY_KEY_ID;
    if (!key) throw new Error("RAZORPAY_KEY_ID is not configured");
    return key;
  }

  private getKeySecret(): string {
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) throw new Error("RAZORPAY_KEY_SECRET is not configured");
    return secret;
  }

  private authHeader(): string {
    const token = Buffer.from(`${this.getKeyId()}:${this.getKeySecret()}`).toString("base64");
    return `Basic ${token}`;
  }

  async createCheckoutSession(input: {
    profileId: number;
    planId: string;
    amountInr: number;
  }): Promise<CheckoutSession> {
    const amountPaise = Math.round(input.amountInr * 100);
    const receipt = `jbt_pro_${input.profileId}_${Date.now()}`;

    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: this.authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: "INR",
        receipt,
        notes: { profileId: String(input.profileId), planId: input.planId },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Razorpay order failed: ${errText}`);
    }

    const order = (await res.json()) as RazorpayOrder;
    const webOrigin = process.env.CORS_ORIGIN ?? "http://localhost:3000";
    const checkoutUrl = order.short_url ?? `${webOrigin}/subscription?order=${order.id}`;

    return {
      sessionId: order.id,
      checkoutUrl,
      provider: this.name,
    };
  }

  verifyWebhook(
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
  ): boolean {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) return false;

    const signature = headers["x-razorpay-signature"];
    const sig = Array.isArray(signature) ? signature[0] : signature;
    if (!sig) return false;

    const payload = typeof body === "string" ? body : JSON.stringify(body);
    const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    return expected === sig;
  }

  parseWebhookEvent(body: unknown): PaymentWebhookEvent | null {
    if (!body || typeof body !== "object") return null;
    const root = body as Record<string, unknown>;
    const event = String(root.event ?? "");

    if (event === "subscription.activated" || event === "payment.captured") {
      const payload = (root.payload as Record<string, unknown>) ?? {};
      const entity =
        (payload.payment as { entity?: Record<string, unknown> })?.entity ??
        (payload.subscription as { entity?: Record<string, unknown> })?.entity ??
        {};

      const notes = (entity.notes as Record<string, string>) ?? {};
      const profileId = Number(notes.profileId);
      if (!profileId) return null;

      const externalId = String(entity.id ?? entity.order_id ?? "");
      if (!externalId) return null;

      return {
        type: "subscription.activated",
        profileId,
        planId: String(notes.planId ?? "pro"),
        externalSubscriptionId: externalId,
        externalCustomerId: entity.customer_id ? String(entity.customer_id) : undefined,
        periodEnd: new Date(Date.now() + 30 * 86400000),
      };
    }

    if (event === "subscription.cancelled" || event === "subscription.paused") {
      const payload = (root.payload as Record<string, unknown>) ?? {};
      const entity = (payload.subscription as { entity?: Record<string, unknown> })?.entity ?? {};
      const notes = (entity.notes as Record<string, string>) ?? {};
      const profileId = Number(notes.profileId);
      if (!profileId) return null;
      return {
        type: "subscription.cancelled",
        profileId,
        planId: "free",
        externalSubscriptionId: String(entity.id ?? ""),
      };
    }

    if (event === "payment.failed") {
      const payload = (root.payload as Record<string, unknown>) ?? {};
      const entity = (payload.payment as { entity?: Record<string, unknown> })?.entity ?? {};
      const notes = (entity.notes as Record<string, string>) ?? {};
      const profileId = Number(notes.profileId);
      if (!profileId) return null;
      return {
        type: "payment.failed",
        profileId,
        planId: String(notes.planId ?? "pro"),
        externalSubscriptionId: String(entity.order_id ?? entity.id ?? ""),
        errorCode: String(entity.error_code ?? "payment_failed"),
        errorMessage: String(entity.error_description ?? "Payment failed"),
      };
    }

    return null;
  }
}
