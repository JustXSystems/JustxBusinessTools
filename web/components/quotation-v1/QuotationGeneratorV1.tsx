"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, fetchProfile } from "@/lib/api";
import { publicAssetUrl, withBasePath } from "@/lib/base-path";
import { useAuth } from "@/components/auth/AuthProvider";
import { useLiveRefresh, invalidateAdminData } from "@/hooks/useLiveRefresh";
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
  normalizeSendSettings,
  numToWordsIndian,
  quotationPdfToBase64,
  renderPageBreakMarkers,
  sanitizeNumStr,
  snapshotOf,
  templateItems,
  typeLabel,
  type CategoryKey,
  type CompanyProfileV1,
  type EngagementKey,
  type QuotationV1,
  type QuoteHistoryRow,
  type QuoteNotification,
} from "@/lib/quotation-v1";
import type { BusinessProfileSendSettings } from "@/lib/types/business-profile";
import { deliverToolArtifact, pdfBase64ToBytes } from "@/lib/artifact-delivery";
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
  const [toast, setToast] = useState<{ msg: string; kind: string } | null>(null);
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
  const [approvalLink, setApprovalLink] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const preparedBySeeded = useRef(false);

  const totals = useMemo(() => computeTotals(current, company), [current, company]);
  const pendingApprovals = list.filter((q) => q.status === "sent").length;
  const isSaved = Boolean(current.quoteNo && snapshotOf(current) === lastSaved);

  const flash = useCallback((msg: string, kind = "ok") => {
    setToast({ msg, kind });
    window.setTimeout(() => setToast(null), 4200);
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
    setList((q.quotations ?? []) as QuotationV1[]);
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
      const data = await api<{ quotation: QuotationV1 }>("/quotation-v1", {
        method: "POST",
        body: JSON.stringify({
          quotation: {
            ...payload,
            _catCode: CATEGORIES[payload.category].code,
            _engCode: engMeta(payload.category, payload.engagement).code,
          },
          grandTotal: computeTotals(payload, company).grand,
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
      return await quotationPdfToBase64(q);
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
  async function downloadPdf(q: QuotationV1) {
    setBusy(true);
    try {
      const payload = await buildPdfPayload(q);
      if (!payload) return;
      forceDownloadPdf(payload.filename, payload.pdfBase64);
      flash(`Downloaded ${payload.filename}.`);
    } catch (e) {
      flash(e instanceof Error ? e.message : "PDF download failed", "err");
    } finally {
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

  function messageVars(q: QuotationV1) {
    const t = computeTotals(q, company);
    return {
      customerName: q.customer.name || "Customer",
      quoteNo: q.quoteNo || "",
      typeLabel: typeLabel(q),
      date: q.date,
      validTill: q.validTill,
      grandTotal: money(t.grand),
      grandTotalWords: numToWordsIndian(t.grand),
      companyName: company.name,
      companyPhone: company.phone,
    };
  }

  function buildWhatsAppText(q: QuotationV1) {
    const send = normalizeSendSettings(sendSettings);
    const tpl =
      send.whatsappMessage?.trim() ||
      DEFAULT_WHATSAPP_MESSAGE ||
      send.email.message ||
      DEFAULT_SEND_SETTINGS.email.message;
    return fillSendTemplate(tpl, messageVars(q));
  }

  function openSendModal(channel: SendChannel) {
    if (!validateSaved(current)) return;
    const send = normalizeSendSettings(sendSettings);
    const vars = messageVars(current);
    const customerPhone = current.customer.phone.replace(/\D/g, "");
    const defaults = [
      ...(customerPhone ? [`customer:${customerPhone}`] : []),
      ...send.whatsappNumbers.filter((n) => n.phone).map((n) => n.id),
    ];
    setWaSelected(defaults);
    setWaExtra("");
    setWaMessage(
      fillSendTemplate(
        send.whatsappMessage?.trim() || DEFAULT_WHATSAPP_MESSAGE,
        vars,
      ),
    );
    setEmailTo(send.email.to.trim() || current.customer.email || "");
    const ccConfigured = send.email.cc.trim();
    setEmailCc(
      ccConfigured ||
        [company.salesEmail, company.managerEmail].filter(Boolean).join(", "),
    );
    setEmailSubject(fillSendTemplate(send.email.subject || DEFAULT_SEND_SETTINGS.email.subject, vars));
    setEmailMessage(fillSendTemplate(send.email.message || DEFAULT_SEND_SETTINGS.email.message, vars));
    setSendChannel(channel);
    setSendOpen(true);
    if (channel === "whatsapp") {
      void api<{ canAutoAttach?: boolean }>("/quotation-v1/send/whatsapp/status")
        .then((s) => setWaCanAutoAttach(Boolean(s.canAutoAttach)))
        .catch(() => setWaCanAutoAttach(false));
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
    const rows = history.map((h) => ({
      "Q No.": h.quoteNo || "(unsaved)",
      Customer: h.customerName,
      Type: h.typeLabel,
      Status: h.status,
      Amount: h.grand,
      Saved: h.savedAt,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "History");
    XLSX.writeFile(wb, "quotation-history.xlsx");
    flash("History Excel downloaded.");
  }

  const unread = notifications.filter((n) => !n.read).length;

  const NAV: Array<{ id: Route; label: string; hint: string }> = [
    { id: "new", label: "Compose", hint: "Build a quote" },
    { id: "list", label: "Saved", hint: "Open & manage" },
    { id: "notifications", label: "Alerts", hint: "Approvals & sends" },
    { id: "history", label: "History", hint: "Save log" },
    { id: "company", label: "Letterhead", hint: "Company details" },
  ];

  return (
    <div className="qgv1-root">
      <header className="tool-header qgv1-tool-head">
        <Link href="/" className="back-btn" aria-label="Back">
          ←
        </Link>
        <div className="tool-header-text">
          <div className="tool-header-title">Quotation Generator V1</div>
          <div className="tool-header-sub">
            Draft · submit to company delivery · PDF · WhatsApp / Email
            {user?.email ? ` · ${user.email}` : ""}
          </div>
        </div>
        {route === "new" ? (
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
        ) : null}
      </header>

      <nav className="qgv1-seg" aria-label="Quotation sections">
        {NAV.map((item) => {
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
          <div className="qgv1-workspace preview-workspace">
            <div className="qgv1-editor preview-editor">
            <div className="qgv1-page-head">
              <div>
                <h1>Compose quotation</h1>
                <p>Edit left · live preview right. Save draft, Submit to company delivery, Download PDF, or send WhatsApp / Email.</p>
              </div>
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

            <section className="qgv1-card">
              <div className="qgv1-label">Category *</div>
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
              {current.category === "other" ? (
                <input
                  className="qgv1-input"
                  style={{ marginTop: 8, maxWidth: 340 }}
                  placeholder="e.g. Water Heater, CCTV…"
                  value={current.categoryCustomLabel}
                  onChange={(e) => patch((q) => ({ ...q, categoryCustomLabel: e.target.value }))}
                />
              ) : null}
              <div className="qgv1-label" style={{ marginTop: 14 }}>
                For *
              </div>
              <div className="qgv1-btn-row">
                {CATEGORY_ENGAGEMENTS[current.category].map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`btn btn-sm ${current.engagement === k ? "btn-primary" : "btn-secondary"}`}
                    onClick={() => switchType(current.category, k)}
                  >
                    {engMeta(current.category, k).label}
                  </button>
                ))}
              </div>
            </section>

            <section className="qgv1-card">
              <h3>Quotation details</h3>
              <div className="qgv1-grid2">
                <label className="field">
                  <span>Quotation No.</span>
                  <input
                    className="mono"
                    disabled
                    value={previewQuoteNo(current, company, {})}
                  />
                </label>
                <label className="field">
                  <span>Status</span>
                  <input disabled value={current.status} />
                </label>
                <label className="field">
                  <span>Date</span>
                  <input
                    type="date"
                    value={current.date}
                    onChange={(e) => patch((q) => ({ ...q, date: e.target.value }))}
                  />
                </label>
                <label className="field">
                  <span>Valid Till</span>
                  <input
                    type="date"
                    value={current.validTill}
                    onChange={(e) => patch((q) => ({ ...q, validTill: e.target.value }))}
                  />
                </label>
                <label className="field" style={{ gridColumn: "1 / -1" }}>
                  <span>Prepared By *</span>
                  <input
                    value={current.preparedBy}
                    onChange={(e) => patch((q) => ({ ...q, preparedBy: e.target.value }))}
                    placeholder="Auto-filled from your login name"
                  />
                </label>
              </div>
            </section>

            <section className="qgv1-card">
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

            <section className="qgv1-card">
              <div className="qgv1-page-head" style={{ marginBottom: 10 }}>
                <h3 style={{ margin: 0 }}>Line items</h3>
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
                                const v = sanitizeNumStr(e.target.value);
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
                              className="btn btn-danger btn-sm"
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

            <section className="qgv1-card qgv1-notes-card">
              <div className="qgv1-notes-head">
                <h3>Terms &amp; notes</h3>
                <p className="muted">Printed on the quotation PDF under Terms &amp; Conditions.</p>
              </div>
              <textarea
                className="qgv1-notes-area"
                rows={14}
                value={current.notes}
                onChange={(e) => patch((q) => ({ ...q, notes: e.target.value }))}
                placeholder="Payment terms, warranty, delivery timeline, exclusions…"
              />
            </section>

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
                onClick={() => openSendModal("whatsapp")}
              >
                WhatsApp
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => openSendModal("email")}
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
          <section className="qgv1-card">
            <div className="qgv1-page-head">
              <div>
                <h1>Saved quotations</h1>
                <p>Open a quote to edit, or remove it from the shared list.</p>
              </div>
            </div>
            {list.length === 0 ? (
              <div className="empty-state">
                <div className="es-title">No quotations yet</div>
              </div>
            ) : (
              <div className="tracker-list">
                {list.map((q) => (
                  <div key={q.id} className="tracker-row">
                    <div className="tracker-row-main">
                      <span className="tracker-row-title mono">{q.quoteNo}</span>
                      <span className="tracker-row-sub">
                        {q.customer?.name} · {typeLabel(q)} · ₹{money(Number((q as { _grandTotal?: number })._grandTotal ?? computeTotals(q, company).grand))}
                      </span>
                    </div>
                    <span className={`pill pill-${q.status === "approved" ? "success" : q.status === "rejected" ? "danger" : q.status === "sent" ? "warning" : q.status === "submitted" ? "success" : "neutral"}`}>
                      {q.status}
                    </span>
                    <div className="tracker-actions">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          setCurrent(q);
                          setLastSaved(snapshotOf(q));
                          setRoute("new");
                        }}
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
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
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {route === "notifications" ? (
          <section className="qgv1-card">
            <div className="qgv1-page-head">
              <div>
                <h1>Alerts</h1>
                <p>Send and approval activity for this workspace.</p>
              </div>
            </div>
            {notifications.length === 0 ? (
              <p className="muted">No notifications yet.</p>
            ) : (
              notifications.map((n) => (
                <div key={n.id} className="qgv1-notif" data-read={n.read ? "1" : "0"}>
                  <div>
                    <strong>{n.message}</strong>
                    <div className="muted">{n.createdAt?.slice(0, 19).replace("T", " ")}</div>
                  </div>
                  {!n.read ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={async () => {
                        await api(`/quotation-v1/notifications/${n.id}/read`, { method: "POST" });
                        await reloadMeta();
                      }}
                    >
                      Mark read
                    </button>
                  ) : null}
                </div>
              ))
            )}
          </section>
        ) : null}

        {route === "history" ? (
          <section className="qgv1-card">
            <div className="qgv1-page-head">
              <div>
                <h1>Save history</h1>
                <p>Every save is logged here, even if the quote is later deleted.</p>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void exportHistoryExcel()}>
                Export Excel
              </button>
            </div>
            {history.length === 0 ? (
              <p className="muted">History fills as you save quotations.</p>
            ) : (
              <div className="tracker-list">
                {history.map((h) => (
                  <div key={h.id} className="tracker-row">
                    <div className="tracker-row-main">
                      <span className="tracker-row-title mono">{h.quoteNo}</span>
                      <span className="tracker-row-sub">
                        {h.customerName} · {h.typeLabel} · {h.status}
                      </span>
                    </div>
                    <span className="m-val">₹{money(h.grand)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {route === "company" ? (
          <section className="qgv1-card">
            <div className="qgv1-page-head">
              <div>
                <h1>Letterhead</h1>
                <p>
                  Brand name and logo come from{" "}
                  <Link href="/profile">Business Profile</Link>. Other letterhead fields below print on
                  every quotation PDF.
                </p>
              </div>
            </div>
            <div className="qgv1-brand-sync">
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
            <div className="qgv1-grid2">
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

            <div className="qgv1-send-admin">
              <h3 className="qgv1-send-admin-title">Send Via</h3>
              <p className="muted" style={{ marginTop: 0 }}>
                WhatsApp numbers and email templates are configured on the{" "}
                <Link href="/profile">Business Profile</Link> (Business Owner only). Those defaults apply to
                every tool under this profile.
              </p>
            </div>

            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: 12 }}
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
              Save Company Details
            </button>
          </section>
        ) : null}
      </main>

      {sendOpen ? (
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
            <h3 className="modal-title">{sendChannel === "whatsapp" ? "WhatsApp" : "Email"}</h3>

            {sendChannel === "whatsapp" ? (
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
            ) : null}

            {sendChannel === "email" ? (
              <>
                <p className="modal-msg">
                  Preview the message, then Send. With an email webhook configured, the PDF attaches
                  automatically; otherwise your mail app opens with this text. Use Download PDF only if you
                  need to attach the file yourself.
                </p>
                <div className="qgv1-grid2" style={{ marginTop: 8 }}>
                  <label className="field" style={{ gridColumn: "1 / -1" }}>
                    <span>To</span>
                    <input value={emailTo} onChange={(e) => setEmailTo(e.target.value)} />
                  </label>
                  <label className="field" style={{ gridColumn: "1 / -1" }}>
                    <span>CC</span>
                    <input value={emailCc} onChange={(e) => setEmailCc(e.target.value)} placeholder="comma-separated" />
                  </label>
                  <label className="field" style={{ gridColumn: "1 / -1" }}>
                    <span>Subject</span>
                    <input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} />
                  </label>
                  <label className="field" style={{ gridColumn: "1 / -1" }}>
                    <span>Message</span>
                    <textarea rows={7} value={emailMessage} onChange={(e) => setEmailMessage(e.target.value)} />
                  </label>
                </div>
                <div className="modal-btns">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setSendOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={async () => {
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
                        const result = await api<{ ok: boolean; delivered: boolean; via: string }>(
                          "/quotation-v1/send/email",
                          {
                            method: "POST",
                            body: JSON.stringify({
                              to: emailTo.trim(),
                              cc: emailCc.trim(),
                              subject: emailSubject.trim(),
                              message: emailMessage,
                              quotationId: current.id,
                              quoteNo: current.quoteNo,
                              filename: pdf?.filename,
                              pdfBase64: pdf?.pdfBase64,
                            }),
                          },
                        );
                        if (!result.delivered) {
                          const params = new URLSearchParams();
                          if (emailCc.trim()) params.set("cc", emailCc.trim());
                          params.set("subject", emailSubject.trim());
                          params.set("body", emailMessage.slice(0, 1800));
                          window.location.href = `mailto:${emailTo.trim()}?${params.toString()}`;
                        }
                        await saveQuote("sent");
                        await pushNotif(
                          current.id,
                          result.delivered
                            ? `Quotation ${current.quoteNo} emailed to ${emailTo.trim()}.`
                            : `Quotation ${current.quoteNo} opened in mail app for ${emailTo.trim()}.`,
                        );
                        setSendOpen(false);
                        flash(
                          result.delivered
                            ? "Email handed off to your email webhook."
                            : "Opened your mail app with the message. Use Download PDF if you need to attach the file.",
                        );
                      } catch (e) {
                        flash(e instanceof Error ? e.message : "Email send failed", "err");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Send
                  </button>
                </div>
              </>
            ) : null}
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

      {toast ? (
        <div className={`qgv1-toast ${toast.kind}`}>
          {toast.msg}
          <button type="button" onClick={() => setToast(null)}>
            ✕
          </button>
        </div>
      ) : null}
    </div>
  );
}
