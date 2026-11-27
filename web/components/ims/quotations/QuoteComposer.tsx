"use client";

import "@/components/quotation-v1/quotation-v1.css";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  Field,
  FormGrid,
  Input,
  Select,
  Textarea,
  useToast,
} from "@/components/bos";
import { CustomerNameSuggest } from "@/components/quotation-v1/CustomerNameSuggest";
import { LineAmountReverseModal } from "@/components/quotation-v1/LineAmountReverseModal";
import { QuoteSheet } from "@/components/quotation-v1/QuoteSheet";
import { SendViaEmailComposeModal } from "@/components/send-via/SendViaEmailComposeModal";
import { deliverToolArtifact, pdfBase64ToBytes } from "@/lib/artifact-delivery";
import { withBasePath } from "@/lib/base-path";
import type { ImsItem, ImsQuoteSettings } from "@/lib/ims/api";
import {
  imsQuotations,
  type ImsQuotation,
  type ImsQuoteConvertTarget,
  type ImsQuoteStockInfo,
} from "@/lib/ims/quotations";
import { buildMailtoHref } from "@/lib/mailto";
import {
  buildQuotationEmailBodies,
  DEFAULT_CORPORATE_EMAIL_MESSAGE,
  normalizeQuotationEmailTemplateId,
  summarizeQuoteLineItems,
  type QuotationEmailVars,
} from "@/lib/quotation-email-templates";
import {
  buildTerms,
  CATEGORIES,
  CATEGORY_ENGAGEMENTS,
  computeTotals,
  customerFromSuggestion,
  DEFAULT_BUYBACK_LABEL,
  DEFAULT_GST_NOTE,
  DEFAULT_WHATSAPP_MESSAGE,
  engMeta,
  fillSendTemplate,
  getMissingRequiredFields,
  INDIAN_STATES,
  mergeCustomerSuggestions,
  money,
  quotationPdfToBase64,
  sanitizeNumStr,
  sanitizeSignedNumStr,
  showGstColumnsOf,
  suggestCustomersFromQuotations,
  templateItems,
  typeLabel,
  uid,
  type CategoryKey,
  type CompanyProfileV1,
  type EngagementKey,
  type ProfileQuoteTerms,
  type QuoteItem,
  type QuoteStatus,
  type SuggestedCustomer,
} from "@/lib/quotation-v1";
import { type BusinessProfileSendSettings } from "@/lib/types/business-profile";
import { api } from "@/lib/api";
import { useIms } from "../core";
import { ItemPickerDialog } from "../shared/pickers";

type ExtendedLine = QuoteItem & { itemId?: string | null; sku?: string | null };

function waDigits(raw: string) {
  let digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

function forceDownloadPdf(filename: string, pdfBase64: string) {
  const bytes = pdfBase64ToBytes(pdfBase64);
  const safeName = filename.toLowerCase().endsWith(".pdf") ? filename : `${filename}.pdf`;
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = safeName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Props = {
  quote: ImsQuotation;
  onChange: (next: ImsQuotation) => void;
  company: CompanyProfileV1;
  quoteSettings: ImsQuoteSettings;
  sendSettings: BusinessProfileSendSettings;
  emailWebhookConfigured: boolean;
  whatsappAutoAttach: boolean;
  allQuotations: ImsQuotation[];
  stockByItem: Record<string, ImsQuoteStockInfo>;
  onSaved: (saved: ImsQuotation) => void;
  onNew: () => void;
  onRevise: (q: ImsQuotation) => void;
  onConvert: (q: ImsQuotation, target: ImsQuoteConvertTarget) => void;
};

export function QuoteComposer({
  quote,
  onChange,
  company,
  quoteSettings,
  sendSettings,
  emailWebhookConfigured,
  whatsappAutoAttach,
  allQuotations,
  stockByItem,
  onSaved,
  onNew,
  onRevise,
  onConvert,
}: Props) {
  const { session, can, navigate } = useIms();
  const toast = useToast();
  const sheetRef = useRef<HTMLDivElement>(null);

  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  const [reverseIdx, setReverseIdx] = useState<number | null>(null);
  const [forceSignature, setForceSignature] = useState(false);

  // Customer suggestions (shared Party Registry + past quotations)
  const [partySuggestions, setPartySuggestions] = useState<SuggestedCustomer[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestIdx, setSuggestIdx] = useState(0);

  // Email modal state
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailCc, setEmailCc] = useState("");
  const [emailReplyTo, setEmailReplyTo] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailTemplate, setEmailTemplate] = useState("");
  const [emailSending, setEmailSending] = useState(false);

  // WhatsApp modal state
  const [waOpen, setWaOpen] = useState(false);
  const [waPhones, setWaPhones] = useState("");
  const [waMsg, setWaMsg] = useState("");
  const [waSending, setWaSending] = useState(false);

  const totals = useMemo(() => computeTotals(quote, company), [quote, company]);
  const showGstCols = showGstColumnsOf(quote);
  const profileTerms = (quoteSettings.termsByEngagement ?? {}) as ProfileQuoteTerms;
  const isOwner = session.access.role === "owner";
  const canSales = can("sales");
  const canBom = can("bom");

  const signatureLocked = Boolean(
    quote.quoteNo &&
      quote.createdByUserId != null &&
      session.actor.userId != null &&
      quote.createdByUserId !== session.actor.userId,
  );

  // Query shared Party Registry when typing customer name
  useEffect(() => {
    const q = quote.customer.name.trim();
    if (q.length < 2) {
      setPartySuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      void api<{ parties?: Array<Record<string, unknown>> }>(`/api/parties/suggest?q=${encodeURIComponent(q)}&kind=customer`)
        .then((res) => {
          const list: SuggestedCustomer[] = (res.parties ?? []).map((p) => ({
            key: String(p.id ?? p.name ?? Math.random()),
            sourceQuoteId: "",
            partyId: p.id ? String(p.id) : undefined,
            name: String(p.contact_person || p.name || ""),
            company: String(p.name || ""),
            phone: String(p.mobile || ""),
            email: String(p.email || ""),
            gstin: String(p.gstin || ""),
            address: String(p.address || ""),
            city: String(p.city || ""),
            state: String(p.state || ""),
            source: "party",
          }));
          setPartySuggestions(list);
        })
        .catch(() => setPartySuggestions([]));
    }, 180);
    return () => clearTimeout(timer);
  }, [quote.customer.name]);

  const customerSuggestions = useMemo(() => {
    const fromQuotes = suggestCustomersFromQuotations(allQuotations, quote.customer.name);
    return mergeCustomerSuggestions(partySuggestions, fromQuotes);
  }, [allQuotations, quote.customer.name, partySuggestions]);

  const setField = <K extends keyof ImsQuotation>(key: K, value: ImsQuotation[K]) => {
    onChange({ ...quote, [key]: value });
  };

  const setCustomer = <K extends keyof ImsQuotation["customer"]>(key: K, value: string) => {
    onChange({ ...quote, customer: { ...quote.customer, [key]: value } });
  };

  const setCategory = (cat: CategoryKey) => {
    const engs = CATEGORY_ENGAGEMENTS[cat];
    const nextEng = engs.includes(quote.engagement) ? quote.engagement : engs[0];
    onChange({
      ...quote,
      category: cat,
      engagement: nextEng,
      notes: buildTerms(cat, nextEng, profileTerms),
    });
  };

  const setEngagement = (eng: EngagementKey) => {
    onChange({
      ...quote,
      engagement: eng,
      notes: buildTerms(quote.category, eng, profileTerms),
    });
  };

  const lines = quote.items as ExtendedLine[];

  const updateLine = (idx: number, patch: Partial<ExtendedLine>) => {
    const next = lines.map((it, i) => (i === idx ? { ...it, ...patch } : it));
    setField("items", next);
  };

  const addBlankLine = (buyback = false) => {
    setField("items", [
      ...lines,
      {
        id: uid(),
        desc: buyback ? "Old Battery / Equipment Buyback" : "",
        hsn: "",
        unit: "nos",
        qty: 1,
        rate: buyback ? "-1000" : "",
        gst: buyback ? 0 : 18,
        discount: 0,
      },
    ]);
  };

  const addCatalogItem = (item: ImsItem) => {
    const nextLine: ExtendedLine = {
      id: uid(),
      itemId: item.id,
      sku: item.sku ?? null,
      desc: item.name,
      hsn: item.hsn ?? "",
      unit: item.unit || "nos",
      qty: 1,
      rate: item.sellingPrice > 0 ? String(item.sellingPrice) : "",
      gst: Number.isFinite(item.gstRate) ? item.gstRate : 18,
      discount: 0,
    };
    const isOnlyEmpty = lines.length === 1 && !lines[0].desc.trim() && !lines[0].rate;
    setField("items", isOnlyEmpty ? [nextLine] : [...lines, nextLine]);
    toast.show({ tone: "emerald", title: `Added ${item.name}` });
  };

  const loadTemplateLines = () => {
    const tpl = templateItems(quote.category, quote.engagement);
    if (!tpl.length) {
      toast.show({ tone: "blue", title: "No built-in template items for this Category / For combination." });
      return;
    }
    setField("items", tpl);
    toast.show({ tone: "emerald", title: `Loaded ${tpl.length} template line${tpl.length === 1 ? "" : "s"}` });
  };

  const removeLine = (idx: number) => {
    if (lines.length <= 1) {
      setField("items", [{ id: uid(), desc: "", hsn: "", unit: "nos", qty: 1, rate: "", gst: 18, discount: 0 }]);
      return;
    }
    setField("items", lines.filter((_, i) => i !== idx));
  };

  const saveQuote = async (nextStatus?: QuoteStatus, historyEvent?: string) => {
    const missing = getMissingRequiredFields(quote);
    if (missing.length) {
      toast.show({ tone: "coral", title: `Required: ${missing.join(", ")}` });
      return null;
    }
    setSaving(true);
    try {
      const statusToSave = nextStatus ?? quote.status;
      const now = new Date().toISOString();
      const nextHistory = [
        ...(quote.history ?? []),
        ...(historyEvent ? [{ ts: now, event: historyEvent }] : []),
      ];
      const payload: ImsQuotation = {
        ...quote,
        status: statusToSave,
        history: nextHistory,
        companySnapshot: company,
      };
      const res = await imsQuotations.save(payload, {
        historyAction: nextStatus ? `status:${nextStatus}` : quote.quoteNo ? "update" : "create",
        forceSignature,
        grandTotal: totals.grand,
      });
      onSaved(res.quotation);
      setForceSignature(false);
      toast.show({ tone: "emerald", title: `Saved ${res.quotation.quoteNo} (${res.quotation.status})` });
      return res.quotation;
    } catch (err) {
      toast.show({ tone: "coral", title: err instanceof Error ? err.message : "Failed to save quotation" });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const generatePdfBase64 = async (savedQuote: ImsQuotation) => {
    const { pdfBase64 } = await quotationPdfToBase64(savedQuote, company);
    return pdfBase64;
  };

  const handleDownloadPdf = async () => {
    setExporting(true);
    try {
      const saved = quote.quoteNo ? quote : await saveQuote();
      if (!saved) return;
      const pdfBase64 = await generatePdfBase64(saved);
      const filename = `${(saved.quoteNo || "quotation").replace(/[^A-Za-z0-9_-]+/g, "_")}.pdf`;
      const delivered = await deliverToolArtifact({
        toolId: "quotationv1",
        filename,
        mimeType: "application/pdf",
        bytes: pdfBase64ToBytes(pdfBase64),
      }).catch(() => null);
      if (!delivered) {
        forceDownloadPdf(filename, pdfBase64);
      }
      toast.show({ tone: "emerald", title: `PDF ready: ${filename}` });
    } catch (err) {
      toast.show({ tone: "coral", title: err instanceof Error ? err.message : "PDF export failed" });
    } finally {
      setExporting(false);
    }
  };

  const approvalUrl = useMemo(() => {
    if (!quote.approvalToken) return "";
    const path = withBasePath(`/quotation-v1/approve/${encodeURIComponent(quote.approvalToken)}`);
    return typeof window !== "undefined" ? `${window.location.origin}${path}` : path;
  }, [quote.approvalToken]);

  const copyApprovalLink = async () => {
    const saved = quote.quoteNo && quote.status === "sent" ? quote : await saveQuote("sent", "Approval link copied");
    if (!saved) return;
    const url = `${window.location.origin}${withBasePath(`/quotation-v1/approve/${encodeURIComponent(saved.approvalToken)}`)}`;
    await navigator.clipboard.writeText(url).catch(() => undefined);
    await imsQuotations.addAlert(saved.id, `Approval link copied for ${saved.quoteNo}`).catch(() => undefined);
    toast.show({ tone: "emerald", title: "Customer approval link copied" });
  };

  const buildEmailVars = (saved: ImsQuotation): QuotationEmailVars => {
    const summary = summarizeQuoteLineItems(saved.items);
    return {
      companyName: company.name,
      companyPhone: company.phone || "",
      companyEmail: company.email || "",
      companyAddress: company.address || "",
      companyGstin: company.gstin || "",
      customerName: saved.customer.name || saved.customer.company || "Customer",
      quoteNo: saved.quoteNo || "",
      date: saved.date || "",
      validTill: saved.validTill || "",
      grandTotal: `₹${money(totals.grand)}`,
      grandTotalWords: "",
      typeLabel: typeLabel(saved),
      quoteLink: approvalUrl,
      LoggedinUserName: saved.preparedBy || session.actor.name || "",
      LogginUserPhonenumber: saved.preparedByPhone || company.phone || "",
      lineItems: summary.lineItems,
      moreItemsCount: summary.moreItemsCount,
    };
  };

  const openEmailDialog = async () => {
    const saved = quote.quoteNo ? quote : await saveQuote();
    if (!saved) return;
    const templateId = normalizeQuotationEmailTemplateId(
      quoteSettings.defaultEmailTemplateId || sendSettings.email?.templateId,
    );
    const built = buildQuotationEmailBodies({
      templateId,
      customPlainMessage: sendSettings.email?.message,
      customCorporateMessage: sendSettings.email?.corporateMessage || DEFAULT_CORPORATE_EMAIL_MESSAGE,
      vars: buildEmailVars(saved),
    });
    setEmailTo(saved.customer.email || "");
    setEmailCc(sendSettings.email?.cc || company.salesEmail || "");
    setEmailReplyTo(sendSettings.email?.replyTo || saved.preparedByEmail || company.email || "");
    setEmailSubject(`Quotation ${saved.quoteNo || ""} — ${typeLabel(saved)} (${company.name})`.trim());
    setEmailTemplate(built.text);
    setEmailOpen(true);
  };

  const handleSendEmail = async () => {
    if (!emailTo.trim()) {
      toast.show({ tone: "coral", title: "Recipient email is required" });
      return;
    }
    setEmailSending(true);
    try {
      const saved = await saveQuote("sent", `Emailed to ${emailTo.trim()}`);
      if (!saved) return;
      const pdfBase64 = await generatePdfBase64(saved);
      const filename = `${(saved.quoteNo || "quotation").replace(/[^A-Za-z0-9_-]+/g, "_")}.pdf`;
      const templateId = normalizeQuotationEmailTemplateId(
        quoteSettings.defaultEmailTemplateId || sendSettings.email?.templateId,
      );
      const built = buildQuotationEmailBodies({
        templateId,
        customPlainMessage: emailTemplate.trim(),
        customCorporateMessage: emailTemplate.trim(),
        vars: buildEmailVars(saved),
      });
      const res = await imsQuotations.sendEmail({
        to: emailTo.trim(),
        cc: emailCc.trim(),
        replyTo: emailReplyTo.trim(),
        subject: emailSubject.trim(),
        message: emailTemplate.trim(),
        html: built.html,
        templateId,
        quotationId: saved.id,
        quoteNo: saved.quoteNo,
        filename,
        pdfBase64,
        fromName: company.name,
        fromEmail: company.email,
      });
      setEmailOpen(false);
      if (res.delivered) {
        toast.show({ tone: "emerald", title: `Email sent to ${emailTo.trim()}` });
      } else {
        forceDownloadPdf(filename, pdfBase64);
        window.open(buildMailtoHref({ to: emailTo.trim(), cc: emailCc.trim(), subject: emailSubject.trim(), body: emailTemplate.trim() }), "_blank");
        toast.show({ tone: "blue", title: res.hint || "Saved to Email Outbox and opened mail client." });
      }
    } catch (err) {
      toast.show({ tone: "coral", title: err instanceof Error ? err.message : "Email send failed" });
    } finally {
      setEmailSending(false);
    }
  };

  const openWhatsappDialog = async () => {
    const saved = quote.quoteNo ? quote : await saveQuote();
    if (!saved) return;
    const defaultMsg = fillSendTemplate(sendSettings.whatsappMessage || DEFAULT_WHATSAPP_MESSAGE, {
      customer: saved.customer.name || saved.customer.company || "Customer",
      quoteNo: saved.quoteNo || "",
      amount: `₹${money(totals.grand)}`,
      company: company.name,
      approvalUrl,
    });
    setWaPhones(saved.customer.phone || "");
    setWaMsg(defaultMsg);
    setWaOpen(true);
  };

  const handleSendWhatsapp = async () => {
    const phones = waPhones
      .split(/[,;\s]+/)
      .map(waDigits)
      .filter((p) => p.length >= 10);
    if (!phones.length) {
      toast.show({ tone: "coral", title: "Enter at least one valid WhatsApp number" });
      return;
    }
    setWaSending(true);
    try {
      const saved = await saveQuote("sent", `Sent via WhatsApp to ${phones.join(", ")}`);
      if (!saved) return;
      const pdfBase64 = await generatePdfBase64(saved);
      const filename = `${(saved.quoteNo || "quotation").replace(/[^A-Za-z0-9_-]+/g, "_")}.pdf`;
      const res = await imsQuotations.sendWhatsapp({
        phones,
        message: waMsg.trim(),
        filename,
        pdfBase64,
        quotationId: saved.id,
        quoteNo: saved.quoteNo,
      });
      setWaOpen(false);
      if (res.delivered) {
        toast.show({ tone: "emerald", title: `WhatsApp PDF sent to ${phones.join(", ")}` });
      } else {
        forceDownloadPdf(filename, pdfBase64);
        window.open(`https://wa.me/${phones[0]}?text=${encodeURIComponent(waMsg.trim())}`, "_blank", "noopener,noreferrer");
        toast.show({ tone: "blue", title: "Downloaded PDF and opened WhatsApp Web — attach the PDF and send." });
      }
    } catch (err) {
      toast.show({ tone: "coral", title: err instanceof Error ? err.message : "WhatsApp send failed" });
    } finally {
      setWaSending(false);
    }
  };

  const engagementsForCat = CATEGORY_ENGAGEMENTS[quote.category] ?? ["sale"];

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* Top Action Bar */}
      <Card interactive={false} className="ims-q-no-print">
        <div className="ims-between" style={{ flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="ims-mono ims-strong" style={{ fontSize: 15 }}>
              {quote.quoteNo || "New Quotation"}
            </span>
            <Badge tone={quote.status === "approved" ? "emerald" : quote.status === "rejected" ? "coral" : quote.status === "sent" ? "amber" : "blue"}>
              {quote.status}
            </Badge>
            {quote.revision && quote.revision > 1 ? <Badge tone="neutral">Rev R{quote.revision}</Badge> : null}
            {quote.conversions?.salesOrderId ? (
              <Button size="sm" variant="ghost" onClick={() => navigate("salesOrders", `open:${quote.conversions!.salesOrderId}`)}>
                SO {quote.conversions.salesOrderNo ?? "View"} ↗
              </Button>
            ) : null}
            {quote.conversions?.invoiceId ? (
              <Button size="sm" variant="ghost" onClick={() => navigate("sales", `open:${quote.conversions!.invoiceId}`)}>
                INV {quote.conversions.invoiceNo ?? "View"} ↗
              </Button>
            ) : null}
            {quote.conversions?.bomId ? (
              <Button size="sm" variant="ghost" onClick={() => navigate("bom", quote.conversions!.bomId!)}>
                BOM {quote.conversions.bomDocNo ?? "View"} ↗
              </Button>
            ) : null}
          </div>

          <div className="ims-q-actions-bar">
            <Button size="sm" variant="ghost" onClick={onNew}>
              + New
            </Button>
            <Button size="sm" variant="primary" disabled={saving} onClick={() => void saveQuote()}>
              {saving ? "Saving…" : quote.quoteNo ? "Save changes" : "Save draft"}
            </Button>
            {quote.status === "draft" ? (
              <Button size="sm" variant="secondary" disabled={saving} onClick={() => void saveQuote("submitted", "Submitted")}>
                Submit
              </Button>
            ) : null}
            {quote.status !== "approved" ? (
              <Button size="sm" variant="secondary" disabled={saving} onClick={() => void saveQuote("approved", "Marked approved")}>
                Approve
              </Button>
            ) : null}
            {quote.quoteNo ? (
              <Button size="sm" variant="ghost" disabled={saving} onClick={() => onRevise(quote)}>
                Revise (R{(quote.revision ?? 1) + 1})
              </Button>
            ) : null}
            <Button size="sm" variant="secondary" disabled={exporting} onClick={() => void handleDownloadPdf()}>
              {exporting ? "PDF…" : "PDF"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => window.print()}>
              Print
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void openEmailDialog()}>
              Email
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void openWhatsappDialog()}>
              WhatsApp
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void copyApprovalLink()}>
              Approval Link
            </Button>
          </div>
        </div>

        {/* IMS-Native 1-Click Conversions */}
        {quote.quoteNo ? (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--bos-border, #e2e8f0)", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--bos-muted)", fontWeight: 600 }}>Convert inside IMS:</span>
            {canSales ? (
              <>
                <Button size="sm" variant="secondary" onClick={() => onConvert(quote, "sales_order")}>
                  → Sales Order
                </Button>
                <Button size="sm" variant="secondary" onClick={() => onConvert(quote, "proforma")}>
                  → Proforma Invoice
                </Button>
                <Button size="sm" variant="secondary" onClick={() => onConvert(quote, "invoice")}>
                  → Draft Tax Invoice
                </Button>
              </>
            ) : null}
            {canBom ? (
              <Button size="sm" variant="secondary" onClick={() => onConvert(quote, "bom")}>
                → Customer BOM
              </Button>
            ) : null}
          </div>
        ) : null}
      </Card>

      {/* Main Split: Composer (Left) + Exact V1 Live Preview Sheet (Right) */}
      <div className="ims-q-split">
        <div style={{ display: "grid", gap: 14 }} className="ims-q-no-print">
          {/* 1. Category, Engagement & Dates */}
          <Card interactive={false}>
            <div style={{ display: "grid", gap: 12 }}>
              <b style={{ fontSize: 14 }}>Quotation details</b>
              <FormGrid>
                <Field label="Category">
                  {({ id }) => (
                    <Select id={id} value={quote.category} onChange={(e) => setCategory(e.target.value as CategoryKey)}>
                      {(Object.keys(CATEGORIES) as CategoryKey[]).map((k) => (
                        <option key={k} value={k}>
                          {CATEGORIES[k].label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="For (Engagement)">
                  {({ id }) => (
                    <Select id={id} value={quote.engagement} onChange={(e) => setEngagement(e.target.value as EngagementKey)}>
                      {engagementsForCat.map((eng) => (
                        <option key={eng} value={eng}>
                          {engMeta(quote.category, eng).label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                {quote.category === "other" ? (
                  <Field label="Custom category label">
                    {({ id }) => (
                      <Input
                        id={id}
                        value={quote.categoryCustomLabel}
                        placeholder="e.g. CCTV / Networking"
                        onChange={(e) => setField("categoryCustomLabel", e.target.value)}
                      />
                    )}
                  </Field>
                ) : null}
                <Field label="Quotation Date">
                  {({ id }) => <Input id={id} type="date" value={quote.date} onChange={(e) => setField("date", e.target.value)} />}
                </Field>
                <Field label="Valid Till">
                  {({ id }) => <Input id={id} type="date" value={quote.validTill} onChange={(e) => setField("validTill", e.target.value)} />}
                </Field>
                <Field label="Follow-up Date" hint="Triggers daily reminder">
                  {({ id }) => <Input id={id} type="date" value={quote.followUpDate} onChange={(e) => setField("followUpDate", e.target.value)} />}
                </Field>
              </FormGrid>
            </div>
          </Card>

          {/* 2. Customer (Shared Party Registry Suggest) */}
          <Card interactive={false}>
            <div style={{ display: "grid", gap: 12 }}>
              <b style={{ fontSize: 14 }}>Customer</b>
              <FormGrid>
                <Field label="Customer Name *">
                  {() => (
                    <CustomerNameSuggest
                      value={quote.customer.name}
                      suggestions={customerSuggestions}
                      open={suggestOpen}
                      activeIndex={suggestIdx}
                      onOpenChange={setSuggestOpen}
                      onActiveIndexChange={setSuggestIdx}
                      onValueChange={(val) => {
                        setCustomer("name", val);
                        setSuggestOpen(true);
                        setSuggestIdx(0);
                      }}
                      onSelect={(s) => {
                        const c = customerFromSuggestion(s);
                        onChange({ ...quote, partyId: s.partyId ?? quote.partyId, customer: c });
                        setSuggestOpen(false);
                      }}
                    />
                  )}
                </Field>
                <Field label="Company / Firm">
                  {({ id }) => <Input id={id} value={quote.customer.company} onChange={(e) => setCustomer("company", e.target.value)} />}
                </Field>
                <Field label="Phone *">
                  {({ id }) => <Input id={id} value={quote.customer.phone} onChange={(e) => setCustomer("phone", e.target.value)} />}
                </Field>
                <Field label="Email">
                  {({ id }) => <Input id={id} type="email" value={quote.customer.email} onChange={(e) => setCustomer("email", e.target.value)} />}
                </Field>
                <Field label="GSTIN">
                  {({ id }) => (
                    <Input
                      id={id}
                      value={quote.customer.gstin}
                      maxLength={15}
                      onChange={(e) => setCustomer("gstin", e.target.value.toUpperCase())}
                    />
                  )}
                </Field>
                <Field label="City">
                  {({ id }) => <Input id={id} value={quote.customer.city} onChange={(e) => setCustomer("city", e.target.value)} />}
                </Field>
                <Field label="State">
                  {({ id }) => (
                    <Select id={id} value={quote.customer.state} onChange={(e) => setCustomer("state", e.target.value)}>
                      <option value="">Select state…</option>
                      {INDIAN_STATES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Address">
                  {({ id }) => <Input id={id} value={quote.customer.address} onChange={(e) => setCustomer("address", e.target.value)} />}
                </Field>
              </FormGrid>
            </div>
          </Card>

          {/* 3. Line Items (Hybrid: IMS Catalog + V1 Templates + Buyback + Reverse Calc) */}
          <Card interactive={false}>
            <div style={{ display: "grid", gap: 10 }}>
              <div className="ims-between" style={{ flexWrap: "wrap", gap: 8 }}>
                <b style={{ fontSize: 14 }}>Line items</b>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <Button size="sm" variant="primary" onClick={() => setItemPickerOpen(true)}>
                    + Pick IMS Item
                  </Button>
                  <Button size="sm" variant="secondary" onClick={loadTemplateLines}>
                    Load V1 Template
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => addBlankLine(false)}>
                    + Free Line
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => addBlankLine(true)}>
                    + Buyback (−)
                  </Button>
                </div>
              </div>

              <div style={{ overflowX: "auto" }}>
                <table className="ims-q-line-table">
                  <thead>
                    <tr>
                      <th style={{ minWidth: 200 }}>Description</th>
                      <th style={{ width: 80 }}>HSN</th>
                      <th style={{ width: 64 }}>Unit</th>
                      <th style={{ width: 64 }}>Qty</th>
                      <th style={{ width: 92 }}>Rate (₹)</th>
                      <th style={{ width: 64 }}>Disc %</th>
                      <th style={{ width: 64 }}>GST %</th>
                      <th style={{ width: 76 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((it, idx) => {
                      const stock = it.itemId ? stockByItem[it.itemId] : undefined;
                      const qtyNum = Number(it.qty) || 0;
                      const stockClass = !stock
                        ? ""
                        : stock.free <= 0
                          ? "ims-q-stock-out"
                          : stock.free < qtyNum
                            ? "ims-q-stock-low"
                            : "ims-q-stock-ok";
                      return (
                        <tr key={it.id || idx}>
                          <td>
                            <Input
                              value={it.desc}
                              placeholder="Item / service description"
                              onChange={(e) => updateLine(idx, { desc: e.target.value })}
                            />
                            {stock ? (
                              <span className={`ims-q-stock-pill ${stockClass}`}>
                                {stock.free > 0 ? `${stock.free} ${stock.unit} free` : `Out of stock (${stock.currentStock} on hand)`}
                              </span>
                            ) : null}
                          </td>
                          <td>
                            <Input value={it.hsn ?? ""} placeholder="HSN" onChange={(e) => updateLine(idx, { hsn: e.target.value })} />
                          </td>
                          <td>
                            <Input value={it.unit ?? "nos"} onChange={(e) => updateLine(idx, { unit: e.target.value })} />
                          </td>
                          <td>
                            <Input
                              value={String(it.qty ?? "")}
                              onChange={(e) => updateLine(idx, { qty: sanitizeNumStr(e.target.value) })}
                            />
                          </td>
                          <td>
                            <Input
                              value={String(it.rate ?? "")}
                              placeholder="0.00"
                              onChange={(e) => updateLine(idx, { rate: sanitizeSignedNumStr(e.target.value) })}
                            />
                          </td>
                          <td>
                            <Input
                              value={String(it.discount ?? "")}
                              onChange={(e) => updateLine(idx, { discount: sanitizeNumStr(e.target.value) })}
                            />
                          </td>
                          <td>
                            <Input
                              value={String(it.gst ?? "")}
                              onChange={(e) => updateLine(idx, { gst: sanitizeNumStr(e.target.value) })}
                            />
                          </td>
                          <td>
                            <div style={{ display: "flex", gap: 4 }}>
                              <Button
                                size="sm"
                                variant="ghost"
                                title="Reverse-calculate rate from GST-inclusive total"
                                onClick={() => setReverseIdx(idx)}
                              >
                                ₹
                              </Button>
                              <Button size="sm" variant="ghost" title="Remove line" onClick={() => removeLine(idx)}>
                                ✕
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Extra charge + GST Override + Display Toggles */}
              <FormGrid>
                <Field label="Extra Charge Label">
                  {({ id }) => (
                    <Input
                      id={id}
                      value={quote.extraCharge?.label ?? ""}
                      placeholder="e.g. Freight / Installation"
                      onChange={(e) => setField("extraCharge", { ...quote.extraCharge, label: e.target.value })}
                    />
                  )}
                </Field>
                <Field label="Extra Charge Amount (₹)">
                  {({ id }) => (
                    <Input
                      id={id}
                      value={String(quote.extraCharge?.amount ?? "")}
                      onChange={(e) => setField("extraCharge", { ...quote.extraCharge, amount: sanitizeNumStr(e.target.value) })}
                    />
                  )}
                </Field>
                <Field label="Extra Charge GST %">
                  {({ id }) => (
                    <Input
                      id={id}
                      value={String(quote.extraCharge?.gst ?? 18)}
                      onChange={(e) => setField("extraCharge", { ...quote.extraCharge, gst: sanitizeNumStr(e.target.value) })}
                    />
                  )}
                </Field>
                <Field label="GST Mode">
                  {({ id }) => (
                    <Select
                      id={id}
                      value={quote.gstOverride?.mode ?? "auto"}
                      onChange={(e) =>
                        setField("gstOverride", {
                          ...quote.gstOverride,
                          mode: e.target.value === "manual" ? "manual" : "auto",
                        })
                      }
                    >
                      <option value="auto">Auto (per line GST)</option>
                      <option value="manual">Manual GST % override</option>
                    </Select>
                  )}
                </Field>
                {quote.gstOverride?.mode === "manual" ? (
                  totals.interState ? (
                    <Field label="Manual IGST %">
                      {({ id }) => (
                        <Input
                          id={id}
                          value={String(quote.gstOverride.igst ?? "")}
                          onChange={(e) => setField("gstOverride", { ...quote.gstOverride, igst: sanitizeNumStr(e.target.value) })}
                        />
                      )}
                    </Field>
                  ) : (
                    <>
                      <Field label="Manual CGST %">
                        {({ id }) => (
                          <Input
                            id={id}
                            value={String(quote.gstOverride.cgst ?? "")}
                            onChange={(e) => setField("gstOverride", { ...quote.gstOverride, cgst: sanitizeNumStr(e.target.value) })}
                          />
                        )}
                      </Field>
                      <Field label="Manual SGST %">
                        {({ id }) => (
                          <Input
                            id={id}
                            value={String(quote.gstOverride.sgst ?? "")}
                            onChange={(e) => setField("gstOverride", { ...quote.gstOverride, sgst: sanitizeNumStr(e.target.value) })}
                          />
                        )}
                      </Field>
                    </>
                  )
                ) : null}
              </FormGrid>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                  <Checkbox
                    checked={showGstCols}
                    onChange={(checked) => setField("showGstColumns", checked)}
                  />
                  <span>Show GST% &amp; GST Amount columns on PDF / preview</span>
                </label>
              </div>

              <FormGrid>
                <Field label="GST Note (printed beside totals)">
                  {({ id }) => (
                    <Input
                      id={id}
                      value={quote.gstNote ?? DEFAULT_GST_NOTE}
                      onChange={(e) => setField("gstNote", e.target.value)}
                    />
                  )}
                </Field>
                <Field label="Buyback Row Label">
                  {({ id }) => (
                    <Input
                      id={id}
                      value={quote.buybackLabel ?? DEFAULT_BUYBACK_LABEL}
                      onChange={(e) => setField("buybackLabel", e.target.value)}
                    />
                  )}
                </Field>
              </FormGrid>

              {/* Totals Summary */}
              <div className="ims-q-totals-box">
                <div className="ims-q-totals-row">
                  <span>Subtotal</span>
                  <span className="ims-mono">₹{money(totals.subtotal)}</span>
                </div>
                {totals.totalGst > 0 ? (
                  <div className="ims-q-totals-row">
                    <span>Total GST ({totals.interState ? "IGST" : "CGST + SGST"})</span>
                    <span className="ims-mono">₹{money(totals.totalGst)}</span>
                  </div>
                ) : null}
                {totals.oldBuybackLess < 0 ? (
                  <div className="ims-q-totals-row">
                    <span>{quote.buybackLabel || DEFAULT_BUYBACK_LABEL}</span>
                    <span className="ims-mono">−₹{money(Math.abs(totals.oldBuybackLess))}</span>
                  </div>
                ) : null}
                <div className="ims-q-totals-row ims-q-totals-grand">
                  <span>Grand Total</span>
                  <span className="ims-mono">₹{money(totals.grand)}</span>
                </div>
              </div>
            </div>
          </Card>

          {/* 4. Terms & Signature */}
          <Card interactive={false}>
            <div style={{ display: "grid", gap: 12 }}>
              <div className="ims-between">
                <b style={{ fontSize: 14 }}>Terms &amp; Sign-off</b>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setField("notes", buildTerms(quote.category, quote.engagement, profileTerms))}
                >
                  Reset to default terms
                </Button>
              </div>
              <Textarea rows={6} value={quote.notes} onChange={(e) => setField("notes", e.target.value)} />

              {signatureLocked ? (
                <Alert tone="amber" title="Creator signature locked">
                  Prepared By is locked to the original creator ({quote.preparedBy}).{" "}
                  {isOwner ? "As Owner, check below to force an override." : "Only the Business Owner can override it."}
                </Alert>
              ) : null}

              <FormGrid>
                <Field label="Prepared By *">
                  {({ id }) => (
                    <Input
                      id={id}
                      disabled={signatureLocked && !forceSignature}
                      value={quote.preparedBy}
                      onChange={(e) => setField("preparedBy", e.target.value)}
                    />
                  )}
                </Field>
                <Field label="Prepared By Phone">
                  {({ id }) => (
                    <Input
                      id={id}
                      disabled={signatureLocked && !forceSignature}
                      value={quote.preparedByPhone ?? ""}
                      onChange={(e) => setField("preparedByPhone", e.target.value)}
                    />
                  )}
                </Field>
                <Field label="Prepared By Email">
                  {({ id }) => (
                    <Input
                      id={id}
                      type="email"
                      disabled={signatureLocked && !forceSignature}
                      value={quote.preparedByEmail ?? ""}
                      onChange={(e) => setField("preparedByEmail", e.target.value)}
                    />
                  )}
                </Field>
              </FormGrid>

              {signatureLocked && isOwner ? (
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                  <Checkbox
                    checked={forceSignature}
                    onChange={setForceSignature}
                  />
                  <span>Owner override: force-update creator signature (recorded in audit trail)</span>
                </label>
              ) : null}
            </div>
          </Card>
        </div>

        {/* Right: Exact V1 Live Preview Sheet */}
        <div className="ims-q-preview-sticky">
          <div ref={sheetRef}>
            <QuoteSheet quote={quote} company={company} />
          </div>
        </div>
      </div>

      {/* IMS Item Picker Dialog */}
      <ItemPickerDialog
        open={itemPickerOpen}
        onClose={() => setItemPickerOpen(false)}
        onPick={addCatalogItem}
        price="selling"
        title="Add item from IMS catalog"
        allowCreate
      />

      {/* Reverse Line Amount Calculator Modal (exact V1 parity) */}
      {reverseIdx != null && lines[reverseIdx] ? (
        <LineAmountReverseModal
          open
          item={lines[reverseIdx]}
          onClose={() => setReverseIdx(null)}
          onApply={(next) => {
            updateLine(reverseIdx, { rate: next.rate, gst: next.gst });
            setReverseIdx(null);
          }}
        />
      ) : null}

      {/* Email Compose Modal */}
      {emailOpen ? (
        <SendViaEmailComposeModal
          formatId={normalizeQuotationEmailTemplateId(
            quoteSettings.defaultEmailTemplateId || sendSettings.email?.templateId,
          )}
          deliveryHint={
            emailWebhookConfigured
              ? "Will deliver directly with PDF attached via your configured Email Webhook."
              : "No Email Webhook configured — saves to Email Outbox, downloads PDF, and opens your mail client."
          }
          attachmentNote={`Attaches ${(quote.quoteNo || "quotation")}.pdf`}
          to={emailTo}
          onToChange={setEmailTo}
          cc={emailCc}
          onCcChange={setEmailCc}
          subject={emailSubject}
          onSubjectChange={setEmailSubject}
          replyTo={emailReplyTo}
          onReplyToChange={setEmailReplyTo}
          messageTemplate={emailTemplate}
          onMessageTemplateChange={setEmailTemplate}
          previewText={emailTemplate}
          previewHtml={null}
          busy={emailSending}
          onClose={() => setEmailOpen(false)}
          onSend={() => void handleSendEmail()}
        />
      ) : null}

      {/* WhatsApp Send Dialog */}
      <Dialog
        open={waOpen}
        onClose={() => setWaOpen(false)}
        title="Send Quotation on WhatsApp"
        description={
          whatsappAutoAttach
            ? "Delivers PDF automatically via your configured WhatsApp integration."
            : "Downloads the PDF and opens WhatsApp Web with your message pre-filled."
        }
        actions={
          <>
            <Button variant="ghost" onClick={() => setWaOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={waSending} onClick={() => void handleSendWhatsapp()}>
              {waSending ? "Sending…" : "Send on WhatsApp"}
            </Button>
          </>
        }
      >
        <div style={{ display: "grid", gap: 12 }}>
          <Field label="WhatsApp Number(s)" hint="Comma-separated 10-digit Indian numbers or with country code">
            {({ id }) => <Input id={id} value={waPhones} onChange={(e) => setWaPhones(e.target.value)} />}
          </Field>
          {sendSettings.whatsappNumbers?.length ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {sendSettings.whatsappNumbers.map((entry) => (
                <Button
                  key={entry.id}
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setWaPhones((prev) => (prev.trim() ? `${prev.trim()}, ${entry.phone}` : entry.phone))
                  }
                >
                  + {entry.label || entry.phone}
                </Button>
              ))}
            </div>
          ) : null}
          <Field label="Message">
            {({ id }) => <Textarea id={id} rows={5} value={waMsg} onChange={(e) => setWaMsg(e.target.value)} />}
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
