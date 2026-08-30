export type AccessMode = "limited" | "unlimited";

export type SubscriptionPlan = {
  id: string;
  name: string;
  tagline?: string | null;
  description?: string | null;
  recordLimit: number | null;
  priceInr: number;
  billingInterval?: string;
  accessMode: AccessMode;
  features: string[];
};

export type ToolCatalogSku = {
  toolId: string;
  name: string;
  category: string;
  priceInr: number;
  billingInterval: string;
  includedFree: boolean;
  licensed: boolean;
};

export type ToolLicense = {
  toolId: string;
  name: string;
  status: string;
  periodEnd: string | null;
};

export type CartQuote = {
  lines: Array<{
    toolId: string;
    name: string;
    category: string;
    priceInr: number;
    billingInterval: string;
  }>;
  totalInr: number;
  billingInterval: string;
  upi?: UpiPayInfo;
};

export type UpiPayInfo = {
  enabled: boolean;
  vpa: string;
  payeeName: string;
  amountInr: number;
  intent: string | null;
};

export type PendingUpiClaim = {
  id: number;
  status: "pending" | "rejected" | "approved" | string;
  utr: string;
  amountInr: number;
  toolIds?: string[];
  createdAt: string;
  reviewNote: string | null;
};

export type PayGatewayOption = {
  id: number;
  provider: string;
  displayName: string;
  mode: string;
  methods?: string[];
};

export type SubscriptionInfo = {
  businessProfileId: number;
  planId: string;
  planName?: string;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  paymentProvider: string | null;
  recordLimit: number | null;
  accessMode: AccessMode;
  isUnlimited: boolean;
  isPro: boolean;
  provider: string;
  plans: SubscriptionPlan[];
  catalog?: ToolCatalogSku[];
  licenses?: ToolLicense[];
  licensedToolIds?: string[];
  upi?: UpiPayInfo;
  /** Only pending / rejected — never approved (approved clears the review banner). */
  pendingClaim?: PendingUpiClaim | null;
  /** Latest claim regardless of status (debug / status strip). */
  latestClaim?: PendingUpiClaim | null;
  gateways?: PayGatewayOption[];
  serverTime?: string;
};

export type CheckoutResult = {
  sessionId: string;
  checkoutUrl: string | null;
  activated: boolean;
  subscription?: SubscriptionInfo;
  message?: string;
};

export type UpiClaimResult = {
  claim: { id: number; status: string; utr: string };
  message: string;
};
