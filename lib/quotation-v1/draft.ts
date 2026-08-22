import itemTemplatesJson from "./item-templates.json";
import { buildTerms, CATEGORY_ENGAGEMENTS } from "./catalog";
import { todayISO, uid } from "./compute";
import type {
  CategoryKey,
  EngagementKey,
  QuotationV1,
  QuoteCustomer,
  QuoteItem,
} from "./types";

type TemplateItem = {
  desc: string;
  hsn?: string;
  unit?: string;
  qty: number;
  rate: number;
  gst: number;
};

const ITEM_TEMPLATES = itemTemplatesJson as Record<
  CategoryKey,
  Partial<Record<EngagementKey, TemplateItem[]>>
>;

export function blankCustomer(): QuoteCustomer {
  return {
    name: "",
    company: "",
    address: "",
    state: "Karnataka",
    gstin: "",
    phone: "",
    email: "",
  };
}

export function templateItems(category: CategoryKey, engagement: EngagementKey): QuoteItem[] {
  const rows = ITEM_TEMPLATES[category]?.[engagement] ?? [{ desc: "New item", qty: 1, rate: 0, gst: 0 }];
  return rows.map((t) => ({
    id: uid(),
    desc: t.desc,
    hsn: t.hsn ?? "",
    unit: t.unit ?? "Nos",
    qty: t.qty,
    rate: t.rate,
    gst: t.gst,
    discount: 0,
  }));
}

export function newQuotationDraft(
  category: CategoryKey = "solar",
  engagement?: EngagementKey,
): QuotationV1 {
  const allowed = CATEGORY_ENGAGEMENTS[category];
  const eng = engagement && allowed.includes(engagement) ? engagement : allowed[0];
  return {
    id: uid(),
    category,
    engagement: eng,
    categoryCustomLabel: "",
    status: "draft",
    quoteNo: null,
    date: todayISO(),
    validTill: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10),
    preparedBy: "",
    customer: blankCustomer(),
    items: templateItems(category, eng),
    extraCharge: { label: "Transport / Miscellaneous", amount: 0, gst: 0 },
    notes: buildTerms(category, eng),
    gstOverride: { mode: "manual", cgst: 0, sgst: 0, igst: null },
    createdAt: new Date().toISOString(),
    history: [{ ts: new Date().toISOString(), event: "Draft created" }],
    approvalToken: uid() + uid(),
    financeSent: false,
  };
}

export function getMissingRequiredFields(q: QuotationV1): string[] {
  const missing: string[] = [];
  if (!q.category) missing.push("Category");
  if (!q.engagement) missing.push('"For" (Service Type)');
  if (!q.preparedBy?.trim()) missing.push("Prepared By");
  if (!q.customer.name?.trim()) missing.push("Customer Name");
  if (!q.customer.phone?.trim()) missing.push("Customer Phone");
  return missing;
}

export function snapshotOf(q: QuotationV1): string {
  const { updatedAt: _u, history: _h, companySnapshot: _c, ...rest } = q;
  return JSON.stringify(rest);
}
