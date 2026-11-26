export type AccessMode = "limited" | "unlimited";
export type BillingCycle = "month" | "year";
export type UserCategory = "individual" | "business" | "enterprise";

export type ToolUsageStatus =
  | "included"
  | "licensed"
  | "trial"
  | "expiring_soon"
  | "near_limit"
  | "at_limit"
  | "hard_locked"
  | "freemium";

export type ToolUsageTelemetry = {
  toolId: string;
  recordCount: number;
  limit: number | null;
  utilizationPct: number | null;
  nearLimit: boolean;
  atLimit: boolean;
  status: ToolUsageStatus;
  isTrial: boolean;
  daysLeft: number | null;
  periodEnd: string | null;
};

export type WorkspaceUsageSummary = {
  totalRecords: number;
  activeToolsUsed: number;
  licensedCount: number;
  trialCount: number;
  trialsExpiringSoon: number;
  licensesExpiringSoon: number;
  toolsNearLimit: number;
  toolsAtLimit: number;
  hardLockedCount: number;
};

export type PackRecommendation = {
  packId: string;
  packName: string;
  packPriceInr: number;
  cartPriceInr: number;
  savingsInr: number;
  extraToolCount: number;
  extraToolIds: string[];
  reason: "cheaper" | "more_value";
  billingCycle: BillingCycle;
};

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
  tagline?: string | null;
  priceInr: number;
  annualPriceInr?: number | null;
  resolvedAnnualPriceInr?: number;
  annualSavingsInr?: number;
  annualSavingsPct?: number;
  billingInterval: string;
  includedFree: boolean;
  accessPolicy?: "soft_cap" | "hard_lock";
  featured?: boolean;
  trialDays?: number;
  licensed: boolean;
  /** True when actively trialing or expiring within 7 days — eligible for paid conversion / early renewal. */
  canConvertOrRenew?: boolean;
  /** True when SKU has trialDays and this org has never held a license row for the tool. */
  trialEligible?: boolean;
  /** True when tool is enabled for Personal (no-GSTIN) accounts. */
  personalUsage?: boolean;
  /** Live usage & license telemetry for this tool on the active profile. */
  usage?: ToolUsageTelemetry;
};

export type ProductPack = {
  id: string;
  name: string;
  tagline?: string | null;
  description?: string | null;
  discountPct: number;
  listPriceInr: number;
  priceInr: number;
  annualListPriceInr?: number;
  annualPriceInr?: number;
  annualSavingsInr?: number;
  highlighted?: boolean;
  toolIds: string[];
  toolCount: number;
  savingsInr: number;
  personalCompatible?: boolean;
  personalToolCount?: number;
};

export type ToolLicense = {
  toolId: string;
  name: string;
  status: string;
  periodEnd: string | null;
  recordLimitOverride?: number | null;
  businessProfileId?: number;
};

export type BillingItem = {
  toolId: string;
  name: string;
  unitPriceInr: number;
  /** Seats = business profiles licensed for this tool */
  quantity?: number;
  status: string;
  source: string | null;
  externalRef: string | null;
  periodEnd: string | null;
};

export type CartQuote = {
  lines: Array<{
    toolId: string;
    name: string;
    category: string;
    priceInr: number;
    monthlyPriceInr?: number;
    annualSavingsInr?: number;
    billingInterval: string;
  }>;
  totalInr: number;
  billingInterval: string;
  billingCycle?: BillingCycle;
  durationDays?: number;
  annualSavingsInr?: number;
  periodEndPreview?: string;
  bundleId?: string;
  packName?: string;
  listPriceInr?: number;
  savingsInr?: number;
  recommendedPack?: PackRecommendation | null;
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
  billingCycle?: BillingCycle;
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
  userCategory?: UserCategory;
  hasGstin?: boolean;
  gstin?: string | null;
  branchCount?: number;
  plans: SubscriptionPlan[];
  catalog?: ToolCatalogSku[];
  packs?: ProductPack[];
  licenses?: ToolLicense[];
  licensedToolIds?: string[];
  billingItems?: BillingItem[];
  mrrInr?: number;
  usageSummary?: WorkspaceUsageSummary;
  usageByTool?: Record<string, ToolUsageTelemetry>;
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
  claim: { id: number; status: string; utr: string; billingCycle?: BillingCycle };
  message: string;
};
