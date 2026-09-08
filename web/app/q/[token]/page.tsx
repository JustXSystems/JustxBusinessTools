"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { QuoteSheet } from "@/components/quotation-v1/QuoteSheet";
import "@/components/quotation-v1/quotation-v1.css";
import { apiUrl } from "@/lib/api-base";
import { DEFAULT_COMPANY, type CompanyProfileV1, type QuotationV1 } from "@/lib/quotation-v1";

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

export default function PublicQuoteApprovePage() {
  const params = useParams();
  const token = String(params?.token ?? "");
  const [quote, setQuote] = useState<QuotationV1 | null>(null);
  const [company, setCompany] = useState<CompanyProfileV1>({ ...DEFAULT_COMPANY });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [approverName, setApproverName] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [nowTick, setNowTick] = useState(() => new Date().toISOString());

  useEffect(() => {
    if (!token) return;
    fetch(apiUrl(`/api/public/quotation-v1/${encodeURIComponent(token)}`))
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Not found");
        setQuote(data.quotation);
        const c = (data.company ?? data.quotation?.companySnapshot ?? null) as CompanyProfileV1 | null;
        if (c) setCompany({ ...DEFAULT_COMPANY, ...c, logo: c.logo ?? null });
        const customerName = String(data.quotation?.customer?.name ?? "").trim();
        if (customerName) setApproverName((prev) => prev || customerName);
      })
      .catch((e: Error) => setError(e.message));
  }, [token]);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(new Date().toISOString()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const canDecide = quote?.status === "sent" || quote?.status === "submitted";
  const nameReady = approverName.trim().length >= 2;
  const liveStamp = useMemo(() => formatDateTime(nowTick), [nowTick]);

  async function decide(decision: "approved" | "rejected") {
    const name = approverName.trim();
    if (name.length < 2) {
      setError("Please enter the name of the person approving.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await fetch(apiUrl(`/api/public/quotation-v1/${encodeURIComponent(token)}/decide`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, approverName: name }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed");
      setQuote(data.quotation);
      if (data.company) {
        setCompany({ ...DEFAULT_COMPANY, ...data.company, logo: data.company.logo ?? null });
      }
      setConfirmOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  function requestApprove() {
    setError("");
    if (!nameReady) {
      setError("Please enter the name of the person approving.");
      return;
    }
    setConfirmOpen(true);
  }

  return (
    <div className="qgv1-root" style={{ minHeight: "100vh", padding: "20px 16px 32px" }}>
      <main className="qgv1-main preview-solo">
        <div className="qgv1-card" style={{ textAlign: "center" }}>
          <h1 className="tool-header-title" style={{ margin: 0 }}>
            Review Your Quotation
          </h1>
          <p className="tool-header-sub" style={{ marginTop: 6 }}>
            Customer approval
          </p>
        </div>
        {error ? <div className="error-banner">{error}</div> : null}
        {quote ? (
          <>
            {quote.status === "approved" ? (
              <div className="qgv1-banner" style={{ background: "#e7f3ec", borderColor: "#9fd4b5", color: "#2e7d5b" }}>
                Approved by {quote.approvedBy || "customer"}
                {quote.approvedAt ? ` on ${formatDateTime(quote.approvedAt)}` : ""}.
              </div>
            ) : null}
            {quote.status === "rejected" ? (
              <div className="error-banner">
                Rejected by {quote.rejectedBy || "customer"}
                {quote.rejectedAt ? ` on ${formatDateTime(quote.rejectedAt)}` : ""}.
              </div>
            ) : null}
            <div className="preview-pane">
              <div className="preview-pane-toolbar">
                <div>
                  <span className="preview-pane-title">Quotation</span>
                  <span className="preview-pane-sub">{quote.quoteNo}</span>
                </div>
              </div>
              <div className="preview-pane-scroll qgv1-sheet-scroll">
                <QuoteSheet quote={quote} company={company} />
              </div>
            </div>
            {canDecide ? (
              <div className="qgv1-card" style={{ textAlign: "left", maxWidth: 520, margin: "0 auto" }}>
                <label className="field">
                  <span className="label">Your full name (approver)</span>
                  <input
                    value={approverName}
                    onChange={(e) => setApproverName(e.target.value)}
                    placeholder="Enter the name of the person approving"
                    autoComplete="name"
                    disabled={busy}
                    maxLength={120}
                  />
                </label>
                <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
                  Approval date &amp; time will be recorded as: <strong>{liveStamp}</strong>
                </p>
                <p className="muted" style={{ marginTop: 8 }}>
                  By approving, you confirm you have verified all details and want us to proceed on these terms.
                </p>
                <div className="qgv1-btn-row" style={{ justifyContent: "center" }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || !nameReady}
                    onClick={requestApprove}
                  >
                    Approve Quotation
                  </button>
                  <button
                    type="button"
                    className="btn btn-destructive"
                    disabled={busy || !nameReady}
                    onClick={() => {
                      if (
                        confirm(
                          `Reject this quotation as ${approverName.trim()}? This will be recorded with the current date and time.`,
                        )
                      ) {
                        void decide("rejected");
                      }
                    }}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : !error ? (
          <p className="muted">Loading…</p>
        ) : null}
      </main>

      {confirmOpen ? (
        <div className="modal-overlay" onClick={() => !busy && setConfirmOpen(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h3 className="modal-title">Confirm quotation approval</h3>
            <p className="modal-msg">
              You are <strong>{approverName.trim()}</strong>, and you have verified all the details in this
              quotation, and you are confirming this quotation approval to proceed to process further.
            </p>
            <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
              Recorded at: <strong>{liveStamp}</strong>
            </p>
            <div className="modal-btns">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void decide("approved")}
              >
                {busy ? "Saving…" : "Yes, I confirm approval"}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => setConfirmOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
