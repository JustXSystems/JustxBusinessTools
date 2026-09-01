export type PaymentPlanId = string;

export type CheckoutSession = {
  sessionId: string;
  checkoutUrl: string | null;
  provider: string;
};

export type PaymentWebhookEvent = {
  type: "subscription.activated" | "subscription.cancelled" | "payment.failed";
  profileId: number;
  planId: PaymentPlanId | "free";
  externalSubscriptionId: string;
  externalCustomerId?: string;
  periodEnd?: Date;
  toolIds?: string[];
  amountInr?: number;
  errorCode?: string;
  errorMessage?: string;
};

export interface PaymentProvider {
  readonly name: string;
  createCheckoutSession(input: {
    profileId: number;
    planId: PaymentPlanId;
    amountInr: number;
    toolIds?: string[];
  }): Promise<CheckoutSession>;
  verifyWebhook?(headers: Record<string, string | string[] | undefined>, body: unknown): boolean;
  parseWebhookEvent(body: unknown): PaymentWebhookEvent | null;
}
