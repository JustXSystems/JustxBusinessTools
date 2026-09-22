/**
 * Tool-agnostic outbound email (Plain + Corporate HTML) — shared by Quotation, Site Survey, and future tools.
 * Implementation lives in quotation-email-templates.ts (historical module name); import from here in app code.
 */

export {
  buildQuotationEmailBodies as buildOutboundEmailBodies,
  DEFAULT_CORPORATE_EMAIL_MESSAGE,
  DEFAULT_CORPORATE_EMAIL_CLOSING,
  DEFAULT_CORPORATE_EMAIL_INTRO,
  DEFAULT_QUOTATION_EMAIL_TEMPLATE as DEFAULT_OUTBOUND_EMAIL_FORMAT,
  expandQuotationMessageTemplate as expandOutboundMessageTemplate,
  corporateMessageFromLegacyParts,
  emailAccentPalette,
  escapeHtml,
  formatEmailParagraphs,
  normalizeQuotationEmailTemplateId as normalizeOutboundEmailFormatId,
  quotationEmailVarsToRecord as outboundEmailVarsToRecord,
  QUOTATION_EMAIL_BLOCK_TOKENS as OUTBOUND_EMAIL_BLOCK_TOKENS,
  QUOTATION_EMAIL_TEMPLATES as OUTBOUND_EMAIL_FORMATS,
  QUOTATION_EMAIL_LINE_ITEM_LIMIT as OUTBOUND_EMAIL_LINE_ITEM_LIMIT,
  renderCorporateQuotationEmailHtml as renderCorporateOutboundEmailHtml,
  safeEmailLogoUrl,
  summarizeQuoteLineItems as summarizeOutboundLineItems,
  type QuotationEmailBlockToken as OutboundEmailBlockToken,
  type QuotationEmailLineItem as OutboundEmailLineItem,
  type QuotationEmailTemplateId as OutboundEmailFormatId,
  type QuotationEmailTemplateMeta as OutboundEmailFormatMeta,
  type QuotationEmailVars as OutboundEmailVars,
} from "@/lib/quotation-email-templates";

import type { QuotationEmailVars as OutboundEmailVars } from "@/lib/quotation-email-templates";

/** Map arbitrary tool placeholder records into outbound email vars (summary blocks + HTML shell). */
export function outboundVarsFromTemplateRecord(
  record: Record<string, string>,
  opts?: {
    lineItems?: OutboundEmailVars["lineItems"];
    moreItemsCount?: number;
    logoUrl?: string;
    accentColor?: string;
    emailHeaderLabel?: string;
    referenceNoLabel?: string;
    amountLabel?: string;
  },
): OutboundEmailVars {
  return {
    customerName: record.customerName ?? "",
    quoteNo: record.quoteNo || record.reportNo || record.documentNo || "",
    typeLabel: record.typeLabel ?? "",
    date: record.date ?? "",
    validTill: record.validTill ?? "",
    grandTotal: record.grandTotal || record.totalCost || "",
    grandTotalWords: record.grandTotalWords ?? "",
    companyName: record.companyName ?? "",
    companyPhone: record.companyPhone ?? "",
    companyEmail: record.companyEmail,
    companyAddress: record.companyAddress,
    companyGstin: record.companyGstin,
    quoteLink: record.quoteLink || record.documentLink,
    LoggedinUserName: record.LoggedinUserName,
    LogginUserPhonenumber: record.LogginUserPhonenumber,
    logoUrl: opts?.logoUrl,
    accentColor: opts?.accentColor,
    lineItems: opts?.lineItems,
    moreItemsCount: opts?.moreItemsCount,
    emailHeaderLabel: opts?.emailHeaderLabel,
    referenceNoLabel: opts?.referenceNoLabel,
    amountLabel: opts?.amountLabel,
  };
}
