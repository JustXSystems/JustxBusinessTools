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
  subtotalInr?: number;
  billingInterval: string;
  billingCycle?: BillingCycle;
  durationDays?: number;
  annualSavingsInr?: number;
  periodEndPreview?: string;
  bundleId?: string;
  packName?: string;
  listPriceInr?: number;
  savingsInr?: number;
  promo?: {
    code: string;
    description: string | null;
    discountInr: number;
    label: string;
  } | null;
  promoError?: string | null;
  availablePromos?: Array<{
    code: string;
    description: string | null;
    label: string;
    discountInr: number;
    finalTotalInr: number;
    billingCycle: "all" | BillingCycle;
    userCategory: "all" | UserCategory;
  }>;
  recommendedPack?: PackRecommendation | null;
  categoryDiscountInr?: number;
  categoryDiscountPct?: number;
  upi?: UpiPayInfo;
};

export type GstPricingMode = "inclusive" | "exclusive";

export type CommercePolicy = {
  annualEnabled: boolean;
  defaultBillingCycle: BillingCycle;
  defaultAnnualMonths: number;
  monthlyDurationDays: number;
  annualDurationDays: number;
  autoSavePackNudgeEnabled: boolean;

  enterpriseMinBranches: number;
  categoryDiscountPct: {
    individual: number;
    business: number;
    enterprise: number;
  };
  allowPersonalBusinessPreview: boolean;
  showTierComparisonMatrix: boolean;

  allowBatchStartAllTrials: boolean;
  maxConcurrentTrialsPerOrg: number | null;
  earlyRenewalWindowDays: number;
  stackEarlyRenewalDays: boolean;
  renewalSweepDays: number;
  urgentWarningDays: number;

  gstEnabled: boolean;
  gstRatePct: number;
  gstPricingMode: GstPricingMode;
  sacCode: string;
  sellerGstin: string | null;
  proformaQuoteEnabled: boolean;
  proformaValidityDays: number;
  proformaFooterNote: string;

  promosEnabled: boolean;
  showFeaturedPromoChips: boolean;
  maxFeaturedPromoChips: number;
  defaultMaxPerOrg: number | null;
  allowPromoOnPacks: boolean;
  allowPromoOnAnnual: boolean;
  maxCombinedDiscountPct: number;

  nearLimitThresholdPct: number;
  showHomeSubscriptionStrip: boolean;
  defaultCheckoutCycleFromNudge: BillingCycle;
};

export const DEFAULT_COMMERCE_POLICY: CommercePolicy = {
  annualEnabled: true,
  defaultBillingCycle: "month",
  defaultAnnualMonths: 10,
  monthlyDurationDays: 30,
  annualDurationDays: 365,
  autoSavePackNudgeEnabled: true,
  enterpriseMinBranches: 2,
  categoryDiscountPct: { individual: 0, business: 0, enterprise: 0 },
  allowPersonalBusinessPreview: true,
  showTierComparisonMatrix: true,
  allowBatchStartAllTrials: true,
  maxConcurrentTrialsPerOrg: null,
  earlyRenewalWindowDays: 7,
  stackEarlyRenewalDays: true,
  renewalSweepDays: 14,
  urgentWarningDays: 3,
  gstEnabled: true,
  gstRatePct: 18,
  gstPricingMode: "inclusive",
  sacCode: "998314",
  sellerGstin: null,
  proformaQuoteEnabled: true,
  proformaValidityDays: 7,
  proformaFooterNote:
    "Computer-generated proforma estimate. Licenses activate automatically on payment confirmation.",
  promosEnabled: true,
  showFeaturedPromoChips: true,
  maxFeaturedPromoChips: 4,
  defaultMaxPerOrg: 1,
  allowPromoOnPacks: true,
  allowPromoOnAnnual: true,
  maxCombinedDiscountPct: 50,
  nearLimitThresholdPct: 80,
  showHomeSubscriptionStrip: true,
  defaultCheckoutCycleFromNudge: "year",
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
  commercePolicy?: CommercePolicy;
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

export type BillingHistoryEntry = {
  id: string;
  kind: "upi_claim" | "gateway_txn";
  reference: string;
  status: string;
  amountInr: number;
  billingCycle: BillingCycle;
  provider: string;
  toolIds: string[];
  toolNames: string[];
  payerName: string | null;
  payerEmail: string | null;
  occurredAt: string;
  reviewNote: string | null;
};

export type BillingHistoryPayload = {
  entries: BillingHistoryEntry[];
  account: {
    businessName: string | null;
    gstin: string | null;
    hasGstin: boolean;
    userCategory: UserCategory;
  };
};
