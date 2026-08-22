export type CategoryKey = "solar" | "ups" | "battery" | "inverter" | "other";
export type EngagementKey =
  | "epc"
  | "amc"
  | "srv"
  | "setup"
  | "sale"
  | "pm"
  | "stin"
  | "gsr"
  | "misc";

export type QuoteStatus = "draft" | "sent" | "approved" | "rejected";

export type QuoteItem = {
  id: string;
  desc: string;
  hsn?: string;
  unit?: string;
  qty: number | string;
  rate: number | string;
  gst: number | string;
  discount?: number | string;
};

export type QuoteCustomer = {
  name: string;
  company: string;
  address: string;
  state: string;
  gstin: string;
  phone: string;
  email: string;
};

export type ExtraCharge = {
  label: string;
  amount: number | string;
  gst: number | string;
};

export type GstOverride = {
  mode: "auto" | "manual";
  cgst: number | string | null;
  sgst: number | string | null;
  igst: number | string | null;
};

export type HistoryEvent = { ts: string; event: string };

export type QuotationV1 = {
  id: string;
  category: CategoryKey;
  engagement: EngagementKey;
  categoryCustomLabel: string;
  status: QuoteStatus;
  quoteNo: string | null;
  date: string;
  validTill: string;
  preparedBy: string;
  customer: QuoteCustomer;
  items: QuoteItem[];
  extraCharge: ExtraCharge;
  notes: string;
  gstOverride: GstOverride;
  createdAt: string;
  updatedAt?: string;
  history: HistoryEvent[];
  approvalToken: string;
  financeSent: boolean;
  approvedAt?: string;
  rejectedAt?: string;
  /** Letterhead frozen at save/send — used on public approve / PDF history. */
  companySnapshot?: CompanyProfileV1;
};

export type CompanyProfileV1 = {
  name: string;
  /** Business Profile logo URL (source of truth for brand mark). */
  logo: string | null;
  tagline: string;
  address: string;
  state: string;
  gstin: string;
  landline: string;
  phone: string;
  email: string;
  salesEmail: string;
  managerEmail: string;
  website: string;
  quotePrefix: string;
  place: string;
};

export type QuoteTotals = {
  subtotal: number;
  discountTotal: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  totalTax: number;
  grand: number;
  roundOff: number;
  interState: boolean;
  isManual: boolean;
  exBase: number;
  exGstRate: number;
  exGstAmt: number;
  exTotal: number;
};

export type QuoteNotification = {
  id: string;
  quotationId: string;
  message: string;
  read: boolean;
  createdAt: string;
};

export type QuoteHistoryRow = {
  id: string;
  quotationId: string;
  quoteNo: string | null;
  customerName: string;
  typeLabel: string;
  status: string;
  grand: number;
  savedAt: string;
};
