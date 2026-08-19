"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { submitUpiClaim } from "@/lib/api";
import type { PendingUpiClaim, UpiPayInfo } from "@/lib/types/subscription";

function formatInr(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

export function UpiPayMethod({
  toolIds,
  amountInr,
  upi,
  pendingClaim,
  onDone,
  onToast,
}: {
  toolIds: string[];
  amountInr: number;
  upi?: UpiPayInfo;
  pendingClaim?: PendingUpiClaim | null;
  onDone: () => Promise<void>;
  onToast: (msg: string) => void;
}) {
  const { user } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({
    payerName: user?.name ?? "",
    payerEmail: user?.email ?? "",
    payerPhone: user?.phone ?? "",
    payerUpi: "",
    utr: "",
    paidAt: new Date().toISOString().slice(0, 10),
    notes: "",
  });

  useEffect(() => {
    setForm((f) => ({
      ...f,
      payerName: f.payerName || user?.name || "",
      payerEmail: f.payerEmail || user?.email || "",
      payerPhone: f.payerPhone || user?.phone || "",
    }));
  }, [user]);

  useEffect(() => {
    const intent = upi?.intent;
    if (!canvasRef.current || !intent) return;
    let cancelled = false;
    void import("qrcode").then(async (QRCode) => {
      if (cancelled || !canvasRef.current) return;
      await QRCode.toCanvas(canvasRef.current, intent, {
        width: 188,
        margin: 1,
        errorCorrectionLevel: "M",
      });
    });
    return () => {
      cancelled = true;
    };
  }, [upi?.intent]);

  async function copyVpa() {
    if (!upi?.vpa) return;
    try {
      await navigator.clipboard.writeText(upi.vpa);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      onToast(upi.vpa);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await submitUpiClaim({ toolIds, ...form });
      onToast(result.message);
      await onDone();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Could not submit payment details");
    } finally {
      setBusy(false);
    }
  }

  if (pendingClaim?.status === "pending") {
    return (
      <div className="billing-pending">
        <p className="billing-pending-kicker">Payment received — verification in progress</p>
        <h3>Matching UTR {pendingClaim.utr}</h3>
        <p className="muted">
          Amount {formatInr(pendingClaim.amountInr)}
          {pendingClaim.toolIds?.length ? ` · ${pendingClaim.toolIds.length} tool(s)` : ""}.
          Licensed access starts after JustX approves this payment.
        </p>
      </div>
    );
  }

  return (
    <div className="co-method-body">
      {pendingClaim?.status === "rejected" ? (
        <div className="billing-alert billing-alert-error">
          Previous payment was not approved
          {pendingClaim.reviewNote ? `: ${pendingClaim.reviewNote}` : "."} Submit a new UTR if you have paid.
        </div>
      ) : null}

      <div className="co-upi-split">
        <div className="billing-qr-box">
          {upi?.enabled && upi.intent ? (
            <canvas ref={canvasRef} width={188} height={188} aria-label="UPI QR code" />
          ) : (
            <p className="muted">UPI is not configured. Contact JustX.</p>
          )}
          <p className="co-vpa">
            {upi?.payeeName || "JustX Systems LLP"}
            <strong>{upi?.vpa || "—"}</strong>
          </p>
          <div className="admin-form-row">
            {upi?.vpa ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyVpa()}>
                {copied ? "Copied" : "Copy UPI ID"}
              </button>
            ) : null}
            {upi?.intent ? (
              <a className="btn btn-secondary btn-sm" href={upi.intent}>
                Open UPI app
              </a>
            ) : null}
          </div>
          <p className="muted billing-qr-hint">Pay exactly {formatInr(amountInr)}. Do not change the amount.</p>
        </div>

        <form className="billing-confirm co-upi-form" onSubmit={submit}>
          <h3>Confirm UPI payment</h3>
          <p className="muted">Enter the same details as your UPI receipt. Accounts matches UTR to the company ledger.</p>
          <div className="billing-fields">
            <label className="field" htmlFor="billing-payer-name">
              <span>Your name</span>
              <input
                id="billing-payer-name"
                value={form.payerName}
                onChange={(e) => setForm({ ...form, payerName: e.target.value })}
                required
                autoComplete="name"
              />
            </label>
            <label className="field" htmlFor="billing-payer-email">
              <span>Email</span>
              <input
                id="billing-payer-email"
                type="email"
                value={form.payerEmail}
                onChange={(e) => setForm({ ...form, payerEmail: e.target.value })}
                required
                autoComplete="email"
              />
            </label>
            <label className="field" htmlFor="billing-payer-phone">
              <span>WhatsApp / phone</span>
              <input
                id="billing-payer-phone"
                value={form.payerPhone}
                onChange={(e) => setForm({ ...form, payerPhone: e.target.value })}
                autoComplete="tel"
              />
            </label>
            <label className="field" htmlFor="billing-payer-upi">
              <span>Your UPI ID</span>
              <input
                id="billing-payer-upi"
                value={form.payerUpi}
                onChange={(e) => setForm({ ...form, payerUpi: e.target.value })}
                placeholder="name@okaxis"
              />
            </label>
            <label className="field" htmlFor="billing-utr">
              <span>UPI / UTR reference</span>
              <input
                id="billing-utr"
                value={form.utr}
                onChange={(e) => setForm({ ...form, utr: e.target.value })}
                required
                minLength={6}
                placeholder="12-digit UTR / UPI Ref"
              />
            </label>
            <label className="field" htmlFor="billing-paid-at">
              <span>Paid on</span>
              <input
                id="billing-paid-at"
                type="date"
                value={form.paidAt}
                onChange={(e) => setForm({ ...form, paidAt: e.target.value })}
              />
            </label>
            <label className="field billing-notes" htmlFor="billing-notes">
              <span>Notes (optional)</span>
              <input
                id="billing-notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </label>
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy || !upi?.enabled}>
            {busy ? "Submitting…" : "Submit payment confirmation"}
          </button>
          <p className="muted billing-legal">
            Tools unlock after JustX verifies the credit. Card payments below are processed by the selected gateway.
          </p>
        </form>
      </div>
    </div>
  );
}
