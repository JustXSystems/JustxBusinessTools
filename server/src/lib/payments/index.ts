import { RazorpayPaymentProvider } from "./razorpay-provider.js";
import { MockPaymentProvider } from "./mock-provider.js";
import type { PaymentProvider } from "./types.js";

const providers: Record<string, PaymentProvider> = {
  mock: new MockPaymentProvider(),
};

function registerRazorpayIfConfigured(): void {
  if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    providers.razorpay = new RazorpayPaymentProvider();
  }
}

registerRazorpayIfConfigured();

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
