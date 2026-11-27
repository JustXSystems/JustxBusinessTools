/**
 * Typed client for native IMS Quotations (`/api/ims/quotations/*`).
 * Full Quotation Generator V1 parity + IMS catalog, ATP stock & SO/Invoice/BOM conversion.
 */
import type { CompanyProfileV1, QuotationV1, QuoteHistoryRow, QuoteNotification } from "@/lib/quotation-v1";
import type { BusinessProfileSendSettings } from "@/lib/types/business-profile";
import { del, get, post, type ImsQuoteSettings } from "./api";

export type ImsQuoteConversions = {
  salesOrderId: string | null;
  salesOrderNo: string | null;
  invoiceId: string | null;
  invoiceNo: string | null;
  bomId: string | null;
  bomDocNo: string | null;
};

export type ImsQuotation = QuotationV1 & {
  revision?: number;
  parentQuoteId?: string | null;
  _grandTotal?: number;
  conversions?: ImsQuoteConversions;
};

export type ImsQuoteStockInfo = {
  currentStock: number;
  reserved: number;
  free: number;
  unit: string;
};

export type ImsQuoteConfigResponse = {
  company: CompanyProfileV1;
  quoteSettings: ImsQuoteSettings;
  sendSettings: BusinessProfileSendSettings;
  emailWebhookConfigured: boolean;
  whatsappConfig: { canAutoAttach: boolean; cloudConfigured: boolean; webhookConfigured: boolean };
  legacyCount: number;
};

export type ImsQuoteConvertTarget = "sales_order" | "invoice" | "proforma" | "bom";

export type ImsQuoteConvertResult = {
  target: ImsQuoteConvertTarget;
  id: string;
  docNo: string;
  alreadyExisted: boolean;
};

export const DEFAULT_IMS_QUOTE_SETTINGS: ImsQuoteSettings = {
  quotePrefix: "",
  numberingMode: "v1_category",
  defaultValidityDays: 15,
  tagline: "Quotations · Service · Sales",
  landline: "",
  website: "",
  place: "Bengaluru",
  salesEmail: "",
  managerEmail: "",
  defaultShowGstColumns: true,
  defaultGstNote: "",
  defaultBuybackLabel: "",
  termsByEngagement: {},
  defaultEmailTemplateId: "classic",
};

export const imsQuotations = {
  config: () => get<ImsQuoteConfigResponse>("/quotations/config"),
  list: (status?: string) => get<{ quotations: ImsQuotation[] }>("/quotations", status ? { status } : undefined),
  get: (id: string) => get<{ quotation: ImsQuotation; stockByItem: Record<string, ImsQuoteStockInfo> }>(`/quotations/${encodeURIComponent(id)}`),
  save: (quotation: ImsQuotation, opts?: { historyAction?: string; forceSignature?: boolean; grandTotal?: number }) =>
    post<{ quotation: ImsQuotation }>("/quotations", { quotation, ...opts }),
  remove: (id: string) => del<void>(`/quotations/${encodeURIComponent(id)}`),
  revise: (id: string) => post<{ quotation: ImsQuotation }>(`/quotations/${encodeURIComponent(id)}/revise`, {}),
  convert: (id: string, target: ImsQuoteConvertTarget) =>
    post<ImsQuoteConvertResult>(`/quotations/${encodeURIComponent(id)}/convert`, { target }),
  importLegacy: () => post<{ imported: number; skipped: number }>("/quotations/import-legacy", {}),

  alerts: () => get<{ notifications: QuoteNotification[] }>("/quotations/alerts"),
  addAlert: (quotationId: string, message: string) => post<{ notification: QuoteNotification }>("/quotations/alerts", { quotationId, message }),
  markAlertRead: (id: string) => post<{ ok: boolean }>(`/quotations/alerts/${encodeURIComponent(id)}/read`, {}),
  markAllAlertsRead: () => post<{ ok: boolean; count: number }>("/quotations/alerts/read-all", {}),

  activity: () => get<{ history: Array<QuoteHistoryRow & { summary?: string }> }>("/quotations/activity"),

  sendEmail: (payload: Record<string, unknown>) =>
    post<{ ok: boolean; delivered: boolean; via: string; outboxId?: string; hint?: string }>("/quotations/send/email", payload),
  sendWhatsapp: (payload: Record<string, unknown>) =>
    post<{ ok: boolean; delivered: boolean; via: string; sent?: string[]; hint?: string }>("/quotations/send/whatsapp", payload),
  runFollowUpRemindersNow: () =>
    post<{ ok: boolean; date: string; due: number; sent: number; queued: number; failed: number; skipped: number }>(
      "/quotations/follow-up-reminders/run-now",
      {},
    ),
};
