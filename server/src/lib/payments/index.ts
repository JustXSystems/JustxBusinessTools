import { RazorpayPaymentProvider } from "./razorpay-provider.js";
import { MockPaymentProvider } from "./mock-provider.js";
import { StripePaymentProvider } from "./stripe-provider.js";
import { CashfreePaymentProvider } from "./cashfree-provider.js";
import type { PaymentProvider } from "./types.js";

const providers: Record<string, PaymentProvider> = {
  mock: new MockPaymentProvider(),
};

function registerConfiguredProviders(): void {
  if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    providers.razorpay = new RazorpayPaymentProvider();
  }
  if (process.env.STRIPE_SECRET_KEY) {
    providers.stripe = new StripePaymentProvider();
  }
  if (process.env.CASHFREE_APP_ID && process.env.CASHFREE_SECRET_KEY) {
    providers.cashfree = new CashfreePaymentProvider();
  }
}

registerConfiguredProviders();

export function getPaymentProvider(name?: string): PaymentProvider {
  const key = name ?? process.env.PAYMENT_PROVIDER ?? "mock";
  const provider = providers[key];
  if (!provider) {
    throw new Error(`Unknown payment provider: ${key}`);
  }
  return provider;
}

export function getConfiguredProviderName(): string {
  return process.env.PAYMENT_PROVIDER ?? "mock";
}

export function listPaymentProviders(): string[] {
  return Object.keys(providers);
}
