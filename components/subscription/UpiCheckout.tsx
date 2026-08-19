"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { submitUpiClaim, startCheckout } from "@/lib/api";
import type { CartQuote, PayGatewayOption, PendingUpiClaim, UpiPayInfo } from "@/lib/types/subscription";

function formatInr(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

export function UpiCheckout({
  quote,
  upi,
  pendingClaim,
  gateways,
  onDone,
  onToast,
}: {
  quote: CartQuote;
  upi?: UpiPayInfo;
  pendingClaim?: PendingUpiClaim | null;
  gateways: PayGatewayOption[];
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

  const amount = upi?.amountInr ?? quote.totalInr;
  const toolIds = quote.lines.map((l) => l.toolId);

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
        width: 200,
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
      const result = await submitUpiClaim({
        toolIds,
        ...form,
      });
      onToast(result.message);
      await onDone();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Could not submit payment details");
    } finally {
      setBusy(false);
    }
  }

  async function payGateway() {
    setBusy(true);
    try {
      const result = await startCheckout("cart", toolIds);
      if (result.activated) {
        onToast("Selected tools are now licensed");
        await onDone();
        return;
      }
      if (result.checkoutUrl) {
        window.open(result.checkoutUrl, "_blank", "noopener,noreferrer");
        onToast("Complete payment in the checkout window");
      } else {
        onToast(result.message ?? "Checkout started");
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Gateway checkout failed");
    } finally {
      setBusy(false);
    }
  }

  if (pendingClaim?.status === "pending") {
    return (
      <div className="billing-pending">
        <p className="billing-pending-kicker">Payment received — verification in progress</p>
        <h3>We are matching UTR {pendingClaim.utr}</h3>
        <p className="muted">
          Amount {formatInr(pendingClaim.amountInr)}
          {pendingClaim.toolIds?.length ? ` · ${pendingClaim.toolIds.length} tool(s)` : ""}.
          Licensed access starts after JustX approves this payment.
        </p>
      </div>
    );
  }

  return (
    <div className="billing-checkout" id="checkout">
      {pendingClaim?.status === "rejected" ? (
        <div className="billing-alert billing-alert-error">
          Previous payment was not approved
          {pendingClaim.reviewNote ? `: ${pendingClaim.reviewNote}` : "."} If you have paid, submit a new UTR below.
        </div>
      ) : null}

      <ol className="billing-steps">
        <li>
          <span>1</span> Pay {formatInr(amount)} to JustX
        </li>
        <li>
          <span>2</span> Enter UTR
        </li>
        <li>
          <span>3</span> Manual verification
        </li>
      </ol>

      <div className="billing-checkout-grid">
        <aside className="billing-order">
          <h3>Order summary</h3>
          <ul className="billing-line-items">
            {quote.lines.map((line) => (
              <li key={line.toolId}>
                <span>
                  {line.name}
                  <em>{line.category}</em>
                </span>
                <strong>{formatInr(line.priceInr)}</strong>
              </li>
            ))}
          </ul>
          <dl className="billing-dl">
            <div>
              <dt>Billing</dt>
              <dd>{quote.billingInterval === "year" ? "Yearly" : "Monthly"}</dd>
            </div>
            <div>
              <dt>Amount payable</dt>
              <dd className="billing-amount">{formatInr(amount)}</dd>
            </div>
            <div>
              <dt>Beneficiary</dt>
              <dd>{upi?.payeeName || "JustX Systems LLP"}</dd>
            </div>
            <div>
              <dt>UPI ID</dt>
              <dd className="billing-vpa">
                {upi?.vpa || "—"}
                {upi?.vpa ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyVpa()}>
                    {copied ? "Copied" : "Copy"}
                  </button>
                ) : null}
              </dd>
            </div>
          </dl>

          <div className="billing-qr-box">
            {upi?.enabled && upi.intent ? (
              <canvas ref={canvasRef} width={200} height={200} aria-label="UPI QR code" />
            ) : (
              <p className="muted">UPI is not configured. Contact JustX.</p>
            )}
            {upi?.intent ? (
              <a className="btn btn-secondary btn-sm" href={upi.intent}>
                Open in UPI app
              </a>
            ) : null}
            <p className="muted billing-qr-hint">Scan with any UPI app. Do not change the amount.</p>
          </div>
        </aside>

        <form className="billing-confirm" onSubmit={submit}>
          <h3>Confirm payment</h3>
          <p className="muted">Use the same details as your UPI receipt. JustX matches UTR against the company account.</p>

          <fieldset className="billing-fieldset">
            <legend>Payer</legend>
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
            </div>
          </fieldset>

          <fieldset className="billing-fieldset">
            <legend>Payment proof</legend>
            <div className="billing-fields">
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
          </fieldset>

          <button type="submit" className="btn btn-primary" disabled={busy || !upi?.enabled}>
            {busy ? "Submitting…" : "Submit payment confirmation"}
          </button>
          <p className="muted billing-legal">
            Selected tools unlock after JustX verifies the credit. False UTR submissions may be rejected.
          </p>

          {gateways.length > 0 ? (
            <div className="billing-alt">
              <p className="billing-alt-label">Alternative payment methods</p>
              <div className="admin-form-row">
                {gateways.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy}
                    onClick={() => void payGateway()}
                  >
                    {g.displayName}
                    {g.mode === "test" ? " (test)" : ""}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </form>
      </div>
    </div>
  );
}
