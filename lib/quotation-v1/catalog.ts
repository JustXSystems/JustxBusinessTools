import type { CategoryKey, CompanyProfileV1, EngagementKey } from "./types";

export const CATEGORIES: Record<CategoryKey, { label: string; code: string }> = {
  solar: { label: "Solar", code: "SOL" },
  ups: { label: "UPS", code: "UPS" },
  battery: { label: "Battery", code: "BAT" },
  inverter: { label: "Inverter", code: "INV" },
  other: { label: "Other", code: "OTH" },
};

export const ENGAGEMENTS: Record<EngagementKey, { label: string; code: string }> = {
  epc: { label: "Installation (EPC)", code: "EPC" },
  amc: { label: "AMC", code: "AMC" },
  srv: { label: "Repair", code: "RPR" },
  setup: { label: "Setup", code: "STP" },
  sale: { label: "Sale", code: "SEL" },
  pm: { label: "Preventive Maintenance", code: "PM" },
  stin: { label: "Site Inspection", code: "STIN" },
  gsr: { label: "General Service", code: "GSR" },
  misc: { label: "Other", code: "OTH" },
};

export const CATEGORY_ENGAGEMENTS: Record<CategoryKey, EngagementKey[]> = {
  solar: ["epc", "amc", "srv", "pm"],
  ups: ["setup", "amc", "srv", "sale", "pm", "stin"],
  battery: ["sale", "pm"],
  inverter: ["setup", "srv", "sale"],
  other: ["sale", "stin", "srv", "misc", "gsr"],
};

export const CATEGORY_ENGAGEMENT_OVERRIDES: Partial<
  Record<CategoryKey, Partial<Record<EngagementKey, { label: string; code: string }>>>
> = {
  solar: {
    epc: { label: "Installation", code: "INST" },
    amc: { label: "Annual Maintenance -AMC", code: "AMC" },
    srv: { label: "Repair Works", code: "RPW" },
  },
  ups: {
    setup: { label: "Installation", code: "INST" },
    amc: { label: "Annual Maintenance -AMC", code: "AMC" },
    srv: { label: "Repair Works", code: "RPW" },
    sale: { label: "Sales", code: "SEL" },
  },
  inverter: {
    setup: { label: "Installation", code: "INST" },
    srv: { label: "Repair Works", code: "RPW" },
    sale: { label: "Sales", code: "SEL" },
  },
  battery: {
    sale: { label: "Sales", code: "SEL" },
  },
  other: {
    sale: { label: "Sales", code: "SEL" },
    srv: { label: "Repair Works", code: "RPR" },
  },
};

export function engMeta(category: CategoryKey, engKey: EngagementKey) {
  const base = ENGAGEMENTS[engKey];
  const override = CATEGORY_ENGAGEMENT_OVERRIDES[category]?.[engKey];
  return override ? { ...base, ...override } : base;
}

export function typeLabel(q: {
  category: CategoryKey;
  engagement: EngagementKey;
  categoryCustomLabel?: string;
}) {
  const catLabel =
    q.category === "other" && q.categoryCustomLabel
      ? q.categoryCustomLabel
      : CATEGORIES[q.category].label;
  return `${catLabel} — ${engMeta(q.category, q.engagement).label}`;
}

export const WARRANTY_TEXT: Record<CategoryKey, string> = {
  solar:
    "Panels carry a 25-year performance warranty (as per manufacturer); Inverter warranty as per OEM (typically 5-8 years).",
  ups: "UPS system carries manufacturer warranty (typically 1-2 years); batteries carry a separate OEM warranty (typically 2-3 years).",
  battery:
    "Battery bank carries manufacturer warranty as per OEM (typically 3-5 years depending on chemistry and usage).",
  inverter:
    "Inverter carries manufacturer warranty as per OEM (typically 2-5 years); batteries carry a separate OEM warranty (typically 2-3 years).",
  other: "Warranty, if any, is as per the respective OEM / manufacturer terms.",
};

export const BASE_TERMS: Record<EngagementKey, string> = {
  epc: `1. Prices are valid for 15 days from the date of this quotation.
2. 40% advance on order confirmation, 40% on material delivery, 20% on commissioning.
3. Delivery & installation within 15-20 working days of advance receipt, subject to site readiness.
4. {WARRANTY}
5. Civil work, additional wiring beyond scope, and any statutory liaison charges (if any) are billed extra.
6. GST as applicable will be charged as per prevailing government rates on the date of invoicing.
7. This quotation is subject to Bengaluru jurisdiction.`,
  amc: `1. AMC is valid for 12 months from the date of activation, renewable annually.
2. Visit schedule as agreed; unscheduled visits beyond AMC scope are chargeable separately.
3. Spare parts, if required, are billed extra unless explicitly included above.
4. Payment due in full at the start of the AMC period unless otherwise agreed.
5. GST as applicable will be charged as per prevailing government rates.
6. This quotation is subject to Bengaluru jurisdiction.`,
  srv: `1. This is a one-time, on-call service quotation and does not constitute an AMC.
2. Site visit charges are payable even if the customer decides not to proceed with the repair.
3. Spare parts are subject to availability; lead time will be communicated separately.
4. Payment due on completion of service, prior to closing the service call.
5. GST as applicable will be charged as per prevailing government rates.
6. This quotation is subject to Bengaluru jurisdiction.`,
  setup: `1. Prices are valid for 15 days from the date of this quotation.
2. 40% advance on order confirmation, 40% on material delivery, 20% on commissioning.
3. Delivery & installation within 7-15 working days of advance receipt, subject to site readiness.
4. {WARRANTY}
5. Additional wiring beyond scope, and any statutory liaison charges (if any) are billed extra.
6. GST as applicable will be charged as per prevailing government rates on the date of invoicing.
7. This quotation is subject to Bengaluru jurisdiction.`,
  sale: `1. Prices are valid for 15 days from the date of this quotation.
2. 100% payment due on or before delivery, unless otherwise agreed in writing.
3. This is a supply-only quotation; installation, wiring, and commissioning are not included unless separately specified.
4. {WARRANTY}
5. Goods once sold are non-returnable except for manufacturing defects covered under OEM warranty.
6. GST as applicable will be charged as per prevailing government rates on the date of invoicing.
7. This quotation is subject to Bengaluru jurisdiction.`,
  pm: `1. This is a one-time Preventive Maintenance service and does not constitute an AMC.
2. Visit is scheduled by mutual appointment; rescheduling due to site unavailability may incur revisit charges.
3. Any faults or parts requiring replacement identified during the visit are quoted and billed separately.
4. Payment due on completion of the visit.
5. GST as applicable will be charged as per prevailing government rates.
6. This quotation is subject to Bengaluru jurisdiction.`,
  stin: `1. This is a one-time site inspection/assessment visit and does not include any repair, installation, or maintenance work.
2. Findings and recommendations are shared as an inspection report; any follow-up work will be quoted separately.
3. Inspection charges are payable regardless of whether the customer proceeds with follow-up work.
4. Payment due on completion of the visit.
5. GST as applicable will be charged as per prevailing government rates.
6. This quotation is subject to Bengaluru jurisdiction.`,
  gsr: `1. This is a one-time general service quotation for the scope described above.
2. Any additional work or parts identified during the service are quoted and billed separately.
3. Service charges are payable regardless of whether further work is undertaken.
4. Payment due on completion of the service.
5. GST as applicable will be charged as per prevailing government rates.
6. This quotation is subject to Bengaluru jurisdiction.`,
  misc: `1. Prices and scope are as mutually agreed for this custom item/service.
2. Payment terms: as agreed with the customer, unless specified above.
3. {WARRANTY}
4. GST as applicable will be charged as per prevailing government rates on the date of invoicing.
5. This quotation is subject to Bengaluru jurisdiction.`,
};

export function buildTerms(category: CategoryKey, engagement: EngagementKey): string {
  return (BASE_TERMS[engagement] ?? BASE_TERMS.misc).replace(
    "{WARRANTY}",
    WARRANTY_TEXT[category] ?? WARRANTY_TEXT.other,
  );
}

export const INDIAN_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Chandigarh",
  "Puducherry",
];

export const DEFAULT_COMPANY: CompanyProfileV1 = {
  name: "Your Company",
  logo: null,
  tagline: "Quotations · Service · Sales",
  address: "",
  state: "Karnataka",
  gstin: "",
  landline: "",
  phone: "",
  email: "",
  salesEmail: "",
  managerEmail: "",
  website: "",
  quotePrefix: "QT",
  place: "Bengaluru",
};

/** Fields we pull from the operator Business Profile for letterhead branding. */
export type BusinessProfileBrandSource = {
  businessName?: string | null;
  logo?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  state?: string | null;
  gstin?: string | null;
  phone?: string | null;
  email?: string | null;
};

/**
 * Business Profile name + logo always win. Other letterhead fields fill from
 * the profile only when the quotation company record still has blanks.
 */
export function mergeCompanyFromBusinessProfile(
  company: CompanyProfileV1,
  profile: BusinessProfileBrandSource | null | undefined,
): CompanyProfileV1 {
  if (!profile) return { ...DEFAULT_COMPANY, ...company, logo: company.logo ?? null };

  const base = { ...DEFAULT_COMPANY, ...company, logo: company.logo ?? null };
  const addressFromProfile = [profile.addressLine1, profile.addressLine2]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join("\n");
  const name = (profile.businessName ?? "").trim();
  const prefixFromName = name.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase();

  return {
    ...base,
    name: name || base.name,
    logo: profile.logo || base.logo || null,
    address: base.address.trim() ? base.address : addressFromProfile || base.address,
    state: base.state.trim() && base.state !== DEFAULT_COMPANY.state ? base.state : profile.state || base.state,
    gstin: base.gstin.trim() ? base.gstin : profile.gstin || base.gstin,
    phone: base.phone.trim() ? base.phone : profile.phone || base.phone,
    email: base.email.trim() ? base.email : profile.email || base.email,
    quotePrefix:
      base.quotePrefix && base.quotePrefix !== DEFAULT_COMPANY.quotePrefix
        ? base.quotePrefix
        : prefixFromName || base.quotePrefix,
  };
}
