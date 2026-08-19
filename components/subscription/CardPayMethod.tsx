"use client";

import { useMemo, useState } from "react";
import { startCheckout } from "@/lib/api";
import type { PayGatewayOption } from "@/lib/types/subscription";

function formatInr(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

function supportsCards(g: PayGatewayOption) {
  const methods = g.methods ?? ["debit", "credit"];
  return methods.includes("debit") || methods.includes("credit");
}

export function CardPayMethod({
  kind,
  toolIds,
  amountInr,
  gateways,
  onDone,
  onToast,
}: {
  kind: "debit" | "credit";
  toolIds: string[];
  amountInr: number;
  gateways: PayGatewayOption[];
  onDone: () => Promise<void>;
  onToast: (msg: string) => void;
}) {
  const eligible = useMemo(() => gateways.filter(supportsCards), [gateways]);
  const [gatewayId, setGatewayId] = useState<number | null>(eligible[0]?.id ?? null);
  const [busy, setBusy] = useState(false);

  const selected = eligible.find((g) => g.id === gatewayId) ?? eligible[0] ?? null;
  const title = kind === "debit" ? "Debit card" : "Credit card";

  async function pay() {
    if (!selected) return;
    setBusy(true);
    try {
      const result = await startCheckout("cart", toolIds, {
        gatewayId: selected.id,
        method: kind,
      });
      if (result.activated) {
        onToast("Payment successful. Selected tools are now licensed.");
        await onDone();
        return;
      }
      if (result.checkoutUrl) {
        window.open(result.checkoutUrl, "_blank", "noopener,noreferrer");
        onToast(`Complete ${title.toLowerCase()} payment on ${selected.displayName}`);
        return;
      }
      onToast(result.message ?? `${selected.displayName} checkout started`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Gateway checkout failed");
    } finally {
      setBusy(false);
    }
  }

  if (eligible.length === 0) {
    return (
      <div className="co-card-empty">
        <h3>{title}</h3>
        <p className="muted">
          No card payment gateway is enabled for this workspace. Use UPI (default), or ask JustX to enable Razorpay,
          Cashfree, or Stripe under Admin → Gateways.
        </p>
      </div>
    );
  }

  return (
    <div className="co-method-body">
      <h3>Pay by {title.toLowerCase()}</h3>
      <p className="muted">
        Card numbers are entered on the payment gateway — not on JustX. Choose a processor, then continue to a
        PCI-compliant hosted checkout for {formatInr(amountInr)}.
      </p>

      <fieldset className="co-gw-list">
        <legend>Payment gateway</legend>
        {eligible.map((g) => (
          <label key={g.id} className={`co-gw-option${selected?.id === g.id ? " is-selected" : ""}`}>
            <input
              type="radio"
              name="pg-gateway"
              checked={selected?.id === g.id}
              onChange={() => setGatewayId(g.id)}
            />
            <span>
              <strong>{g.displayName}</strong>
              <em>
                {g.provider}
                {g.mode === "test" ? " · test mode" : " · live"}
              </em>
            </span>
          </label>
        ))}
      </fieldset>

      <ul className="co-secure-points">
        <li>3-D Secure / OTP as required by your bank</li>
        <li>Visa, Mastercard, RuPay where the gateway supports them</li>
        <li>Licenses activate after the gateway confirms the charge</li>
      </ul>

      <button type="button" className="btn btn-primary" disabled={busy || !selected} onClick={() => void pay()}>
        {busy ? "Opening gateway…" : `Pay ${formatInr(amountInr)} with ${selected?.displayName ?? "gateway"}`}
      </button>
    </div>
  );
}
