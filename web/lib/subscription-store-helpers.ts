import type {
  BillingCycle,
  ProductPack,
  ToolCatalogSku,
  ToolUsageTelemetry,
  UserCategory,
} from "@/lib/types/subscription";

export type StoreFilterChip =
  | "all"
  | "active"
  | "trial_ready"
  | "usage_alerts"
  | "paid"
  | "included";

export type CatalogScope = "personal" | "all";

export function formatInr(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Math.max(0, Math.round(amount)));
}

/** Resolve display pricing for a SKU in monthly or annual cycle. */
export function resolveClientSkuPrice(
  sku: Pick<
    ToolCatalogSku,
    "priceInr" | "annualPriceInr" | "resolvedAnnualPriceInr" | "annualSavingsInr" | "annualSavingsPct" | "includedFree"
  >,
  cycle: BillingCycle,
): {
  priceInr: number;
  monthlyPriceInr: number;
  annualPriceInr: number;
  annualSavingsInr: number;
  annualSavingsPct: number;
  periodSuffix: string;
} {
  if (sku.includedFree || sku.priceInr <= 0) {
    return {
      priceInr: 0,
      monthlyPriceInr: 0,
      annualPriceInr: 0,
      annualSavingsInr: 0,
      annualSavingsPct: 0,
      periodSuffix: "",
    };
  }
  const monthlyPriceInr = Math.round(sku.priceInr);
  const annualPriceInr =
    sku.resolvedAnnualPriceInr && sku.resolvedAnnualPriceInr > 0
      ? Math.round(sku.resolvedAnnualPriceInr)
      : sku.annualPriceInr && sku.annualPriceInr > 0
        ? Math.round(sku.annualPriceInr)
        : monthlyPriceInr * 10;
  const annualSavingsInr =
    sku.annualSavingsInr != null
      ? Math.max(0, Math.round(sku.annualSavingsInr))
      : Math.max(0, monthlyPriceInr * 12 - annualPriceInr);
  const annualSavingsPct =
    sku.annualSavingsPct != null
      ? sku.annualSavingsPct
      : monthlyPriceInr > 0
        ? Math.round((annualSavingsInr / (monthlyPriceInr * 12)) * 100)
        : 0;

  return {
    priceInr: cycle === "year" ? annualPriceInr : monthlyPriceInr,
    monthlyPriceInr,
    annualPriceInr,
    annualSavingsInr,
    annualSavingsPct,
    periodSuffix: cycle === "year" ? "/yr" : "/mo",
  };
}

/** Resolve display pricing for a product pack in monthly or annual cycle. */
export function resolveClientPackPrice(
  pack: Pick<ProductPack, "priceInr" | "listPriceInr" | "savingsInr" | "annualPriceInr" | "annualListPriceInr" | "annualSavingsInr">,
  cycle: BillingCycle,
): {
  priceInr: number;
  listPriceInr: number;
  savingsInr: number;
  periodSuffix: string;
} {
  if (cycle === "year") {
    const priceInr = pack.annualPriceInr != null ? Math.round(pack.annualPriceInr) : Math.round(pack.priceInr * 10);
    const listPriceInr =
      pack.annualListPriceInr != null ? Math.round(pack.annualListPriceInr) : Math.round(pack.listPriceInr * 12);
    return {
      priceInr,
      listPriceInr,
      savingsInr: Math.max(0, listPriceInr - priceInr),
      periodSuffix: "/yr",
    };
  }
  return {
    priceInr: Math.round(pack.priceInr),
    listPriceInr: Math.round(pack.listPriceInr),
    savingsInr: Math.max(0, Math.round(pack.savingsInr)),
    periodSuffix: "/mo",
  };
}

/** Category badge copy and operational context for the storefront header. */
export function describeUserCategory(
  category: UserCategory | undefined,
  branchCount = 1,
): {
  category: UserCategory;
  badge: string;
  headline: string;
  description: string;
  tone: "cyan" | "emerald" | "violet";
} {
  if (category === "individual") {
    return {
      category: "individual",
      badge: "Personal Workspace",
      headline: "Tailored for individual productivity",
      description:
        "Showing GSTIN-independent tools ready for immediate personal use. Add a GSTIN anytime to unlock invoicing, quotations, BOS & IMS suites.",
      tone: "cyan",
    };
  }
  if (category === "enterprise") {
    return {
      category: "enterprise",
      badge: `Multi-Branch Enterprise · ${branchCount} Branches`,
      headline: "Unified commerce across your branches",
      description:
        "Per-branch tool licensing with consolidated org billing and pack savings across sales, inventory, solar, and enterprise operations.",
      tone: "violet",
    };
  }
  return {
    category: "business",
    badge: "Business Workspace · GSTIN Verified",
    headline: "Modular business tools, zero bloat",
    description:
      "Subscribe only to the tools your team runs daily, bundle into discounted packs, or switch to annual billing to save 2 months free.",
    tone: "emerald",
  };
}

/** Human-readable usage telemetry metadata for SKU cards and meters. */
export function describeToolUsage(usage: ToolUsageTelemetry | undefined): {
  label: string;
  tone: "emerald" | "amber" | "danger" | "cyan" | "muted";
  pct: number | null;
  urgent: boolean;
} | null {
  if (!usage) return null;
  switch (usage.status) {
    case "included":
      return {
        label: usage.recordCount > 0 ? `Included · ${usage.recordCount} saved` : "Included free",
        tone: "muted",
        pct: null,
        urgent: false,
      };
    case "expiring_soon":
      return {
        label: `${usage.isTrial ? "Trial" : "License"} ends in ${usage.daysLeft ?? 0}d`,
        tone: "amber",
        pct: null,
        urgent: true,
      };
    case "trial":
      return {
        label: `Trial · ${usage.daysLeft ?? 0}d left`,
        tone: "cyan",
        pct: null,
        urgent: false,
      };
    case "licensed":
      return {
        label:
          usage.recordCount > 0
            ? `Unlimited · ${usage.recordCount} records`
            : "Unlimited on workspace",
        tone: "emerald",
        pct: null,
        urgent: false,
      };
    case "hard_locked":
      return {
        label: "License or trial required",
        tone: "cyan",
        pct: 100,
        urgent: false,
      };
    case "at_limit":
      return {
        label: `Limit reached · ${usage.recordCount}/${usage.limit ?? 0}`,
        tone: "danger",
        pct: 100,
        urgent: true,
      };
    case "near_limit":
      return {
        label: `${usage.recordCount}/${usage.limit ?? 0} records (${usage.utilizationPct ?? 0}%)`,
        tone: "amber",
        pct: usage.utilizationPct ?? 85,
        urgent: true,
      };
    default:
      return {
        label:
          usage.limit != null
            ? `${usage.recordCount}/${usage.limit} free records`
            : `${usage.recordCount} records`,
        tone: "muted",
        pct: usage.utilizationPct ?? 0,
        urgent: false,
      };
  }
}

/** Filter catalog SKUs by user category scope, search query, and smart filter chip. */
export function filterStoreCatalog(
  catalog: ToolCatalogSku[],
  opts: {
    query: string;
    chip: StoreFilterChip;
    userCategory?: UserCategory;
    scope: CatalogScope;
  },
): ToolCatalogSku[] {
  const q = opts.query.trim().toLowerCase();
  const restrictPersonal = opts.userCategory === "individual" && opts.scope === "personal";

  return catalog.filter((sku) => {
    if (restrictPersonal && sku.personalUsage === false) return false;

    if (q) {
      const hay = `${sku.name} ${sku.category} ${sku.tagline ?? ""} ${sku.toolId}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }

    switch (opts.chip) {
      case "active":
        return sku.licensed && !sku.includedFree;
      case "trial_ready":
        return Boolean(sku.trialEligible);
      case "usage_alerts":
        return (
          sku.usage?.status === "near_limit" ||
          sku.usage?.status === "at_limit" ||
          sku.usage?.status === "expiring_soon"
        );
      case "included":
        return sku.includedFree;
      case "paid":
        return !sku.includedFree && sku.priceInr > 0;
      default:
        return true;
    }
  });
}

/** Filter product packs by user category scope. */
export function filterStorePacks(
  packs: ProductPack[],
  opts: {
    userCategory?: UserCategory;
    scope: CatalogScope;
  },
): ProductPack[] {
  if (opts.userCategory === "individual" && opts.scope === "personal") {
    return packs.filter((p) => Boolean(p.personalCompatible));
  }
  return packs;
}
