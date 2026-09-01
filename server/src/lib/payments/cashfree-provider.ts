import crypto from "node:crypto";
import type {
  CheckoutSession,
  PaymentProvider,
  PaymentWebhookEvent,
} from "./types.js";

/**
 * Cashfree Payment Gateway (hosted checkout).
 * Env: CASHFREE_APP_ID, CASHFREE_SECRET_KEY, CASHFREE_ENV=sandbox|production
 * Optional: CASHFREE_WEBHOOK_SECRET
 */
export class CashfreePaymentProvider implements PaymentProvider {
  readonly name = "cashfree";

  private baseUrl(): string {
    const env = (process.env.CASHFREE_ENV ?? "production").toLowerCase();
    return env === "sandbox"
      ? "https://sandbox.cashfree.com/pg"
      : "https://api.cashfree.com/pg";
  }

  private headers(): Record<string, string> {
    const appId = process.env.CASHFREE_APP_ID?.trim();
    const secret = process.env.CASHFREE_SECRET_KEY?.trim();
    if (!appId || !secret) throw new Error("CASHFREE_APP_ID / CASHFREE_SECRET_KEY required");
    return {
      "Content-Type": "application/json",
      "x-api-version": "2023-08-01",
      "x-client-id": appId,
      "x-client-secret": secret,
    };
  }

  async createCheckoutSession(input: {
    profileId: number;
    planId: string;
    amountInr: number;
    toolIds?: string[];
  }): Promise<CheckoutSession> {
    const webOrigin = process.env.CORS_ORIGIN ?? "http://localhost:3000";
    const basePath = (process.env.WEB_BASE_PATH ?? process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(
      /\/$/,
      "",
    );
    const orderId = `jbt_${input.profileId}_${Date.now()}`;
    const res = await fetch(`${this.baseUrl()}/orders`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        order_id: orderId,
        order_amount: Number(input.amountInr.toFixed(2)),
        order_currency: "INR",
        customer_details: {
          customer_id: `profile_${input.profileId}`,
          customer_phone: "9999999999",
        },
        order_meta: {
          return_url: `${webOrigin}${basePath}/subscription?order=${orderId}`,
        },
        order_note: JSON.stringify({
          profileId: input.profileId,
          planId: input.planId,
          toolIds: input.toolIds ?? [],
        }),
      }),
    });
    if (!res.ok) {
      throw new Error(`Cashfree order failed: ${(await res.text()).slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      order_id?: string;
      payment_session_id?: string;
      payments?: { url?: string };
    };
    const checkoutUrl =
      data.payments?.url ??
      (data.payment_session_id
        ? `${webOrigin}${basePath}/subscription?cf_session=${data.payment_session_id}`
        : null);
    return {
      sessionId: String(data.order_id ?? orderId),
      checkoutUrl,
      provider: this.name,
    };
  }

  verifyWebhook(
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
  ): boolean {
    const secret = process.env.CASHFREE_WEBHOOK_SECRET?.trim();
    if (!secret) {
      // If no secret configured, reject in production-ish setups; allow only when explicitly empty skip.
      return process.env.CASHFREE_WEBHOOK_INSECURE === "true";
    }
    const sigHeader = headers["x-webhook-signature"] ?? headers["x-cashfree-signature"];
    const sig = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
    if (!sig) return false;
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    const expected = crypto.createHmac("sha256", secret).update(raw).digest("base64");
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
    } catch {
      return expected === sig;
    }
  }

  parseWebhookEvent(body: unknown): PaymentWebhookEvent | null {
    if (!body || typeof body !== "object") return null;
    const root = body as Record<string, unknown>;
    const type = String(root.type ?? root.event ?? "");
    const data = (root.data as Record<string, unknown>) ?? root;
    const order = (data.order as Record<string, unknown>) ?? data;
    let note: Record<string, unknown> = {};
    try {
      note = JSON.parse(String(order.order_note ?? "{}")) as Record<string, unknown>;
    } catch {
      note = {};
    }
    const profileId = Number(note.profileId);
    if (!profileId) return null;
    const orderId = String(order.order_id ?? order.cf_order_id ?? "");

    if (/PAYMENT_SUCCESS|ORDER_PAID|payment\.success/i.test(type) || order.order_status === "PAID") {
      return {
        type: "subscription.activated",
        profileId,
        planId: String(note.planId ?? "pro"),
        externalSubscriptionId: orderId,
        periodEnd: new Date(Date.now() + 30 * 86400000),
        toolIds: Array.isArray(note.toolIds) ? note.toolIds.map(String) : undefined,
        amountInr: order.order_amount != null ? Number(order.order_amount) : undefined,
      };
    }
    if (/PAYMENT_FAILED|payment\.failed/i.test(type)) {
      return {
        type: "payment.failed",
        profileId,
        planId: String(note.planId ?? "pro"),
        externalSubscriptionId: orderId,
        errorCode: "cashfree_failed",
        errorMessage: "Cashfree payment failed",
      };
    }
    return null;
  }
}
