import crypto from "node:crypto";
import type {
  CheckoutSession,
  PaymentProvider,
  PaymentWebhookEvent,
} from "./types.js";

/**
 * Stripe Checkout Session provider (card).
 * Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
 */
export class StripePaymentProvider implements PaymentProvider {
  readonly name = "stripe";

  private secret(): string {
    const key = process.env.STRIPE_SECRET_KEY?.trim();
    if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
    return key;
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
    const success = `${webOrigin}${basePath}/subscription?paid=1&session_id={CHECKOUT_SESSION_ID}`;
    const cancel = `${webOrigin}${basePath}/subscription?cancelled=1`;
    const amountPaise = Math.round(input.amountInr * 100);
    const body = new URLSearchParams();
    body.set("mode", "payment");
    body.set("success_url", success);
    body.set("cancel_url", cancel);
    body.set("line_items[0][price_data][currency]", "inr");
    body.set("line_items[0][price_data][product_data][name]", `JustX ${input.planId}`);
    body.set("line_items[0][price_data][unit_amount]", String(amountPaise));
    body.set("line_items[0][quantity]", "1");
    body.set("metadata[profileId]", String(input.profileId));
    body.set("metadata[planId]", input.planId);
    body.set("metadata[toolIds]", (input.toolIds ?? []).join(","));
    body.set("client_reference_id", `jbt_${input.profileId}_${Date.now()}`);

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secret()}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!res.ok) {
      throw new Error(`Stripe checkout failed: ${(await res.text()).slice(0, 300)}`);
    }
    const session = (await res.json()) as { id: string; url?: string };
    return {
      sessionId: session.id,
      checkoutUrl: session.url ?? null,
      provider: this.name,
    };
  }

  verifyWebhook(
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
  ): boolean {
    const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
    if (!secret) return false;
    const sigHeader = headers["stripe-signature"];
    const header = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
    if (!header) return false;
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    const parts = Object.fromEntries(
      header.split(",").map((p) => {
        const [k, ...rest] = p.split("=");
        return [k?.trim(), rest.join("=")];
      }),
    );
    const timestamp = parts.t;
    const v1 = parts.v1;
    if (!timestamp || !v1) return false;
    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${timestamp}.${raw}`)
      .digest("hex");
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
    } catch {
      return false;
    }
  }

  parseWebhookEvent(body: unknown): PaymentWebhookEvent | null {
    if (!body || typeof body !== "object") return null;
    const root = body as Record<string, unknown>;
    const type = String(root.type ?? "");
    const data = (root.data as { object?: Record<string, unknown> })?.object ?? {};
    const meta = (data.metadata as Record<string, string>) ?? {};
    const profileId = Number(meta.profileId);
    if (!profileId) return null;

    if (type === "checkout.session.completed" || type === "payment_intent.succeeded") {
      return {
        type: "subscription.activated",
        profileId,
        planId: String(meta.planId ?? "pro"),
        externalSubscriptionId: String(data.id ?? ""),
        periodEnd: new Date(Date.now() + 30 * 86400000),
        toolIds: meta.toolIds
          ? String(meta.toolIds)
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
        amountInr:
          data.amount_total != null ? Number(data.amount_total) / 100 : undefined,
      };
    }
    if (type === "checkout.session.expired" || type === "payment_intent.payment_failed") {
      return {
        type: "payment.failed",
        profileId,
        planId: String(meta.planId ?? "pro"),
        externalSubscriptionId: String(data.id ?? ""),
        errorCode: "stripe_failed",
        errorMessage: "Stripe payment failed or expired",
      };
    }
    return null;
  }
}
