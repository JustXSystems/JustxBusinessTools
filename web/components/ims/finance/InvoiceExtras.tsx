"use client";

import { useState } from "react";
import { Alert, Badge, Button, Field, FormGrid, Input, useToast, WidgetCard } from "@/components/bos";
import { finance, installmentGap, portalUrl, splitInstallments, type ImsInstallment, type InstallmentDraft, type InvoiceDetail } from "@/lib/ims/finance";
import { addDaysISO, dateLabel, moneyFmt, round2 } from "@/lib/ims/format";
import { Loaded, useImsAction, useImsData } from "../core";

type Inv = InvoiceDetail["invoice"];

const INSTALLMENT_BADGE: Record<string, { text: string; tone: "emerald" | "amber" | "coral" | "blue" }> = {
  paid: { text: "Paid", tone: "emerald" },
  partial: { text: "Part paid", tone: "amber" },
  pending: { text: "Pending", tone: "blue" },
  overdue: { text: "Overdue", tone: "coral" },
};

const badgeOf = (i: ImsInstallment) => INSTALLMENT_BADGE[i.status === "pending" && i.overdue ? "overdue" : i.status === "partial" && i.overdue ? "overdue" : i.status] ?? INSTALLMENT_BADGE.pending;

/** Installment schedule on an issued tax invoice: payments allocate to the earliest pending installment. */
export function PaymentPlanCard({ inv, today, canWrite }: { inv: Inv; today: string; canWrite: boolean }) {
  const state = useImsData(() => finance.installments(inv.id), [inv.id, inv.balance, inv.status]);
  const { run, busy } = useImsAction();
  const [editing, setEditing] = useState(false);
  const [count, setCount] = useState("3");
  const [firstDue, setFirstDue] = useState(addDaysISO(today, 30));
  const [items, setItems] = useState<InstallmentDraft[]>([]);
  const money = (n: number) => moneyFmt(n, inv.currencyCode);

  const eligibleKind = (inv.docKind || "tax_invoice") === "tax_invoice";
  if (inv.status !== "issued" || !eligibleKind) return null;

  return (
    <Loaded state={state} rows={2}>
      {({ plan, balance }) => {
        if (!plan && balance <= 0.005) return null;
        const gap = installmentGap(items, balance);
        const startEdit = () => {
          const n = Math.max(2, Math.min(60, Math.floor(Number(count)) || 3));
          setItems(splitInstallments(balance, n, firstDue));
          setEditing(true);
        };
        const regenerate = () => {
          const n = Math.max(2, Math.min(60, Math.floor(Number(count)) || 3));
          setItems(splitInstallments(balance, n, firstDue));
        };
        const patch = (i: number, p: Partial<InstallmentDraft>) => setItems((cur) => cur.map((x, j) => (j === i ? { ...x, ...p } : x)));
        const save = async () => {
          const out = await run(
            "plan",
            () => finance.createInstallments(inv.id, { label: `${items.length}-installment plan`, installments: items.map((x) => ({ dueOn: x.dueOn, amount: round2(Number(x.amount) || 0), label: x.label ?? null })) }),
            { success: "Payment plan created" },
          );
          if (out) {
            setEditing(false);
            state.reload();
          }
        };

        if (plan) {
          const next = plan.installments.find((i) => i.status !== "paid");
          return (
            <WidgetCard title="Payment plan" note={plan.status === "completed" ? "Completed" : `${plan.installments.filter((i) => i.status === "paid").length}/${plan.installments.length} paid`}>
              {next ? (
                <p className="fin-note" style={{ marginBottom: 8 }}>
                  Next: {money(next.balance)} due {dateLabel(next.dueOn)}
                  {next.overdue ? " · overdue" : ""}. Payments fill the earliest installment first.
                </p>
              ) : null}
              <div className="fin-table-wrap">
                <table className="fin-table">
                  <tbody>
                    {plan.installments.map((i) => {
                      const b = badgeOf(i);
                      return (
                        <tr key={i.id}>
                          <td>
                            <span className="ims-cell-stack">
                              <span>{dateLabel(i.dueOn)}</span>
                              <small>{i.label || `Installment ${i.seqNo}`}</small>
                            </span>
                          </td>
                          <td className="is-num">
                            {money(i.amount)}
                            {i.amountPaid > 0.005 && i.status !== "paid" ? <small style={{ display: "block" }}>Paid {money(i.amountPaid)}</small> : null}
                          </td>
                          <td style={{ width: 1 }}>
                            <Badge tone={b.tone}>{b.text}</Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {canWrite && plan.status === "active" ? (
                <div className="ims-row" style={{ marginTop: 8 }}>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === "plan-del" || plan.paid > 0.005}
                    title={plan.paid > 0.005 ? "Void the payments first" : undefined}
                    onClick={() => void run("plan-del", () => finance.deleteInstallments(inv.id), { success: "Payment plan removed" })}
                  >
                    Remove plan
                  </Button>
                </div>
              ) : null}
            </WidgetCard>
          );
        }

        return (
          <WidgetCard title="Payment plan" note="Optional">
            {!editing ? (
              <>
                <p className="fin-note" style={{ marginBottom: 8 }}>
                  Split the {money(balance)} balance into a dated schedule. Credit notes or advances applied later do not re-cut an existing plan.
                </p>
                {canWrite ? (
                  <Button size="sm" onClick={startEdit}>
                    Create plan
                  </Button>
                ) : null}
              </>
            ) : (
              <div className="bos-stack" style={{ gap: 10 }}>
                <FormGrid columns="1fr 1fr">
                  <Field label="Installments">{({ id }) => <Input id={id} type="number" min={2} max={60} value={count} onChange={(e) => setCount(e.target.value)} />}</Field>
                  <Field label="First due">{({ id }) => <Input id={id} type="date" min={today} value={firstDue} onChange={(e) => setFirstDue(e.target.value)} />}</Field>
                </FormGrid>
                <div>
                  <Button size="sm" variant="ghost" onClick={regenerate}>
                    Equal monthly split
                  </Button>
                </div>
                {items.map((x, i) => (
                  <FormGrid key={i} columns="1fr 1fr">
                    <Field label={i === 0 ? "Due on" : undefined}>{({ id }) => <Input id={id} type="date" value={x.dueOn} onChange={(e) => patch(i, { dueOn: e.target.value })} />}</Field>
                    <Field label={i === 0 ? `Amount (${(inv.currencyCode || "INR").toUpperCase()})` : undefined}>
                      {({ id }) => <Input id={id} type="number" min={0} step="0.01" value={x.amount} onChange={(e) => patch(i, { amount: Number(e.target.value) })} />}
                    </Field>
                  </FormGrid>
                ))}
                {Math.abs(gap) > 0.005 ? (
                  <Alert tone="amber" title={gap > 0 ? `${money(gap)} not scheduled` : `${money(-gap)} over the balance`}>
                    Installments must add up to the {money(balance)} balance.
                  </Alert>
                ) : null}
                <div className="ims-row">
                  <Button size="sm" variant="primary" disabled={busy === "plan" || Math.abs(gap) > 0.005 || items.some((x) => !x.dueOn || !(Number(x.amount) > 0))} onClick={save}>
                    {busy === "plan" ? "Saving…" : "Save plan"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </WidgetCard>
        );
      }}
    </Loaded>
  );
}

/** Magic-link customer portal: enable / copy link / disable. View + UPI QR only — no card capture. */
export function CustomerPortalCard({ inv, canWrite }: { inv: Inv; canWrite: boolean }) {
  const state = useImsData(() => finance.invoicePortal(inv.id), [inv.id, inv.status]);
  const { run, busy } = useImsAction();
  const { show } = useToast();
  const kind = inv.docKind || "tax_invoice";
  if (inv.status !== "issued" || kind === "proforma" || kind === "credit_note") return null;

  const copy = async (path: string) => {
    const url = portalUrl(path);
    try {
      await navigator.clipboard.writeText(url);
      show({ tone: "emerald", title: "Portal link copied" });
    } catch {
      show({ tone: "coral", title: "Couldn't copy — select the link instead" });
    }
  };

  return (
    <Loaded state={state} rows={1}>
      {(p) => (
        <WidgetCard title="Customer portal" note={p.enabled ? "Link on" : "Off"}>
          <p className="fin-note" style={{ marginBottom: 8 }}>
            {p.enabled
              ? "Anyone with this link can view the invoice and pay by UPI QR. It never shows contact details."
              : "Share a private link where the customer sees the invoice, the balance and a UPI QR. No card payments."}
          </p>
          {p.enabled && p.path ? (
            <>
              <Input aria-label="Customer portal link" readOnly value={typeof window === "undefined" ? p.path : portalUrl(p.path)} onFocus={(e) => e.currentTarget.select()} />
              <div className="ims-row" style={{ marginTop: 8, flexWrap: "wrap" }}>
                <Button size="sm" variant="primary" onClick={() => void copy(p.path!)}>
                  Copy link
                </Button>
                <Button size="sm" variant="ghost" onClick={() => window.open(portalUrl(p.path!), "_blank", "noopener")}>
                  Open
                </Button>
                {canWrite ? (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === "portal-regen"}
                      title="The old link stops working"
                      onClick={() => void run("portal-regen", () => finance.enableInvoicePortal(inv.id, { regenerate: true }), { success: "New link created — the old one no longer works" }).then(() => state.reload())}
                    >
                      New link
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy === "portal-off"} onClick={() => void run("portal-off", () => finance.disableInvoicePortal(inv.id), { success: "Portal link disabled" }).then(() => state.reload())}>
                      Disable
                    </Button>
                  </>
                ) : null}
              </div>
            </>
          ) : canWrite ? (
            <Button size="sm" variant="primary" disabled={busy === "portal-on"} onClick={() => void run("portal-on", () => finance.enableInvoicePortal(inv.id), { success: "Portal link enabled" }).then(() => state.reload())}>
              {busy === "portal-on" ? "Enabling…" : "Enable portal link"}
            </Button>
          ) : null}
        </WidgetCard>
      )}
    </Loaded>
  );
}