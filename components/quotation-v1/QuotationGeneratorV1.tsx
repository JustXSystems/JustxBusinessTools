"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, fetchProfile } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  buildTerms,
  CATEGORIES,
  CATEGORY_ENGAGEMENTS,
  computeTotals,
  DEFAULT_COMPANY,
  engMeta,
  getMissingRequiredFields,
  INDIAN_STATES,
  money,
  newQuotationDraft,
  numToWordsIndian,
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
import { QuoteSheet } from "./QuoteSheet";
import "./quotation-v1.css";

type Route = "new" | "list" | "notifications" | "history" | "company";

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
  const [current, setCurrent] = useState<QuotationV1>(() => newQuotationDraft());
  const [list, setList] = useState<QuotationV1[]>([]);
  const [history, setHistory] = useState<QuoteHistoryRow[]>([]);
  const [notifications, setNotifications] = useState<QuoteNotification[]>([]);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [approvalLink, setApprovalLink] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  const totals = useMemo(() => computeTotals(current, company), [current, company]);
  const pendingApprovals = list.filter((q) => q.status === "sent").length;
  const isSaved = Boolean(current.quoteNo && snapshotOf(current) === lastSaved);

  const flash = useCallback((msg: string, kind = "ok") => {
    setToast({ msg, kind });
    window.setTimeout(() => setToast(null), 4200);
  }, []);

  const reloadMeta = useCallback(async () => {
    const [c, h, n, q] = await Promise.all([
      api<{ company: CompanyProfileV1 | null }>("/quotation-v1/company"),
      api<{ history: QuoteHistoryRow[] }>("/quotation-v1/history"),
      api<{ notifications: QuoteNotification[] }>("/quotation-v1/notifications"),
      api<{ quotations: QuotationV1[] }>("/quotation-v1"),
    ]);
    if (c.company) setCompany({ ...DEFAULT_COMPANY, ...c.company });
    setHistory(h.history ?? []);
    setNotifications(n.notifications ?? []);
    setList((q.quotations ?? []) as QuotationV1[]);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await reloadMeta();
        const profile = await fetchProfile().catch(() => null);
        setCompany((prev) => {
          if (prev.name !== DEFAULT_COMPANY.name) return prev;
          if (!profile) return prev;
          return {
            ...prev,
            name: profile.businessName || prev.name,
            address: [profile.addressLine1, profile.addressLine2].filter(Boolean).join("\n"),
            state: profile.state || prev.state,
            gstin: profile.gstin || prev.gstin,
            phone: profile.phone || prev.phone,
            email: profile.email || prev.email,
            quotePrefix: (profile.businessName || "QT")
              .replace(/[^A-Za-z0-9]/g, "")
              .slice(0, 3)
              .toUpperCase() || "QT",
          };
        });
      } catch (e) {
        flash(e instanceof Error ? e.message : "Failed to load", "err");
      }
    })();
  }, [flash, reloadMeta]);

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
      flash(`Saved as ${saved.quoteNo}.`);
      await reloadMeta();
      return saved;
    } catch (e) {
      flash(e instanceof Error ? e.message : "Save failed", "err");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function exportPdf(q: QuotationV1) {
    if (!validateSaved(q)) return;
    setShowPreview(true);
    setBusy(true);
    try {
      await new Promise((r) => setTimeout(r, 80));
      const node = document.getElementById("quote-sheet");
      if (!node) throw new Error("Preview not ready");
      const html2canvas = (await import("html2canvas")).default;
      const { jsPDF } = await import("jspdf");
      const canvas = await html2canvas(node, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        ignoreElements: (el) => el.classList?.contains("page-break-marker"),
      });
      const pdf = new jsPDF("p", "pt", "a4");
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgW = pageW;
      const imgH = (canvas.height * imgW) / canvas.width;
      let heightLeft = imgH;
      let position = 0;
      const img = canvas.toDataURL("image/png");
      pdf.addImage(img, "PNG", 0, position, imgW, imgH);
      heightLeft -= pageH;
      while (heightLeft > 0) {
        position -= pageH;
        pdf.addPage();
        pdf.addImage(img, "PNG", 0, position, imgW, imgH);
        heightLeft -= pageH;
      }
      const filename = `${(q.quoteNo || "Quotation").replace(/[^\w.-]+/g, "_")}.pdf`;
      pdf.save(filename);
      flash("PDF downloaded — check your Downloads folder.");
    } catch (e) {
      flash(e instanceof Error ? e.message : "PDF export failed", "err");
    } finally {
      setBusy(false);
    }
  }

  function validateSaved(q: QuotationV1) {
    const missing = getMissingRequiredFields(q);
    if (missing.length) {
      flash(`Please fill in before continuing: ${missing.join(", ")}.`, "err");
      return false;
    }
    if (!q.quoteNo || snapshotOf(q) !== lastSaved) {
      flash("Please Save this quotation first — sending and downloading require a saved quotation.", "err");
      return false;
    }
    return true;
  }

  function buildMessageText(q: QuotationV1) {
    const t = computeTotals(q, company);
    return `Dear ${q.customer.name || "Customer"},

Please find our quotation details below:

* Quotation No.: ${q.quoteNo}
* Type: ${typeLabel(q)}
* Date: ${q.date}
* Valid Till: ${q.validTill}
* Grand Total: ₹${money(t.grand)} (${numToWordsIndian(t.grand)})

We look forward to your confirmation.

Regards,
${company.name}
${company.phone}`;
  }

  async function pushNotif(quotationId: string, message: string) {
    await api("/quotation-v1/notifications", {
      method: "POST",
      body: JSON.stringify({ quotationId, message }),
    });
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
            Category templates · live GST · PDF &amp; customer approval
            {user?.email ? ` · ${user.email}` : ""}
          </div>
        </div>
        {route === "new" ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setCurrent(newQuotationDraft());
              setLastSaved(null);
              setShowPreview(false);
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
                if (item.id === "new" && !current.quoteNo) setShowPreview(false);
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
          <>
            <div className="qgv1-page-head">
              <div>
                <h1>Compose quotation</h1>
                <p>Fill required fields, save, then preview PDF or send for approval.</p>
              </div>
            </div>

            {!bannerDismissed ? (
              <div className="qgv1-banner">
                <button type="button" className="qgv1-banner-x" onClick={() => setBannerDismissed(true)}>
                  ✕
                </button>
                <b>How saving works:</b> Category, For, Prepared By, Customer Name, and Phone are required
                before Save. Send / PDF need a saved quotation with no pending edits.
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
                    placeholder="Name of the person preparing this quotation"
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

            <section className="qgv1-card">
              <h3>Terms &amp; notes</h3>
              <textarea
                rows={8}
                value={current.notes}
                onChange={(e) => patch((q) => ({ ...q, notes: e.target.value }))}
              />
            </section>

            <div className="qgv1-btn-row" style={{ marginBottom: 20 }}>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void saveQuote()}>
                Save
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => {
                  setShowPreview(true);
                  void exportPdf(current);
                }}
              >
                Preview / Download PDF
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => {
                  if (!validateSaved(current)) return;
                  setSendOpen(true);
                }}
              >
                Send Via
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={async () => {
                  const saved = await saveQuote("sent");
                  if (!saved) return;
                  const link = `${window.location.origin}/q/${saved.approvalToken}`;
                  setApprovalLink(link);
                  await pushNotif(saved.id, `Approval link generated for ${saved.quoteNo}.`);
                }}
              >
                Get Customer Approval Link
              </button>
              {!isSaved && current.quoteNo ? (
                <span className="pill pill-warning">Unsaved changes</span>
              ) : null}
            </div>

            {showPreview ? (
              <section className="qgv1-card" ref={sheetRef}>
                <h3>Preview</h3>
                <div className="qgv1-sheet-scroll">
                  <QuoteSheet quote={current} company={company} />
                </div>
              </section>
            ) : null}
          </>
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
                    <span className={`pill pill-${q.status === "approved" ? "success" : q.status === "rejected" ? "danger" : q.status === "sent" ? "warning" : "neutral"}`}>
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
                          setShowPreview(true);
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
                <p>Company details printed on every quotation PDF.</p>
              </div>
            </div>
            <div className="qgv1-grid2">
              {(
                [
                  ["name", "Company Name"],
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
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: 12 }}
              onClick={async () => {
                await api("/quotation-v1/company", {
                  method: "PUT",
                  body: JSON.stringify({ company }),
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
        <div className="modal-overlay" onClick={() => setSendOpen(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Send Via</h3>
            <p className="modal-msg">
              Opens WhatsApp / email with a pre-filled message. Attach the downloaded PDF yourself.
            </p>
            <div className="modal-btns">
              <button type="button" className="btn btn-secondary" onClick={() => setSendOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  const phone = current.customer.phone.replace(/\D/g, "");
                  const text = encodeURIComponent(buildMessageText(current));
                  if (phone) window.open(`https://wa.me/91${phone.slice(-10)}?text=${text}`, "_blank");
                  if (current.customer.email) {
                    const subject = encodeURIComponent(
                      `${company.name} — Quotation ${current.quoteNo}`,
                    );
                    window.open(
                      `mailto:${current.customer.email}?cc=${encodeURIComponent(company.salesEmail || "")}&subject=${subject}&body=${text}`,
                      "_blank",
                    );
                  }
                  await saveQuote("sent");
                  await pushNotif(
                    current.id,
                    `Quotation ${current.quoteNo} sent via WhatsApp/Email.`,
                  );
                  setSendOpen(false);
                  flash("Opened WhatsApp / Email. Attach the PDF before sending.");
                }}
              >
                Open apps
              </button>
            </div>
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
