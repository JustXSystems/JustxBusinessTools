"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { api, fetchProfile } from "@/lib/api";
import { flashAppError, flashAppOk } from "@/lib/app-flash";
import { publicAssetUrl, withBasePath, absolutePublicAssetUrl } from "@/lib/base-path";
import { useAuth } from "@/components/auth/AuthProvider";
import { useLiveRefresh, invalidateAdminData, invalidateLiveData } from "@/hooks/useLiveRefresh";
import {
  buildTerms,
  CATEGORIES,
  CATEGORY_ENGAGEMENTS,
  computeTotals,
  DEFAULT_COMPANY,
  DEFAULT_SEND_SETTINGS,
  DEFAULT_WHATSAPP_MESSAGE,
  engMeta,
  fillSendTemplate,
  getMissingRequiredFields,
  INDIAN_STATES,
  mergeCompanyFromBusinessProfile,
  money,
  newQuotationDraft,
  normalizeQuotation,
  normalizeSendSettings,
  numToWordsIndian,
  quotationPdfToBase64,
  renderPageBreakMarkers,
  sanitizeNumStr,
  sanitizeSignedNumStr,
  snapshotOf,
  templateItems,
  typeLabel,
  buildSavedQuoteListRow,
  exportSavedQuotationsExcel,
  exportSavedQuotationsPdf,
  filterSavedQuotations,
  countActiveSavedFilters,
  uniqueSavedCities,
  uniqueSavedPreparedBy,
  buildQuoteActivityTimeline,
  filterQuoteActivity,
  quoteActivityStats,
  EMPTY_SAVED_FILTERS,
  SAVED_STATUS_OPTIONS,
  type SavedQuoteFilters,
  type FollowUpFilter,
  type CategoryKey,
  type CompanyProfileV1,
  type EngagementKey,
  type QuotationV1,
  type QuoteHistoryRow,
  type QuoteNotification,
  type QuoteStatus,
} from "@/lib/quotation-v1";
import {
  resolveCorporateEmailMessage,
  type BusinessProfileSendSettings,
} from "@/lib/types/business-profile";
import {
  buildQuotationEmailBodies,
  normalizeQuotationEmailTemplateId,
  summarizeQuoteLineItems,
  type QuotationEmailTemplateId,
  type QuotationEmailVars,
} from "@/lib/quotation-email-templates";
import { deliverToolArtifact, pdfBase64ToBytes } from "@/lib/artifact-delivery";
import { buildMailtoHref } from "@/lib/mailto";
import { SendViaEmailComposeModal } from "@/components/send-via/SendViaEmailComposeModal";
import { ToolPageHero } from "@/components/shell/ToolPageHero";
import { QuoteSheet } from "./QuoteSheet";
import "./quotation-v1.css";

type Route = "new" | "list" | "notifications" | "history" | "company";
type SendChannel = "whatsapp" | "email";

function waDigits(raw: string) {
  let digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  // Strip leading 0 from Indian local numbers (e.g. 09876543210).
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

/** Force a real file download (Chrome often opens PDF blobs in a viewer otherwise). */
function pdfBase64ToUint8(pdfBase64: string) {
  const binary = atob(pdfBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function forceDownloadPdf(filename: string, pdfBase64: string) {
  const bytes = pdfBase64ToUint8(pdfBase64);
  const safeName = filename.toLowerCase().endsWith(".pdf") ? filename : `${filename}.pdf`;
  // octet-stream + download attr avoids inline PDF viewer on desktop browsers.
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = safeName;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  return new File([bytes], safeName, { type: "application/pdf" });
}

function whatsappChatUrl(phoneDigits: string, text: string) {
  // api.whatsapp.com is more reliable for ?text= prefill than wa.me after async UI work.
  return `https://api.whatsapp.com/send?phone=${encodeURIComponent(phoneDigits)}&text=${encodeURIComponent(text)}`;
}

function userDisplayName(user: { name?: string | null; email?: string } | null | undefined) {
  const name = (user?.name ?? "").trim();
  if (name) return name;
  const email = (user?.email ?? "").trim();
  if (email.includes("@")) return email.split("@")[0] || "";
  return email;
}

function previewQuoteNo(q: QuotationV1, company: CompanyProfileV1, counters: Record<string, number>) {
  if (q.quoteNo) return q.quoteNo;
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const key = `${q.category}-${q.engagement}-${yyyy}-${mm}`;
  const nextSeq = (counters[key] || 0) + 1;
  const seq = String(nextSeq).padStart(4, "0");
  const p = (company.quotePrefix || "QT").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "QT";
  return `${p}-${CATEGORIES[q.category].code}/${engMeta(q.category, q.engagement).code}-${yyyy}/${mm}-${seq}`;
}

export function QuotationGeneratorV1() {
  const { user } = useAuth();
  const [route, setRoute] = useState<Route>("new");
  const [company, setCompany] = useState<CompanyProfileV1>({ ...DEFAULT_COMPANY });
  const [sendSettings, setSendSettings] = useState<BusinessProfileSendSettings>(() =>
    normalizeSendSettings(null),
  );
  const [current, setCurrent] = useState<QuotationV1>(() => newQuotationDraft());
  const [list, setList] = useState<QuotationV1[]>([]);
  const [history, setHistory] = useState<QuoteHistoryRow[]>([]);
  const [notifications, setNotifications] = useState<QuoteNotification[]>([]);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendChannel, setSendChannel] = useState<SendChannel>("whatsapp");
  const [waSelected, setWaSelected] = useState<string[]>([]);
  const [waExtra, setWaExtra] = useState("");
  const [waMessage, setWaMessage] = useState("");
  const [waCanAutoAttach, setWaCanAutoAttach] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailCc, setEmailCc] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  const [emailMessageTemplate, setEmailMessageTemplate] = useState("");
  const [emailHtml, setEmailHtml] = useState<string | null>(null);
  const [emailTemplateId, setEmailTemplateId] = useState(() =>
    normalizeQuotationEmailTemplateId(DEFAULT_SEND_SETTINGS.email.templateId),
  );
  const [emailReplyTo, setEmailReplyTo] = useState("");
  const [emailFromName, setEmailFromName] = useState("");
  const [emailFromEmail, setEmailFromEmail] = useState("");
  const [approvalLink, setApprovalLink] = useState<string | null>(null);
  const [pdfHostQuote, setPdfHostQuote] = useState<QuotationV1 | null>(null);
  const [savedFilters, setSavedFilters] = useState<SavedQuoteFilters>(EMPTY_SAVED_FILTERS);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [activityQuery, setActivityQuery] = useState("");
  const sheetRef = useRef<HTMLDivElement>(null);
  const preparedBySeeded = useRef(false);

  useEffect(() => {
    if (!sendOpen || sendChannel !== "whatsapp") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [sendOpen, sendChannel]);

  const totals = useMemo(() => computeTotals(current, company), [current, company]);
  const pendingApprovals = list.filter((q) => q.status === "sent").length;
  const isSaved = Boolean(current.quoteNo && snapshotOf(current) === lastSaved);
  const filteredList = useMemo(
    () => filterSavedQuotations(list, company, savedFilters),
    [list, company, savedFilters],
  );
  const savedCityOptions = useMemo(() => uniqueSavedCities(list), [list]);
  const savedPreparedByOptions = useMemo(() => uniqueSavedPreparedBy(list), [list]);
  const activeFilterCount = useMemo(() => countActiveSavedFilters(savedFilters), [savedFilters]);
  const activityRows = useMemo(
    () => buildQuoteActivityTimeline(history, list),
    [history, list],
  );
  const filteredActivity = useMemo(
    () => filterQuoteActivity(activityRows, activityQuery),
    [activityRows, activityQuery],
  );
  const activityStats = useMemo(() => quoteActivityStats(activityRows), [activityRows]);

  const flash = useCallback((msg: string, kind = "ok") => {
    if (kind === "err") flashAppError(msg);
    else flashAppOk(msg);
  }, []);

  const reloadMeta = useCallback(async () => {
    const [c, h, n, q, profile] = await Promise.all([
      api<{ company: CompanyProfileV1 | null }>("/quotation-v1/company"),
      api<{ history: QuoteHistoryRow[] }>("/quotation-v1/history"),
      api<{ notifications: QuoteNotification[] }>("/quotation-v1/notifications"),
      api<{ quotations: QuotationV1[] }>("/quotation-v1"),
      fetchProfile().catch(() => null),
    ]);
    const stored = c.company ? { ...DEFAULT_COMPANY, ...c.company, logo: c.company.logo ?? null } : { ...DEFAULT_COMPANY };
    const merged = mergeCompanyFromBusinessProfile(stored, profile);
    setCompany(merged);
    setSendSettings(normalizeSendSettings(profile?.sendSettings ?? null));
    setHistory(h.history ?? []);
    setNotifications(n.notifications ?? []);
    setList((q.quotations ?? []).map((row) => normalizeQuotation(row)));
  }, []);

  useLiveRefresh(async () => {
    try {
      await reloadMeta();
    } catch (e) {
      flash(e instanceof Error ? e.message : "Failed to load", "err");
    }
  }, { intervalMs: 45_000, deps: [user?.businessProfileId] });

  useEffect(() => {
    const name = userDisplayName(user);
    if (!name || preparedBySeeded.current) return;
    preparedBySeeded.current = true;
    setCurrent((q) => {
      if (q.quoteNo || q.preparedBy.trim()) return q;
      return { ...q, preparedBy: name };
    });
  }, [user]);

  function patch(updater: (q: QuotationV1) => QuotationV1) {
    setCurrent((q) => updater({ ...q }));
  }

  function switchType(category: CategoryKey, engagement: EngagementKey) {
    if (current.status !== "draft" && current.quoteNo) {
      flash("This quotation is already saved/sent. Create a new one to change its type.", "err");
      return;
    }
    const allowed = CATEGORY_ENGAGEMENTS[category];
    const eng = allowed.includes(engagement) ? engagement : allowed[0];
    setCurrent((q) => ({
      ...q,
      category,
      engagement: eng,
      categoryCustomLabel: category !== "other" ? "" : q.categoryCustomLabel,
      items: templateItems(category, eng),
      notes: buildTerms(category, eng),
      gstOverride: { mode: "manual", cgst: 0, sgst: 0, igst: null },
    }));
  }

  async function saveQuote(markStatus?: QuotationV1["status"]) {
    const missing = getMissingRequiredFields(current);
    if (missing.length) {
      flash(`Please fill in before continuing: ${missing.join(", ")}.`, "err");
      return null;
    }
    if (current.quoteNo && snapshotOf(current) === lastSaved && !markStatus) {
      flash(`No changes since last save — ${current.quoteNo} is already up to date.`);
      return current;
    }
    setBusy(true);
    try {
      const payload: QuotationV1 = {
        ...current,
        status: markStatus ?? current.status,
        companySnapshot: company,
        history: markStatus
          ? [...current.history, { ts: new Date().toISOString(), event: `Status set to ${markStatus}` }]
          : current.history,
      };
      const isCreate = !current.quoteNo;
      const historyAction = isCreate
        ? "create"
        : markStatus
          ? `status:${markStatus}`
          : "update";
      const data = await api<{ quotation: QuotationV1 }>("/quotation-v1", {
        method: "POST",
        body: JSON.stringify({
          quotation: {
            ...payload,
            _catCode: CATEGORIES[payload.category].code,
            _engCode: engMeta(payload.category, payload.engagement).code,
          },
          grandTotal: computeTotals(payload, company).grand,
          historyAction,
        }),
      });
      const saved = data.quotation;
      setCurrent(saved);
      setLastSaved(snapshotOf(saved));
      if (!markStatus) {
        flash(`Saved as ${saved.quoteNo}.`);
      } else if (markStatus === "submitted") {
        flash(`Status set to submitted — ${saved.quoteNo}.`);
      }
      invalidateAdminData("quotation-v1");
      await reloadMeta();
      return saved;
    } catch (e) {
      flash(e instanceof Error ? e.message : "Save failed", "err");
      return null;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (route !== "new") return;
    const node = document.getElementById("quote-sheet");
    if (!node) return;
    const timer = window.setTimeout(() => {
      renderPageBreakMarkers(node, current);
    }, 60);
    return () => {
      window.clearTimeout(timer);
      node.querySelectorAll(".page-break-marker").forEach((m) => m.remove());
    };
  }, [route, current, company, totals]);

  async function buildPdfPayload(
    q: QuotationV1,
    opts?: { requireClean?: boolean },
  ): Promise<{ filename: string; pdfBase64: string } | null> {
    if (!validateSaved(q, opts)) return null;
    await new Promise((r) => setTimeout(r, 40));
    const node = document.getElementById("quote-sheet");
    if (!node) throw new Error("Preview not ready");
    const fit = node.closest(".qgv1-preview-fit");
    fit?.classList.add("is-exporting");
    try {
      // Refresh markers after forced export width so geometry matches the PDF.
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
      renderPageBreakMarkers(node, q);
      return await quotationPdfToBase64(q, company);
    } finally {
      fit?.classList.remove("is-exporting");
      // Restore preview markers at live layout width.
      window.setTimeout(() => {
        const live = document.getElementById("quote-sheet");
        if (live) renderPageBreakMarkers(live, q);
      }, 40);
    }
  }

  /** Local PDF download only — does not push to Company document delivery. */
  async function downloadPdf(q: QuotationV1, opts?: { requireClean?: boolean }) {
    setBusy(true);
    const normalized = normalizeQuotation(q);
    const sheetLive =
      route === "new" && current.id === normalized.id
        ? document.getElementById("quote-sheet")
        : null;
    try {
      if (!sheetLive) {
        flushSync(() => {
          setPdfHostQuote(normalized);
        });
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            window.setTimeout(() => resolve(), 60);
          });
        });
      }
      const payload = await buildPdfPayload(normalized, {
        requireClean: opts?.requireClean ?? false,
      });
      if (!payload) return;
      forceDownloadPdf(payload.filename, payload.pdfBase64);
      flash(`Downloaded ${payload.filename}.`);
    } catch (e) {
      flash(e instanceof Error ? e.message : "PDF download failed", "err");
    } finally {
      setPdfHostQuote(null);
      setBusy(false);
    }
  }

  /** Save as submitted and deliver a copy per Company document delivery (no local download). */
  async function submitQuote() {
    const saved = await saveQuote("submitted");
    if (!saved) return;
    setBusy(true);
    try {
      const payload = await buildPdfPayload(saved, { requireClean: false });
      if (!payload) return;
      const result = await deliverToolArtifact({
        toolId: "quotation-v1",
        filename: payload.filename.toLowerCase().endsWith(".pdf")
          ? payload.filename
          : `${payload.filename}.pdf`,
        bytes: pdfBase64ToBytes(payload.pdfBase64),
        mimeType: "application/pdf",
        companyOnly: true,
        meta: { quoteNo: saved.quoteNo, quotationId: saved.id, status: "submitted" },
      });
      const summary = result.message || "Submitted.";
      await pushNotif(
        saved.id,
        result.cloudOk
          ? `Quotation ${saved.quoteNo} submitted — ${summary}`
          : `Quotation ${saved.quoteNo} submitted, but company delivery failed — ${summary}`,
      );
      flash(
        result.cloudOk
          ? `Submitted. ${summary}`
          : `Submitted, but delivery failed. ${summary}`,
        result.cloudOk === false ? "err" : undefined,
      );
    } catch (e) {
      flash(e instanceof Error ? e.message : "Submit failed", "err");
    } finally {
      setBusy(false);
    }
  }

  function validateSaved(q: QuotationV1, opts?: { requireClean?: boolean }) {
    const missing = getMissingRequiredFields(q);
    if (missing.length) {
      flash(`Please fill in before continuing: ${missing.join(", ")}.`, "err");
      return false;
    }
    if (!q.quoteNo) {
      flash("Please Save this quotation first.", "err");
      return false;
    }
    const requireClean = opts?.requireClean !== false;
    if (requireClean && snapshotOf(q) !== lastSaved) {
      flash("Please Save this quotation first — pending edits must be saved.", "err");
      return false;
    }
    return true;
  }

  function messageVars(q: QuotationV1): QuotationEmailVars {
    const t = computeTotals(q, company);
    const quoteLink =
      typeof window !== "undefined" && q.approvalToken
        ? `${window.location.origin}${withBasePath(`/q/${q.approvalToken}`)}`
        : "";
    const address = [company.address, company.state].filter(Boolean).join(", ");
    const { lineItems, moreItemsCount } = summarizeQuoteLineItems(q.items);
    const placeholders: Record<string, string> = {
      customerName: q.customer.name || "Customer",
      quoteNo: q.quoteNo || "",
      typeLabel: typeLabel(q),
      date: q.date,
      validTill: q.validTill,
      grandTotal: money(t.grand),
      grandTotalWords: numToWordsIndian(t.grand),
      companyName: company.name,
      companyPhone: company.phone,
      companyEmail: company.email || "",
      companyAddress: address,
      companyGstin: company.gstin || "",
      quoteLink,
      LoggedinUserName: userDisplayName(user),
      LogginUserPhonenumber: (user?.phone ?? "").trim(),
    };
    return {
      customerName: placeholders.customerName,
      quoteNo: placeholders.quoteNo,
      typeLabel: placeholders.typeLabel,
      date: placeholders.date,
      validTill: placeholders.validTill,
      grandTotal: placeholders.grandTotal,
      grandTotalWords: placeholders.grandTotalWords,
      companyName: placeholders.companyName,
      companyPhone: placeholders.companyPhone,
      companyEmail: placeholders.companyEmail,
      companyAddress: placeholders.companyAddress,
      companyGstin: placeholders.companyGstin,
      quoteLink: placeholders.quoteLink,
      LoggedinUserName: placeholders.LoggedinUserName,
      LogginUserPhonenumber: placeholders.LogginUserPhonenumber,
      logoUrl: company.logo
        ? absolutePublicAssetUrl(
            company.logo,
            typeof window !== "undefined" ? window.location.origin : "",
          )
        : "",
      accentColor: company.documentAccentColor || "",
      lineItems,
      moreItemsCount,
    };
  }

  function buildEmailBodiesFromTemplate(
    q: QuotationV1,
    templateId: QuotationEmailTemplateId,
    messageTemplate: string,
  ) {
    const send = normalizeSendSettings(sendSettings);
    const vars = messageVars(q);
    return buildQuotationEmailBodies({
      templateId,
      vars,
      customPlainMessage:
        templateId === "plain"
          ? messageTemplate
          : send.email.message || DEFAULT_SEND_SETTINGS.email.message,
      customCorporateMessage:
        templateId === "corporate"
          ? messageTemplate
          : resolveCorporateEmailMessage(send.email),
    });
  }

  function emailPlaceholders(vars: QuotationEmailVars): Record<string, string> {
    return {
      customerName: vars.customerName,
      quoteNo: vars.quoteNo,
      typeLabel: vars.typeLabel,
      date: vars.date,
      validTill: vars.validTill,
      grandTotal: vars.grandTotal,
      grandTotalWords: vars.grandTotalWords,
      companyName: vars.companyName,
      companyPhone: vars.companyPhone,
      companyEmail: vars.companyEmail || "",
      companyAddress: vars.companyAddress || "",
      companyGstin: vars.companyGstin || "",
      quoteLink: vars.quoteLink || "",
      LoggedinUserName: userDisplayName(user),
      LogginUserPhonenumber: (user?.phone ?? "").trim(),
    };
  }

  function buildWhatsAppText(q: QuotationV1) {
    const send = normalizeSendSettings(sendSettings);
    const vars = messageVars(q);
    const tpl =
      send.whatsappMessage?.trim() ||
      DEFAULT_WHATSAPP_MESSAGE ||
      send.email.message ||
      DEFAULT_SEND_SETTINGS.email.message;
    return fillSendTemplate(tpl, emailPlaceholders(vars));
  }

  async function openSendModal(channel: SendChannel) {
    const missing = getMissingRequiredFields(current);
    if (missing.length) {
      flash(`Please fill in before continuing: ${missing.join(", ")}.`, "err");
      return;
    }
    // Persist first so the public /q/{token} link resolves for corporate CTA.
    const saved = await saveQuote();
    if (!saved?.approvalToken) {
      flash("Could not prepare a public quotation link. Please Save and try again.", "err");
      return;
    }
    const send = normalizeSendSettings(sendSettings);
    const vars = messageVars(saved);
    const ph = emailPlaceholders(vars);
    const customerPhone = saved.customer.phone.replace(/\D/g, "");
    const defaults = [
      ...(customerPhone ? [`customer:${customerPhone}`] : []),
      ...send.whatsappNumbers.filter((n) => n.phone).map((n) => n.id),
    ];
    setWaSelected(defaults);
    setWaExtra("");
    setWaMessage(
      fillSendTemplate(send.whatsappMessage?.trim() || DEFAULT_WHATSAPP_MESSAGE, ph),
    );
    setEmailTo(send.email.to.trim() || saved.customer.email || "");
    const ccConfigured = send.email.cc.trim();
    setEmailCc(
      ccConfigured ||
        [company.salesEmail, company.managerEmail].filter(Boolean).join(", "),
    );
    setEmailSubject(
      fillSendTemplate(send.email.subject || DEFAULT_SEND_SETTINGS.email.subject, ph),
    );
    const templateId = normalizeQuotationEmailTemplateId(send.email.templateId);
    setEmailTemplateId(templateId);
    const messageTemplate =
      templateId === "corporate"
        ? resolveCorporateEmailMessage(send.email)
        : send.email.message || DEFAULT_SEND_SETTINGS.email.message;
    setEmailMessageTemplate(messageTemplate);
    const bodies = buildEmailBodiesFromTemplate(saved, templateId, messageTemplate);
    setEmailMessage(bodies.text);
    setEmailHtml(bodies.html ?? null);
    const replyTo =
      send.email.replyTo.trim() ||
      company.salesEmail.trim() ||
      company.email.trim() ||
      "";
    setEmailReplyTo(replyTo);
    setEmailFromName(company.name || "");
    setEmailFromEmail(company.salesEmail.trim() || company.email.trim() || "");
    setSendChannel(channel);
    setSendOpen(true);
    if (channel === "whatsapp") {
      void api<{ canAutoAttach?: boolean }>("/quotation-v1/send/whatsapp/status")
        .then((s) => setWaCanAutoAttach(Boolean(s.canAutoAttach)))
        .catch(() => setWaCanAutoAttach(false));
    }
  }

  async function submitQuotationEmail() {
    if (!emailTo.trim()) {
      flash("Enter an email To address.", "err");
      return;
    }
    setBusy(true);
    try {
      let pdf: { filename: string; pdfBase64: string } | null = null;
      try {
        pdf = await buildPdfPayload(current);
      } catch {
        pdf = null;
      }
      const result = await api<{
        ok: boolean;
        delivered: boolean;
        via: string;
        outboxId?: string;
        hint?: string;
      }>("/quotation-v1/send/email", {
        method: "POST",
        body: JSON.stringify({
          to: emailTo.trim(),
          cc: emailCc.trim(),
          subject: emailSubject.trim(),
          message: emailMessage,
          html: emailHtml || undefined,
          templateId: emailTemplateId,
          replyTo: emailReplyTo.trim() || undefined,
          fromName: emailFromName.trim() || undefined,
          fromEmail: emailFromEmail.trim() || undefined,
          quotationId: current.id,
          quoteNo: current.quoteNo,
          filename: pdf?.filename,
          pdfBase64: pdf?.pdfBase64,
        }),
      });
      invalidateLiveData("email-outbox");
      if (!result.delivered) {
        let openedViaOutlook = false;
        if (result.outboxId && (emailHtml || pdf?.pdfBase64)) {
          try {
            const { openOutboxInOutlook } = await import("@/lib/email-outbox");
            const r = await openOutboxInOutlook(result.outboxId);
            openedViaOutlook = Boolean(r.ok);
            if (!r.ok && emailHtml) {
              flash(
                r.error ||
                  "Could not open Outlook with HTML. Start the Sync Center agent and use classic Outlook, or Email Outbox → Open in Outlook.",
                "err",
              );
            }
          } catch {
            openedViaOutlook = false;
          }
        }
        if (!openedViaOutlook && pdf?.pdfBase64) {
          try {
            const { pdfBase64ToBytes } = await import("@/lib/artifact-delivery");
            const bytes = pdfBase64ToBytes(pdf.pdfBase64);
            const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = pdf.filename || "quotation.pdf";
            a.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 5000);
          } catch {
            /* continue */
          }
        }
        if (!openedViaOutlook && !emailHtml) {
          window.location.href = buildMailtoHref({
            to: emailTo.trim(),
            cc: emailCc.trim(),
            subject: emailSubject.trim(),
            body: emailMessage,
          });
        }
      }
      await saveQuote("sent");
      await pushNotif(
        current.id,
        result.delivered
          ? `Quotation ${current.quoteNo} emailed to ${emailTo.trim()}.`
          : `Quotation ${current.quoteNo} queued in Email Outbox for ${emailTo.trim()}.`,
      );
      setSendOpen(false);
      flash(
        result.delivered
          ? "Email handed off to your email webhook."
          : emailHtml
            ? result.hint ||
              "Saved to Email Outbox. Corporate HTML opens in Outlook via the desktop agent (mailto is plain text only)."
            : result.hint ||
              "Saved to Email Outbox. Open mail app or Open in Outlook from Email Outbox; attach the PDF if needed.",
      );
    } catch (e) {
      flash(e instanceof Error ? e.message : "Email send failed", "err");
    } finally {
      setBusy(false);
    }
  }

  function collectWhatsAppRecipients() {
    const send = normalizeSendSettings(sendSettings);
    const entries: Array<{ phone: string; label: string }> = [];
    for (const key of waSelected) {
      if (key.startsWith("customer:")) {
        const raw = key.slice("customer:".length);
        const phone = waDigits(raw);
        if (phone) {
          entries.push({
            phone,
            label: current.customer.name ? `Customer (${current.customer.name})` : "Customer",
          });
        }
      } else {
        const row = send.whatsappNumbers.find((n) => n.id === key);
        if (row?.phone) {
          const phone = waDigits(row.phone);
          if (phone) entries.push({ phone, label: row.label || row.phone });
        }
      }
    }
    for (const part of waExtra.split(/[,;\n]+/)) {
      const phone = waDigits(part);
      if (phone) entries.push({ phone, label: phone });
    }
    const seen = new Set<string>();
    return entries.filter((e) => {
      if (seen.has(e.phone)) return false;
      seen.add(e.phone);
      return true;
    });
  }

  async function pushNotif(quotationId: string, message: string) {
    await api("/quotation-v1/notifications", {
      method: "POST",
      body: JSON.stringify({ quotationId, message }),
    });
    invalidateAdminData("quotation-v1");
    await reloadMeta();
  }

  async function exportHistoryExcel() {
    const XLSX = await import("xlsx");
    const rows = activityRows.map((h) => ({
      When: h.savedAtLabel,
      Action: h.actionLabel,
      "Q No.": h.quoteNo || "(unsaved)",
      Customer: h.customerName,
      Type: h.typeLabel,
      Status: h.status,
      Amount: h.grand,
      "Amount change": h.amountDelta != null ? h.amountDelta : "",
      "Prepared by": h.preparedBy ?? "",
      "Quote on file": h.quoteExists ? "Yes" : "Deleted / log only",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "History");
    XLSX.writeFile(wb, "quotation-history.xlsx");
    flash("History Excel downloaded.");
  }

  async function exportSavedExcel() {
    if (!filteredList.length) {
      flash("No quotations to export.", "err");
      return;
    }
    try {
      await exportSavedQuotationsExcel(filteredList, company);
      flash(
        activeFilterCount
          ? `Excel downloaded (${filteredList.length} filtered).`
          : "Saved quotations Excel downloaded.",
      );
    } catch (e) {
      flash(e instanceof Error ? e.message : "Excel export failed", "err");
    }
  }

  async function exportSavedPdf() {
    if (!filteredList.length) {
      flash("No quotations to export.", "err");
      return;
    }
    try {
      await exportSavedQuotationsPdf(filteredList, company);
      flash(
        activeFilterCount
          ? `PDF downloaded (${filteredList.length} filtered).`
          : "Saved quotations PDF downloaded.",
      );
    } catch (e) {
      flash(e instanceof Error ? e.message : "PDF export failed", "err");
    }
  }

  function patchSavedFilters(patch: Partial<SavedQuoteFilters>) {
    setSavedFilters((prev) => ({ ...prev, ...patch }));
  }

  function toggleSavedStatus(status: QuoteStatus) {
    setSavedFilters((prev) => {
      const has = prev.statuses.includes(status);
      return {
        ...prev,
        statuses: has ? prev.statuses.filter((s) => s !== status) : [...prev.statuses, status],
      };
    });
  }

  function statusPillClass(status: QuotationV1["status"]) {
    if (status === "approved" || status === "submitted") return "success";
    if (status === "rejected") return "danger";
    if (status === "sent") return "warning";
    return "neutral";
  }

  const unread = notifications.filter((n) => !n.read).length;

  const NAV: Array<{ id: Route; label: string; hint: string; hidden?: boolean }> = [
    { id: "new", label: "Compose", hint: "Build a quote" },
    { id: "list", label: "Saved", hint: "Open & manage" },
    { id: "notifications", label: "Alerts", hint: "Approvals & sends" },
    { id: "history", label: "Activity", hint: "Save audit", hidden: history.length === 0 },
    { id: "company", label: "Letterhead", hint: "Company details" },
  ];

  useEffect(() => {
    if (route === "history" && history.length === 0) setRoute("list");
  }, [route, history.length]);

  function openQuotationById(quotationId: string) {
    const q = list.find((x) => x.id === quotationId);
    if (!q) {
      flash("This quotation was deleted — only the audit log remains.", "err");
      return;
    }
    const full = normalizeQuotation(q);
    setCurrent(full);
    setLastSaved(snapshotOf(full));
    setRoute("new");
  }

  return (
    <div className="qgv1-root tool-workspace qgv1-root-shell">
      <ToolPageHero
        eyebrow="Sales · Documents"
        title="Quotation Generator V1"
        subtitle="Draft · submit to company delivery · PDF · WhatsApp / Email"
        meta={
          <>
            {user?.role ? (
              <span className="tool-shell-chip">
                {user.role.charAt(0).toUpperCase()}
                {user.role.slice(1)}
              </span>
            ) : null}
            {user?.email ? (
              <span className="tool-shell-chip tool-shell-chip-muted" title={user.email}>
                {user.email}
              </span>
            ) : null}
          </>
        }
        actions={
          route === "new" ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                preparedBySeeded.current = true;
                setCurrent(newQuotationDraft("solar", undefined, userDisplayName(user)));
                setLastSaved(null);
              }}
            >
              New draft
            </button>
          ) : null
        }
      />

      <nav className="qgv1-seg tool-seg-nav" aria-label="Quotation sections">
        {NAV.filter((item) => !item.hidden).map((item) => {
          const badge =
            item.id === "list" && pendingApprovals
              ? pendingApprovals
              : item.id === "notifications" && unread
                ? unread
                : 0;
          return (
            <button
              key={item.id}
              type="button"
              className={`qgv1-seg-item ${route === item.id ? "active" : ""}`}
              onClick={() => {
                setRoute(item.id);
              }}
            >
              <span className="qgv1-seg-label">{item.label}</span>
              <span className="qgv1-seg-hint">{item.hint}</span>
              {badge ? <span className="qgv1-badge">{badge}</span> : null}
            </button>
          );
        })}
      </nav>

      <main className="qgv1-main">
        {route === "new" ? (
          <div className="qgv1-workspace qgv1-compose-shell preview-workspace">
            <div className="qgv1-editor qgv1-compose preview-editor">
            <div className="qgv1-page-head qgv1-compose-head">
              <div>
                <h1>Compose</h1>
                <p className="qgv1-compose-lede">
                  Save draft · Submit · PDF · WhatsApp / Email — preview updates live.
                </p>
              </div>
            </div>

            <div className="qgv1-compose-bar" aria-label="Quote summary">
              <span className="qgv1-compose-bar-no mono" title="Quotation number">
                {previewQuoteNo(current, company, {})}
              </span>
              <span className="qgv1-compose-bar-total">₹{money(totals.grand)}</span>
              <span className={`qgv1-compose-bar-status is-${current.status}`}>{current.status}</span>
            </div>

            {!bannerDismissed ? (
              <div className="qgv1-banner">
                <button type="button" className="qgv1-banner-x" onClick={() => setBannerDismissed(true)}>
                  ✕
                </button>
                <b>Workflow:</b> Fill required fields → <b>Save</b> (draft) → <b>Submit</b> (company delivery) →{" "}
                <b>Download PDF</b> when you need the file, or <b>WhatsApp</b> / <b>Email</b> to send the message.
              </div>
            ) : null}

            <section className="qgv1-card qgv1-card-compact">
              <h3>Type</h3>
              <div className="qgv1-compose-type">
                <label className="field qgv1-compose-type-cat">
                  <span>Category *</span>
                  <select
                    className="qgv1-cat"
                    value={current.category}
                    onChange={(e) => switchType(e.target.value as CategoryKey, current.engagement)}
                  >
                    {(Object.keys(CATEGORIES) as CategoryKey[]).map((k) => (
                      <option key={k} value={k}>
                        {CATEGORIES[k].label}
                      </option>
                    ))}
                  </select>
                </label>
                {current.category === "other" ? (
                  <label className="field qgv1-compose-type-custom">
                    <span>Custom label</span>
                    <input
                      className="qgv1-input"
                      placeholder="e.g. Water Heater, CCTV…"
                      value={current.categoryCustomLabel}
                      onChange={(e) => patch((q) => ({ ...q, categoryCustomLabel: e.target.value }))}
                    />
                  </label>
                ) : null}
                <div className="qgv1-compose-engagements">
                  <span className="qgv1-compose-engagements-label">For *</span>
                  <div className="qgv1-compose-engagements-row" role="group" aria-label="Engagement type">
                    {CATEGORY_ENGAGEMENTS[current.category].map((k) => (
                      <button
                        key={k}
                        type="button"
                        className={`qgv1-eng-chip ${current.engagement === k ? "is-on" : ""}`}
                        onClick={() => switchType(current.category, k)}
                      >
                        {engMeta(current.category, k).label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="qgv1-card qgv1-card-compact">
              <h3>Details</h3>
              <div className="qgv1-compose-meta-grid">
                <label className="field">
                  <span>Date</span>
                  <input
                    type="date"
                    value={current.date}
                    onChange={(e) => patch((q) => ({ ...q, date: e.target.value }))}
                  />
                </label>
                <label className="field">
                  <span>Valid till</span>
                  <input
                    type="date"
                    value={current.validTill}
                    onChange={(e) => patch((q) => ({ ...q, validTill: e.target.value }))}
                  />
                </label>
                <label className="field">
                  <span>Follow-up</span>
                  <input
                    type="date"
                    value={current.followUpDate || ""}
                    onChange={(e) => patch((q) => ({ ...q, followUpDate: e.target.value }))}
                  />
                </label>
                <label className="field">
                  <span>Prepared by *</span>
                  <input
                    value={current.preparedBy}
                    onChange={(e) => patch((q) => ({ ...q, preparedBy: e.target.value }))}
                    placeholder="Your name"
                  />
                </label>
              </div>
            </section>

            <section className="qgv1-card qgv1-card-compact">
              <h3>Customer</h3>
              <div className="qgv1-grid2">
                <label className="field">
                  <span>Customer / Site Owner Name *</span>
                  <input
                    value={current.customer.name}
                    onChange={(e) =>
                      patch((q) => ({ ...q, customer: { ...q.customer, name: e.target.value } }))
                    }
                  />
                </label>
                <label className="field">
                  <span>Company (if any)</span>
                  <input
                    value={current.customer.company}
                    onChange={(e) =>
                      patch((q) => ({ ...q, customer: { ...q.customer, company: e.target.value } }))
                    }
                  />
                </label>
                <label className="field" style={{ gridColumn: "1 / -1" }}>
                  <span>Site / Billing Address</span>
                  <textarea
                    rows={2}
                    value={current.customer.address}
                    onChange={(e) =>
                      patch((q) => ({ ...q, customer: { ...q.customer, address: e.target.value } }))
                    }
                  />
                </label>
                <label className="field">
                  <span>City</span>
                  <input
                    value={current.customer.city || ""}
                    onChange={(e) =>
                      patch((q) => ({ ...q, customer: { ...q.customer, city: e.target.value } }))
                    }
                    placeholder="Falls back to State in Saved list if blank"
                  />
                </label>
                <label className="field">
                  <span>State</span>
                  <select
                    value={current.customer.state}
                    onChange={(e) =>
                      patch((q) => ({ ...q, customer: { ...q.customer, state: e.target.value } }))
                    }
                  >
                    {INDIAN_STATES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>GSTIN</span>
                  <input
                    value={current.customer.gstin}
                    onChange={(e) =>
                      patch((q) => ({ ...q, customer: { ...q.customer, gstin: e.target.value } }))
                    }
                  />
                </label>
                <label className="field">
                  <span>Phone (WhatsApp) *</span>
                  <input
                    value={current.customer.phone}
                    onChange={(e) =>
                      patch((q) => ({ ...q, customer: { ...q.customer, phone: e.target.value } }))
                    }
                  />
                </label>
                <label className="field">
                  <span>Email</span>
                  <input
                    value={current.customer.email}
                    onChange={(e) =>
                      patch((q) => ({ ...q, customer: { ...q.customer, email: e.target.value } }))
                    }
                  />
                </label>
              </div>
            </section>

            <section className="qgv1-card qgv1-card-compact">
              <div className="qgv1-card-head-row">
                <h3>Line items</h3>
                <div className="qgv1-btn-row">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() =>
                      patch((q) => ({
                        ...q,
                        items: [
                          ...q.items,
                          { id: Math.random().toString(36).slice(2), desc: "New item", qty: 1, rate: 0, gst: 0, discount: 0 },
                        ],
                      }))
                    }
                  >
                    + Add row
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      patch((q) => ({
                        ...q,
                        items: templateItems(q.category, q.engagement),
                      }))
                    }
                  >
                    Reset template
                  </button>
                </div>
              </div>
              <div className="qgv1-table-wrap">
                <table className="qgv1-items">
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th>Qty</th>
                      <th>Rate</th>
                      <th>GST%</th>
                      <th>Amount</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {current.items.map((it) => {
                      const amt = (Number(it.qty) || 0) * (Number(it.rate) || 0);
                      return (
                        <tr key={it.id}>
                          <td>
                            <input
                              value={it.desc}
                              onChange={(e) =>
                                patch((q) => ({
                                  ...q,
                                  items: q.items.map((x) =>
                                    x.id === it.id ? { ...x, desc: e.target.value } : x,
                                  ),
                                }))
                              }
                            />
                          </td>
                          <td>
                            <input
                              value={String(it.qty)}
                              onChange={(e) => {
                                const v = sanitizeNumStr(e.target.value);
                                patch((q) => ({
                                  ...q,
                                  items: q.items.map((x) => (x.id === it.id ? { ...x, qty: v } : x)),
                                }));
                              }}
                            />
                          </td>
                          <td>
                            <input
                              value={String(it.rate)}
                              onChange={(e) => {
                                const v = sanitizeSignedNumStr(e.target.value);
                                patch((q) => ({
                                  ...q,
                                  items: q.items.map((x) => (x.id === it.id ? { ...x, rate: v } : x)),
                                }));
                              }}
                            />
                          </td>
                          <td>
                            <input
                              value={String(it.gst)}
                              onChange={(e) => {
                                const v = sanitizeNumStr(e.target.value);
                                patch((q) => ({
                                  ...q,
                                  items: q.items.map((x) => (x.id === it.id ? { ...x, gst: v } : x)),
                                }));
                              }}
                            />
                          </td>
                          <td className="amt">₹{money(amt)}</td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-destructive btn-sm"
                              onClick={() =>
                                patch((q) => ({ ...q, items: q.items.filter((x) => x.id !== it.id) }))
                              }
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="qgv1-grid3" style={{ marginTop: 14 }}>
                <label className="field">
                  <span>Extra charge label</span>
                  <input
                    value={current.extraCharge.label}
                    onChange={(e) =>
                      patch((q) => ({
                        ...q,
                        extraCharge: { ...q.extraCharge, label: e.target.value },
                      }))
                    }
                  />
                </label>
                <label className="field">
                  <span>Amount</span>
                  <input
                    value={String(current.extraCharge.amount)}
                    onChange={(e) =>
                      patch((q) => ({
                        ...q,
                        extraCharge: { ...q.extraCharge, amount: sanitizeNumStr(e.target.value) },
                      }))
                    }
                  />
                </label>
                <label className="field">
                  <span>GST %</span>
                  <input
                    value={String(current.extraCharge.gst)}
                    onChange={(e) =>
                      patch((q) => ({
                        ...q,
                        extraCharge: { ...q.extraCharge, gst: sanitizeNumStr(e.target.value) },
                      }))
                    }
                  />
                </label>
              </div>

              <table className="qgv1-totals">
                <tbody>
                  <tr>
                    <td>Subtotal</td>
                    <td className="amt">₹{money(totals.subtotal)}</td>
                  </tr>
                  <tr>
                    <td>Taxable</td>
                    <td className="amt">₹{money(totals.taxable)}</td>
                  </tr>
                  <tr>
                    <td>Extra + GST</td>
                    <td className="amt">₹{money(totals.exTotal)}</td>
                  </tr>
                  {totals.interState ? (
                    <tr>
                      <td>
                        IGST %{" "}
                        <input
                          className="qgv1-rate"
                          value={String(current.gstOverride.igst ?? totals.igstRate.toFixed(2))}
                          onChange={(e) =>
                            patch((q) => ({
                              ...q,
                              gstOverride: {
                                mode: "manual",
                                cgst: q.gstOverride.cgst,
                                sgst: q.gstOverride.sgst,
                                igst: sanitizeNumStr(e.target.value),
                              },
                            }))
                          }
                        />
                      </td>
                      <td className="amt">₹{money(totals.igst)}</td>
                    </tr>
                  ) : (
                    <>
                      <tr>
                        <td>
                          CGST %{" "}
                          <input
                            className="qgv1-rate"
                            value={String(current.gstOverride.cgst ?? totals.cgstRate.toFixed(2))}
                            onChange={(e) =>
                              patch((q) => ({
                                ...q,
                                gstOverride: {
                                  mode: "manual",
                                  cgst: sanitizeNumStr(e.target.value),
                                  sgst: q.gstOverride.sgst,
                                  igst: q.gstOverride.igst,
                                },
                              }))
                            }
                          />
                        </td>
                        <td className="amt">₹{money(totals.cgst)}</td>
                      </tr>
                      <tr>
                        <td>
                          SGST %{" "}
                          <input
                            className="qgv1-rate"
                            value={String(current.gstOverride.sgst ?? totals.sgstRate.toFixed(2))}
                            onChange={(e) =>
                              patch((q) => ({
                                ...q,
                                gstOverride: {
                                  mode: "manual",
                                  cgst: q.gstOverride.cgst,
                                  sgst: sanitizeNumStr(e.target.value),
                                  igst: q.gstOverride.igst,
                                },
                              }))
                            }
                          />
                        </td>
                        <td className="amt">₹{money(totals.sgst)}</td>
                      </tr>
                    </>
                  )}
                  <tr>
                    <td>Round off</td>
                    <td className="amt">₹{money(totals.roundOff)}</td>
                  </tr>
                  <tr className="grand">
                    <td>Grand Total</td>
                    <td className="amt">₹{money(totals.grand)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="muted" style={{ fontStyle: "italic", marginTop: 8 }}>
                {numToWordsIndian(totals.grand)}
              </p>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  patch((q) => ({
                    ...q,
                    gstOverride: { mode: "auto", cgst: null, sgst: null, igst: null },
                  }))
                }
              >
                Reset GST to auto
              </button>
            </section>

            <details className="qgv1-card qgv1-card-compact qgv1-disclosure qgv1-notes-card" open>
              <summary className="qgv1-disclosure-summary">
                <span>Terms &amp; notes</span>
                <span className="qgv1-disclosure-hint muted">On PDF · Terms &amp; Conditions</span>
              </summary>
              <textarea
                className="qgv1-notes-area"
                rows={6}
                value={current.notes}
                onChange={(e) => patch((q) => ({ ...q, notes: e.target.value }))}
                placeholder="Payment terms, warranty, delivery timeline, exclusions…"
              />
            </details>

            <div className="qgv1-btn-row qgv1-editor-actions">
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void saveQuote()}>
                Save
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void submitQuote()}
              >
                Submit
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void downloadPdf(current)}
              >
                Download PDF
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void openSendModal("whatsapp")}
              >
                WhatsApp
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void openSendModal("email")}
              >
                Email
              </button>
              {!isSaved && current.quoteNo ? (
                <span className="pill pill-warning">Unsaved changes</span>
              ) : null}
            </div>
            </div>

            <aside className="qgv1-preview-pane preview-pane" aria-label="Live quotation preview">
              <div className="qgv1-preview-toolbar preview-pane-toolbar">
                <div>
                  <span className="qgv1-preview-title preview-pane-title">Live preview</span>
                  <span className="qgv1-preview-sub preview-pane-sub">Updates as you type</span>
                </div>
                <div className="qgv1-preview-toolbar-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy || !current.quoteNo}
                    onClick={async () => {
                      if (!validateSaved(current)) return;
                      const saved = await saveQuote("sent");
                      if (!saved) return;
                      const link = `${window.location.origin}${withBasePath(`/q/${saved.approvalToken}`)}`;
                      setApprovalLink(link);
                      await pushNotif(saved.id, `Approval link generated for ${saved.quoteNo}.`);
                    }}
                  >
                    Approval link
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy}
                    onClick={() => void downloadPdf(current)}
                  >
                    Download PDF
                  </button>
                </div>
              </div>
              <div className="qgv1-preview-scroll preview-pane-scroll" ref={sheetRef}>
                <div className="qgv1-preview-fit">
                  <QuoteSheet quote={current} company={company} />
                </div>
              </div>
            </aside>
          </div>
        ) : null}

        {route === "list" ? (
          <div className="qgv1-tab-panel">
          <section className="qgv1-card qgv1-card-compact">
            <div className="qgv1-page-head qgv1-panel-head">
              <div>
                <h1>Saved</h1>
                <p className="qgv1-tab-lede">Filter · open · PDF · export register.</p>
              </div>
              {list.length > 0 ? (
                <div className="qgv1-export-group" role="group" aria-label="Export saved quotations">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy || !filteredList.length}
                    onClick={() => void exportSavedExcel()}
                  >
                    Export Excel
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy || !filteredList.length}
                    onClick={() => void exportSavedPdf()}
                  >
                    Export PDF
                  </button>
                </div>
              ) : null}
            </div>
            {list.length === 0 ? (
              <div className="empty-state">
                <div className="es-title">No quotations yet</div>
              </div>
            ) : (
              <>
                <div className="qgv1-compose-bar qgv1-tab-bar" aria-label="Saved register summary">
                  <span className="qgv1-tab-bar-label">Pipeline</span>
                  <span className="qgv1-compose-bar-total">
                    {filteredList.length} shown
                  </span>
                  {pendingApprovals ? (
                    <span className="qgv1-compose-bar-status is-sent">{pendingApprovals} pending</span>
                  ) : null}
                </div>
                <div className="qgv1-saved-filters">
                  <div className="qgv1-saved-filters-main">
                    <label className="qgv1-saved-search">
                      <span className="sr-only">Search quotations</span>
                      <input
                        type="search"
                        value={savedFilters.query}
                        onChange={(e) => patchSavedFilters({ query: e.target.value })}
                        placeholder="Search quote no., company, city, description…"
                      />
                    </label>
                    <div className="qgv1-saved-status-chips" role="group" aria-label="Status filter">
                      {SAVED_STATUS_OPTIONS.map((status) => {
                        const on = savedFilters.statuses.includes(status);
                        return (
                          <button
                            key={status}
                            type="button"
                            className={`qgv1-filter-chip${on ? " is-on" : ""}`}
                            aria-pressed={on}
                            onClick={() => toggleSavedStatus(status)}
                          >
                            {status}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      className={`btn btn-ghost btn-sm qgv1-filters-toggle${filtersExpanded ? " is-on" : ""}`}
                      aria-expanded={filtersExpanded}
                      onClick={() => setFiltersExpanded((v) => !v)}
                    >
                      More filters{activeFilterCount ? ` · ${activeFilterCount}` : ""}
                    </button>
                    {activeFilterCount > 0 ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          setSavedFilters(EMPTY_SAVED_FILTERS);
                          setFiltersExpanded(false);
                        }}
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>

                  {filtersExpanded ? (
                    <div className="qgv1-saved-filters-grid">
                      <label className="field">
                        <span>City</span>
                        <select
                          value={savedFilters.city}
                          onChange={(e) => patchSavedFilters({ city: e.target.value })}
                        >
                          <option value="">All cities</option>
                          {savedCityOptions.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>Prepared By</span>
                        <select
                          value={savedFilters.preparedBy}
                          onChange={(e) => patchSavedFilters({ preparedBy: e.target.value })}
                        >
                          <option value="">All</option>
                          {savedPreparedByOptions.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>Follow-up</span>
                        <select
                          value={savedFilters.followUp}
                          onChange={(e) =>
                            patchSavedFilters({ followUp: e.target.value as FollowUpFilter })
                          }
                        >
                          <option value="all">All</option>
                          <option value="overdue">Overdue</option>
                          <option value="upcoming">Upcoming</option>
                          <option value="set">Has follow-up</option>
                          <option value="none">No follow-up</option>
                        </select>
                      </label>
                      <label className="field">
                        <span>Submitted from</span>
                        <input
                          type="date"
                          value={savedFilters.submittedFrom}
                          onChange={(e) => patchSavedFilters({ submittedFrom: e.target.value })}
                        />
                      </label>
                      <label className="field">
                        <span>Submitted to</span>
                        <input
                          type="date"
                          value={savedFilters.submittedTo}
                          onChange={(e) => patchSavedFilters({ submittedTo: e.target.value })}
                        />
                      </label>
                      <label className="field">
                        <span>Follow-up from</span>
                        <input
                          type="date"
                          value={savedFilters.followUpFrom}
                          onChange={(e) => patchSavedFilters({ followUpFrom: e.target.value })}
                        />
                      </label>
                      <label className="field">
                        <span>Follow-up to</span>
                        <input
                          type="date"
                          value={savedFilters.followUpTo}
                          onChange={(e) => patchSavedFilters({ followUpTo: e.target.value })}
                        />
                      </label>
                      <label className="field">
                        <span>Min quote value (₹)</span>
                        <input
                          inputMode="decimal"
                          value={savedFilters.valueMin}
                          onChange={(e) =>
                            patchSavedFilters({ valueMin: sanitizeNumStr(e.target.value) })
                          }
                          placeholder="0"
                        />
                      </label>
                      <label className="field">
                        <span>Max quote value (₹)</span>
                        <input
                          inputMode="decimal"
                          value={savedFilters.valueMax}
                          onChange={(e) =>
                            patchSavedFilters({ valueMax: sanitizeNumStr(e.target.value) })
                          }
                          placeholder="Any"
                        />
                      </label>
                    </div>
                  ) : null}

                  <div className="qgv1-saved-meta">
                    Showing <b>{filteredList.length}</b> of {list.length}
                    {activeFilterCount ? (
                      <span className="qgv1-saved-meta-tag">
                        {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"} active
                      </span>
                    ) : null}
                  </div>
                </div>

                {filteredList.length === 0 ? (
                  <div className="empty-state qgv1-saved-empty">
                    <div className="es-title">No matches</div>
                    <p className="muted">Try clearing filters or broadening the search.</p>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setSavedFilters(EMPTY_SAVED_FILTERS)}
                    >
                      Clear filters
                    </button>
                  </div>
                ) : (
                  <>
                  <div className="qgv1-saved-cards" aria-label="Saved quotations">
                    {filteredList.map((q) => {
                      const row = buildSavedQuoteListRow(q, company);
                      return (
                        <article key={q.id} className="qgv1-saved-card">
                          <div className="qgv1-saved-card-top">
                            <span className="qgv1-saved-qno mono">{row.quoteNo}</span>
                            <span className={`pill pill-${statusPillClass(row.status)}`}>{row.status}</span>
                          </div>
                          <div className="qgv1-saved-card-main">
                            <strong>{row.companyName}</strong>
                            <span className="muted">
                              {row.companyCity} · {row.submittedDate}
                            </span>
                            <p className="qgv1-saved-desc">{row.description}</p>
                          </div>
                          <div className="qgv1-saved-card-meta">
                            <span className="qgv1-saved-grand">₹{row.grandTotalLabel}</span>
                            <span className="muted">{row.preparedBy}</span>
                          </div>
                          <div className="qgv1-saved-card-actions">
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() => {
                                const full = normalizeQuotation(q);
                                setCurrent(full);
                                setLastSaved(snapshotOf(full));
                                setRoute("new");
                              }}
                            >
                              Open
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              disabled={busy}
                              onClick={() => void downloadPdf(q)}
                            >
                              PDF
                            </button>
                            <button
                              type="button"
                              className="btn btn-destructive btn-sm"
                              onClick={async () => {
                                if (!confirm(`Delete ${q.quoteNo}?`)) return;
                                await api(`/quotation-v1/${q.id}`, { method: "DELETE" });
                                flash("Deleted.");
                                await reloadMeta();
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                  <div className="qgv1-saved-wrap qgv1-saved-table-desktop">
                    <table className="qgv1-saved-table">
                      <thead>
                        <tr>
                          <th>Quotation No.</th>
                          <th>Submitted</th>
                          <th>Company</th>
                          <th>City</th>
                          <th>Description</th>
                          <th className="num">Basic Total</th>
                          <th className="num">Grand Total</th>
                          <th className="num">Quote Value</th>
                          <th>Status</th>
                          <th>Follow-up</th>
                          <th>Prepared By</th>
                          <th className="actions">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredList.map((q) => {
                          const row = buildSavedQuoteListRow(q, company);
                          return (
                            <tr key={q.id}>
                              <td className="mono qgv1-saved-qno">{row.quoteNo}</td>
                              <td className="nowrap">{row.submittedDate}</td>
                              <td>
                                <div className="qgv1-saved-company">{row.companyName}</div>
                              </td>
                              <td className="nowrap">{row.companyCity}</td>
                              <td>
                                <div className="qgv1-saved-desc" title={row.description}>
                                  {row.description}
                                </div>
                              </td>
                              <td className="num nowrap">₹{row.basicTotalLabel}</td>
                              <td className="num nowrap qgv1-saved-grand">₹{row.grandTotalLabel}</td>
                              <td className="num nowrap">₹{row.totalValueLabel}</td>
                              <td>
                                <span className={`pill pill-${statusPillClass(row.status)}`}>
                                  {row.status}
                                </span>
                              </td>
                              <td className="nowrap">{row.followUpDate}</td>
                              <td className="nowrap">{row.preparedBy}</td>
                              <td className="actions">
                                <div className="qgv1-saved-actions">
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => {
                                      const full = normalizeQuotation(q);
                                      setCurrent(full);
                                      setLastSaved(snapshotOf(full));
                                      setRoute("new");
                                    }}
                                  >
                                    Open
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    disabled={busy}
                                    title="Download PDF"
                                    onClick={() => void downloadPdf(q)}
                                  >
                                    PDF
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-destructive btn-sm"
                                    onClick={async () => {
                                      if (!confirm(`Delete ${q.quoteNo}?`)) return;
                                      await api(`/quotation-v1/${q.id}`, { method: "DELETE" });
                                      flash("Deleted.");
                                      await reloadMeta();
                                    }}
                                  >
                                    Delete
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  </>
                )}
              </>
            )}
          </section>
          </div>
        ) : null}

        {route === "notifications" ? (
          <div className="qgv1-tab-panel">
          <section className="qgv1-card qgv1-card-compact">
            <div className="qgv1-page-head qgv1-panel-head">
              <div>
                <h1>Alerts</h1>
                <p className="qgv1-tab-lede">Sends, approvals, and workspace activity.</p>
              </div>
            </div>
            {notifications.length === 0 ? (
              <p className="muted qgv1-tab-empty">No notifications yet.</p>
            ) : (
              <div className="qgv1-notif-list">
              {notifications.map((n) => (
                <div key={n.id} className="qgv1-notif" data-read={n.read ? "1" : "0"}>
                  <div className="qgv1-notif-body">
                    <strong>{n.message}</strong>
                    <div className="muted qgv1-notif-time">{n.createdAt?.slice(0, 19).replace("T", " ")}</div>
                  </div>
                  {!n.read ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm qgv1-notif-action"
                      onClick={async () => {
                        await api(`/quotation-v1/notifications/${n.id}/read`, { method: "POST" });
                        await reloadMeta();
                      }}
                    >
                      Mark read
                    </button>
                  ) : null}
                </div>
              ))}
              </div>
            )}
          </section>
          </div>
        ) : null}

        {route === "history" && history.length > 0 ? (
          <div className="qgv1-tab-panel">
          <section className="qgv1-card qgv1-card-compact">
            <div className="qgv1-page-head qgv1-panel-head">
              <div>
                <h1>Activity</h1>
                <p className="qgv1-tab-lede">
                  Audit trail of saves and status changes — open live quotes from here; deleted quotes stay in the log only.
                </p>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void exportHistoryExcel()}>
                Export Excel
              </button>
            </div>

            <div className="qgv1-compose-bar qgv1-tab-bar" aria-label="Activity summary">
              <span className="qgv1-tab-bar-label">Audit</span>
              <span className="qgv1-compose-bar-total">{activityStats.events} events</span>
              <span className="qgv1-compose-bar-status">{activityStats.uniqueQuotes} quotes</span>
            </div>

            <label className="qgv1-saved-search qgv1-activity-search">
              <span className="sr-only">Search activity</span>
              <input
                type="search"
                value={activityQuery}
                onChange={(e) => setActivityQuery(e.target.value)}
                placeholder="Search quote, customer, action…"
              />
            </label>

            {filteredActivity.length === 0 ? (
              <p className="muted qgv1-tab-empty">No activity matches your search.</p>
            ) : (
              <>
                <div className="qgv1-activity-cards">
                  {filteredActivity.map((h) => (
                    <article key={h.id} className="qgv1-activity-card">
                      <div className="qgv1-activity-card-top">
                        <span className={`qgv1-activity-action is-${h.actionKind}`}>{h.actionLabel}</span>
                        <time className="qgv1-activity-when muted">{h.savedAtLabel}</time>
                      </div>
                      <div className="qgv1-activity-card-body">
                        <button
                          type="button"
                          className="qgv1-activity-quote mono"
                          disabled={!h.quoteExists}
                          title={h.quoteExists ? "Open in Compose" : "Quotation no longer on file"}
                          onClick={() => openQuotationById(h.quotationId)}
                        >
                          {h.quoteNo || "(unsaved)"}
                        </button>
                        <span className="qgv1-activity-customer">{h.customerName || "—"}</span>
                        <span className="muted qgv1-activity-meta">
                          {h.typeLabel}
                          {h.preparedBy ? ` · ${h.preparedBy}` : ""}
                        </span>
                      </div>
                      <div className="qgv1-activity-card-foot">
                        <div className="qgv1-activity-amounts">
                          <span className="qgv1-history-val">₹{money(h.grand)}</span>
                          {h.amountDelta != null ? (
                            <span
                              className={`qgv1-activity-delta ${h.amountDelta >= 0 ? "is-up" : "is-down"}`}
                            >
                              {h.amountDelta >= 0 ? "+" : "−"}₹{money(Math.abs(h.amountDelta))}
                            </span>
                          ) : null}
                        </div>
                        <span className={`pill pill-${statusPillClass(h.status as QuoteStatus)}`}>{h.status}</span>
                      </div>
                      <div className="qgv1-activity-card-actions">
                        {h.quoteExists ? (
                          <>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() => openQuotationById(h.quotationId)}
                            >
                              Open
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              disabled={busy}
                              onClick={() => {
                                const q = list.find((x) => x.id === h.quotationId);
                                if (q) void downloadPdf(q);
                              }}
                            >
                              PDF
                            </button>
                          </>
                        ) : (
                          <span className="qgv1-activity-archived muted">Deleted — log only</span>
                        )}
                        {h.isLatestForQuote && h.quoteExists ? (
                          <span className="qgv1-activity-latest">Latest</span>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>

                <div className="qgv1-activity-table-wrap qgv1-saved-table-desktop">
                  <table className="qgv1-activity-table">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Action</th>
                        <th>Quote</th>
                        <th>Customer</th>
                        <th className="num">Amount</th>
                        <th>Status</th>
                        <th className="actions">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredActivity.map((h) => (
                        <tr key={h.id}>
                          <td className="nowrap">{h.savedAtLabel}</td>
                          <td>
                            <span className={`qgv1-activity-action is-${h.actionKind}`}>{h.actionLabel}</span>
                            {h.amountDelta != null ? (
                              <span className="qgv1-activity-delta-inline muted">
                                {" "}
                                ({h.amountDelta >= 0 ? "+" : "−"}₹{money(Math.abs(h.amountDelta))})
                              </span>
                            ) : null}
                          </td>
                          <td className="mono">{h.quoteNo || "—"}</td>
                          <td>{h.customerName || "—"}</td>
                          <td className="num nowrap">₹{money(h.grand)}</td>
                          <td>
                            <span className={`pill pill-${statusPillClass(h.status as QuoteStatus)}`}>
                              {h.status}
                            </span>
                          </td>
                          <td className="actions">
                            {h.quoteExists ? (
                              <div className="qgv1-saved-actions">
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => openQuotationById(h.quotationId)}
                                >
                                  Open
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  disabled={busy}
                                  onClick={() => {
                                    const q = list.find((x) => x.id === h.quotationId);
                                    if (q) void downloadPdf(q);
                                  }}
                                >
                                  PDF
                                </button>
                              </div>
                            ) : (
                              <span className="muted">Log only</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
          </div>
        ) : null}

        {route === "company" ? (
          <div className="qgv1-tab-panel">
          <section className="qgv1-card qgv1-card-compact qgv1-letterhead-panel">
            <div className="qgv1-page-head qgv1-panel-head">
              <div>
                <h1>Letterhead</h1>
                <p className="qgv1-tab-lede">
                  Logo &amp; name from <Link href="/profile">Business Profile</Link> — fields below print on PDF.
                </p>
              </div>
            </div>
            <div className="qgv1-brand-sync qgv1-brand-sync-compact">
              {company.logo ? (
                <img className="qgv1-brand-sync-logo" src={publicAssetUrl(company.logo)} alt="" />
              ) : (
                <div className="qgv1-brand-sync-logo is-empty">No logo</div>
              )}
              <div>
                <div className="qgv1-brand-sync-name">{company.name}</div>
                <p className="muted" style={{ margin: "4px 0 0" }}>
                  Edit name &amp; logo in Business Profile — they update here automatically.
                </p>
              </div>
            </div>
            <div className="qgv1-grid2 qgv1-letterhead-grid">
              {(
                [
                  ["tagline", "Tagline"],
                  ["gstin", "GSTIN"],
                  ["state", "State"],
                  ["landline", "Landline"],
                  ["phone", "Mobile"],
                  ["email", "Quotation Email"],
                  ["salesEmail", "Sales Team Email"],
                  ["managerEmail", "Manager Email"],
                  ["website", "Website"],
                  ["quotePrefix", "Quote No. Prefix"],
                  ["place", "Place (on signature)"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="field">
                  <span>{label}</span>
                  {key === "state" ? (
                    <select
                      value={company.state}
                      onChange={(e) => setCompany({ ...company, state: e.target.value })}
                    >
                      {INDIAN_STATES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={company[key]}
                      onChange={(e) => setCompany({ ...company, [key]: e.target.value })}
                    />
                  )}
                </label>
              ))}
              <label className="field" style={{ gridColumn: "1 / -1" }}>
                <span>Registered Address</span>
                <textarea
                  rows={3}
                  value={company.address}
                  onChange={(e) => setCompany({ ...company, address: e.target.value })}
                />
              </label>
            </div>

            <details className="qgv1-disclosure qgv1-send-admin-disclosure">
              <summary className="qgv1-disclosure-summary qgv1-send-admin-summary">
                <span>Send Via</span>
                <span className="qgv1-disclosure-hint muted">WhatsApp &amp; email on Business Profile</span>
              </summary>
              <p className="muted qgv1-send-admin-note">
                WhatsApp numbers and email templates are configured on the{" "}
                <Link href="/profile">Business Profile</Link> (Business Owner only). Those defaults apply to
                every tool under this profile.
              </p>
            </details>

            <div className="qgv1-tab-sticky-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={async () => {
                const profile = await fetchProfile().catch(() => null);
                const next = mergeCompanyFromBusinessProfile(company, profile);
                setCompany(next);
                if (profile?.sendSettings) {
                  setSendSettings(normalizeSendSettings(profile.sendSettings));
                }
                await api("/quotation-v1/company", {
                  method: "PUT",
                  body: JSON.stringify({ company: next }),
                });
                flash("Company profile saved.");
              }}
            >
              Save company details
            </button>
            </div>
          </section>
          </div>
        ) : null}
      </main>

      {sendOpen && sendChannel === "email" ? (
        <SendViaEmailComposeModal
          formatId={emailTemplateId}
          deliveryHint={
            emailTemplateId === "corporate"
              ? "Corporate HTML + PDF via webhook when configured; otherwise Email Outbox / Outlook agent. Mailto is plain text only."
              : "PDF attaches on webhook send; otherwise use Email Outbox or mailto + download."
          }
          attachmentNote={current.quoteNo ? `Quotation ${current.quoteNo}.pdf` : "Quotation PDF"}
          to={emailTo}
          onToChange={setEmailTo}
          cc={emailCc}
          onCcChange={setEmailCc}
          subject={emailSubject}
          onSubjectChange={setEmailSubject}
          replyTo={emailReplyTo}
          onReplyToChange={setEmailReplyTo}
          messageTemplate={emailMessageTemplate}
          onMessageTemplateChange={(next) => {
            setEmailMessageTemplate(next);
            const bodies = buildEmailBodiesFromTemplate(current, emailTemplateId, next);
            setEmailMessage(bodies.text);
            setEmailHtml(bodies.html ?? null);
          }}
          previewText={emailMessage}
          previewHtml={emailHtml}
          busy={busy}
          onClose={() => setSendOpen(false)}
          onSend={() => void submitQuotationEmail()}
        />
      ) : null}

      {sendOpen && sendChannel === "whatsapp" ? (
        <div
          className="modal-overlay"
          onClick={() => {
            setSendOpen(false);
          }}
        >
          <div
            className="modal-box qgv1-send-modal"
            style={{ ["--modal-max-width" as string]: "560px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="modal-title">WhatsApp</h3>
              <>
                <p className="modal-msg">
                  {waCanAutoAttach
                    ? "Preview the message, then Send — the PDF attaches automatically via WhatsApp Business."
                    : "Preview the message, then Send to open WhatsApp with that text. Use Download PDF only if you need to attach the file yourself."}
                </p>
                <div className="qgv1-wa-list">
                  {current.customer.phone ? (
                    <label className="qgv1-check-row">
                      <input
                        type="checkbox"
                        checked={waSelected.includes(
                          `customer:${current.customer.phone.replace(/\D/g, "")}`,
                        )}
                        onChange={(e) => {
                          const key = `customer:${current.customer.phone.replace(/\D/g, "")}`;
                          setWaSelected((prev) =>
                            e.target.checked
                              ? [...new Set([...prev, key])]
                              : prev.filter((x) => x !== key),
                          );
                        }}
                      />
                      <span>
                        Customer — {current.customer.phone}
                        {current.customer.name ? ` (${current.customer.name})` : ""}
                      </span>
                    </label>
                  ) : null}
                  {normalizeSendSettings(sendSettings)
                    .whatsappNumbers.filter((n) => n.phone)
                    .map((n) => (
                      <label key={n.id} className="qgv1-check-row">
                        <input
                          type="checkbox"
                          checked={waSelected.includes(n.id)}
                          onChange={(e) => {
                            setWaSelected((prev) =>
                              e.target.checked
                                ? [...new Set([...prev, n.id])]
                                : prev.filter((x) => x !== n.id),
                            );
                          }}
                        />
                        <span>
                          {n.label || "Team"} — {n.phone}
                        </span>
                      </label>
                    ))}
                </div>
                <label className="field" style={{ marginTop: 10 }}>
                  <span>Extra numbers (comma-separated)</span>
                  <input
                    value={waExtra}
                    onChange={(e) => setWaExtra(e.target.value)}
                    placeholder="e.g. 9876543210, 9123456789"
                  />
                </label>
                <label className="field" style={{ marginTop: 10 }}>
                  <span>WhatsApp message</span>
                  <textarea
                    rows={9}
                    value={waMessage}
                    onChange={(e) => setWaMessage(e.target.value)}
                    placeholder="Message that will open in WhatsApp"
                  />
                </label>
                <div className="modal-btns">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setSendOpen(false);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={async () => {
                      const unique = collectWhatsAppRecipients();
                      if (!unique.length) {
                        flash("Select or enter at least one WhatsApp number.", "err");
                        return;
                      }
                      const text = (waMessage.trim() || buildWhatsAppText(current)).trim();
                      if (!text) {
                        flash("Enter a WhatsApp message before sending.", "err");
                        return;
                      }
                      setWaMessage(text);

                      setBusy(true);
                      try {
                        if (waCanAutoAttach) {
                          const pdf = await buildPdfPayload(current);
                          if (!pdf) return;

                          const result = await api<{
                            ok: boolean;
                            delivered: boolean;
                            via: string;
                            sent?: string[];
                            errors?: Array<{ phone: string; error: string }>;
                          }>("/quotation-v1/send/whatsapp", {
                            method: "POST",
                            body: JSON.stringify({
                              phones: unique.map((e) => e.phone),
                              message: text,
                              filename: pdf.filename,
                              pdfBase64: pdf.pdfBase64,
                              quotationId: current.id,
                              quoteNo: current.quoteNo,
                            }),
                          });
                          if (result.delivered) {
                            await saveQuote("sent");
                            await pushNotif(
                              current.id,
                              `Quotation ${current.quoteNo} sent on WhatsApp with PDF (${(result.sent ?? unique).length} recipient${(result.sent ?? unique).length > 1 ? "s" : ""}).`,
                            );
                            setSendOpen(false);
                            const partial = result.errors?.length
                              ? ` Some failed: ${result.errors.map((e) => e.phone).join(", ")}.`
                              : "";
                            flash(
                              result.via === "cloud"
                                ? `WhatsApp delivered with PDF attachment.${partial}`
                                : `WhatsApp handed off to your webhook with PDF.${partial}`,
                            );
                            return;
                          }
                        }

                        await saveQuote("sent");
                        await pushNotif(
                          current.id,
                          `Quotation ${current.quoteNo} opened on WhatsApp (${unique.length} number${unique.length > 1 ? "s" : ""}).`,
                        );
                        setSendOpen(false);
                        for (const e of unique) {
                          window.open(whatsappChatUrl(e.phone, text), "_blank", "noopener,noreferrer");
                        }
                        flash(
                          unique.length === 1
                            ? "WhatsApp opened with your message. Use Download PDF if you need to attach the file."
                            : `Opened WhatsApp for ${unique.length} numbers. Use Download PDF if you need to attach the file.`,
                        );
                      } catch (e) {
                        flash(e instanceof Error ? e.message : "WhatsApp send failed", "err");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Send
                  </button>
                </div>
              </>
          </div>
        </div>
      ) : null}

      {approvalLink ? (
        <div className="modal-overlay" onClick={() => setApprovalLink(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Customer approval link</h3>
            <p className="modal-msg mono" style={{ wordBreak: "break-all" }}>
              {approvalLink}
            </p>
            <div className="modal-btns">
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  await navigator.clipboard.writeText(approvalLink);
                  flash("Link copied.");
                }}
              >
                Copy link
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setApprovalLink(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pdfHostQuote ? (
        <div className="qgv1-pdf-host" aria-hidden="true">
          <div className="qgv1-preview-fit">
            <QuoteSheet quote={pdfHostQuote} company={company} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
