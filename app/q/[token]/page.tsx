"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { QuoteSheet } from "@/components/quotation-v1/QuoteSheet";
import "@/components/quotation-v1/quotation-v1.css";
import { DEFAULT_COMPANY, type CompanyProfileV1, type QuotationV1 } from "@/lib/quotation-v1";

const API = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000/api";

export default function PublicQuoteApprovePage() {
  const params = useParams();
  const token = String(params?.token ?? "");
  const [quote, setQuote] = useState<QuotationV1 | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const company = DEFAULT_COMPANY;

  useEffect(() => {
    if (!token) return;
    fetch(`${API}/public/quotation-v1/${encodeURIComponent(token)}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Not found");
        setQuote(data.quotation);
      })
      .catch((e: Error) => setError(e.message));
  }, [token]);

  async function decide(decision: "approved" | "rejected") {
    setBusy(true);
    try {
      const r = await fetch(`${API}/public/quotation-v1/${encodeURIComponent(token)}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Failed");
      setQuote(data.quotation);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="qgv1-root" style={{ minHeight: "100vh", padding: "24px 16px" }}>
      <main className="qgv1-main" style={{ maxWidth: 900, margin: "0 auto" }}>
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
                You approved this quotation.
              </div>
            ) : null}
            {quote.status === "rejected" ? (
              <div className="error-banner">You rejected this quotation.</div>
            ) : null}
            <div className="qgv1-sheet-scroll">
              <QuoteSheet quote={quote} company={company as CompanyProfileV1} />
            </div>
            {quote.status === "sent" ? (
              <div className="qgv1-card" style={{ textAlign: "center" }}>
                <p className="muted">By approving, you confirm you would like us to proceed on these terms.</p>
                <div className="qgv1-btn-row" style={{ justifyContent: "center" }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => void decide("approved")}
                  >
                    Approve Quotation
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={busy}
                    onClick={() => {
                      if (confirm("Reject this quotation?")) void decide("rejected");
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
    </div>
  );
}
