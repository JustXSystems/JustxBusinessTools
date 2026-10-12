"use client";

import "./finance.css";
import { useState, type ReactNode } from "react";
import { Button, Dialog, Field, FormGrid, Input, Segmented, Select, Textarea } from "@/components/bos";
import type { ImsSession, Period } from "@/lib/ims/api";
import { INVOICE_STAMP, PAY_METHOD_LABEL, PAY_METHODS, type InvoiceDetail, type PayMethod, type PaymentInput } from "@/lib/ims/finance";
import { computeTotals, dateLabel, inrExact, num, PERIOD_OPTIONS, qtyText, round2 } from "@/lib/ims/format";
import { DocumentPaper, type PaperParty } from "../shared/DocumentPaper";

/* ---------- Layout bits ---------- */

export function KeyValues({ rows }: { rows: ReadonlyArray<[string, ReactNode]> }) {
  return (
    <dl className="fin-kv">
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd>{v === null || v === undefined || v === "" ? "—" : v}</dd>
        </div>
      ))}
    </dl>
  );
}

export type StatTone = "coral" | "amber" | "emerald" | "blue";
export function Stats({ items }: { items: ReadonlyArray<{ label: string; value: ReactNode; tone?: StatTone | null }> }) {
  return (
    <div className="fin-stats">
      {items.map((s) => (
        <div key={s.label} className={`fin-stat${s.tone ? ` is-${s.tone}` : ""}`}>
          <b>{s.value}</b>
          <span>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

export type TimelineItem = { key: string; text: ReactNode; meta: ReactNode; tone?: "good" | "bad" | "warn" | null };
export function Timeline({ items, empty = "No activity yet." }: { items: ReadonlyArray<TimelineItem>; empty?: string }) {
  if (!items.length) return <p className="ims-faint">{empty}</p>;
  return (
    <ol className="fin-timeline" aria-label="Activity">
      {items.map((i) => (
        <li key={i.key} className={i.tone ? `is-${i.tone}` : undefined}>
          {i.text}
          <small>{i.meta}</small>
        </li>
      ))}
    </ol>
  );
}

export type PeriodOrAll = Period | "all";
const PERIOD_ALL_OPTIONS: ReadonlyArray<{ value: PeriodOrAll; label: string }> = [{ value: "all", label: "All time" }, ...PERIOD_OPTIONS];

export function PeriodSelect({ value, onChange, allowAll = true }: { value: PeriodOrAll; onChange: (p: PeriodOrAll) => void; allowAll?: boolean }) {
  return (
    <Segmented
      size="sm"
      scroll
      aria-label="Period"
      options={(allowAll ? PERIOD_ALL_OPTIONS : PERIOD_OPTIONS).map((o) => ({ value: o.value, label: o.label }))}
      value={value}
      onChange={onChange}
    />
  );
}

export function BackLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="fin-back" onClick={onClick}>
      ← {children}
    </button>
  );
}

export function QuickChips({ options, onPick, active, label }: { options: ReadonlyArray<{ key: string; label: ReactNode }>; onPick: (key: string) => void; active?: string | null; label: string }) {
  return (
    <div className="fin-chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} type="button" aria-pressed={active === undefined ? undefined : active === o.key} onClick={() => onPick(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Dialogs ---------- */

export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  destructive,
  busy,
  onConfirm,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      icon={{ tone: destructive ? "coral" : "blue", name: destructive ? "warning" : "check" }}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={destructive ? "destructive" : "primary"} onClick={onConfirm} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}

/** Asks for a reason (cancel, hold, dispute, reopen). `minLength` 0 makes it optional. */
export function ReasonDialog({
  open,
  onClose,
  title,
  description,
  label = "Reason",
  placeholder,
  confirmLabel,
  destructive,
  busy,
  minLength = 3,
  suggestions,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  label?: string;
  placeholder?: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  minLength?: number;
  suggestions?: ReadonlyArray<string>;
  onConfirm: (reason: string) => void;
}) {
  const [text, setText] = useState("");
  const [touched, setTouched] = useState(false);
  const short = text.trim().length < minLength;
  const close = () => {
    setText("");
    setTouched(false);
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title={title}
      description={description}
      wide
      actions={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "primary"}
            disabled={busy}
            onClick={() => {
              setTouched(true);
              if (short) return;
              onConfirm(text.trim());
              setText("");
              setTouched(false);
            }}
          >
            {busy ? "Working…" : confirmLabel}
          </Button>
        </>
      }
    >
      {suggestions?.length ? (
        <div style={{ marginBottom: 10 }}>
          <QuickChips label="Common reasons" options={suggestions.map((s) => ({ key: s, label: s }))} onPick={setText} />
        </div>
      ) : null}
      <Field label={minLength > 0 ? `${label} *` : `${label} (optional)`} error={touched && short && minLength > 0 ? `Please write at least ${minLength} characters` : undefined}>
        {({ id, describedBy, invalid }) => (
          <Textarea id={id} aria-describedby={describedBy} aria-invalid={invalid} rows={3} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} maxLength={500} />
        )}
      </Field>
    </Dialog>
  );
}

export function MethodSelect({ id, value, onChange, methods = PAY_METHODS, describedBy }: { id?: string; value: PayMethod; onChange: (m: PayMethod) => void; methods?: ReadonlyArray<PayMethod>; describedBy?: string }) {
  return (
    <Select id={id} aria-describedby={describedBy} value={value} onChange={(e) => onChange(e.target.value as PayMethod)}>
      {methods.map((m) => (
        <option key={m} value={m}>
          {PAY_METHOD_LABEL[m]}
        </option>
      ))}
    </Select>
  );
}

/**
 * Money in / out against one document. Defaults to the full balance; the parent
 * runs the request and returns `undefined` on failure so the dialog stays open.
 */
export function PaymentDialog({
  open,
  onClose,
  title,
  description,
  balance,
  today,
  defaultMethod = "cash",
  confirmLabel = "Record payment",
  busy,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** Upper bound; null when any amount is allowed (on-account receipts). */
  balance: number | null;
  today: string;
  defaultMethod?: PayMethod;
  confirmLabel?: string;
  busy?: boolean;
  onSubmit: (input: PaymentInput) => Promise<unknown>;
}) {
  return open ? (
    <PaymentForm
      title={title}
      description={description}
      balance={balance}
      today={today}
      defaultMethod={defaultMethod}
      confirmLabel={confirmLabel}
      busy={busy}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  ) : null;
}

function PaymentForm({
  title,
  description,
  balance,
  today,
  defaultMethod,
  confirmLabel,
  busy,
  onClose,
  onSubmit,
}: {
  title: ReactNode;
  description?: ReactNode;
  balance: number | null;
  today: string;
  defaultMethod: PayMethod;
  confirmLabel: string;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (input: PaymentInput) => Promise<unknown>;
}) {
  const [amount, setAmount] = useState(balance != null ? String(balance) : "");
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState<PayMethod>(defaultMethod);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [touched, setTouched] = useState(false);
  const value = round2(num(amount));
  const error = !(value > 0) ? "Enter an amount more than zero" : balance != null && value > balance + 0.005 ? `That's more than the balance (${inrExact(balance)})` : date > today ? "Payments can't be dated in the future" : null;
  const needsRef = method === "cheque" || method === "bank" || method === "upi";

  const submit = async () => {
    setTouched(true);
    if (error) return;
    const out = await onSubmit({ amount: value, date, method, reference: reference.trim() || null, notes: notes.trim() || null });
    if (out !== undefined) onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      description={description}
      icon={{ tone: "emerald", name: "wallet" }}
      wide
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="success" icon="check" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="fin-lg">
        {balance != null ? (
          <div className="ims-between" style={{ marginBottom: 12 }}>
            <span className="ims-muted">Balance due</span>
            <span className="fin-amount">{inrExact(balance)}</span>
          </div>
        ) : null}
        <FormGrid columns="1fr 1fr">
          <Field label="Amount (₹) *" error={touched && error && !(value > 0 && (balance == null || value <= balance + 0.005)) ? error : undefined}>
            {({ id, describedBy, invalid }) => (
              <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} type="number" min={0} step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            )}
          </Field>
          <Field label="Date *" error={touched && date > today ? "Payments can't be dated in the future" : undefined}>
            {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />}
          </Field>
          <Field label="Method">{({ id, describedBy }) => <MethodSelect id={id} describedBy={describedBy} value={method} onChange={setMethod} />}</Field>
          <Field label={method === "cheque" ? "Cheque no." : method === "upi" ? "UPI ref / UTR" : method === "bank" ? "UTR / reference" : "Reference (optional)"} hint={needsRef ? "Helps bank reconciliation" : undefined}>
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} />}
          </Field>
          <Field label="Notes (optional)" full>
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />}
          </Field>
        </FormGrid>
        {balance != null && balance > 0 ? (
          <div style={{ marginTop: 10 }}>
            <QuickChips
              label="Quick amounts"
              options={[
                { key: "full", label: `Full ${inrExact(balance)}` },
                { key: "half", label: `Half ${inrExact(round2(balance / 2))}` },
              ]}
              onPick={(k) => setAmount(String(k === "full" ? balance : round2(balance / 2)))}
            />
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

/* ---------- Documents ---------- */

export function sellerOf(session: ImsSession): PaperParty {
  const s = session.settings;
  const b = session.brand;
  return {
    label: "From",
    name: s.businessName || b?.name || "",
    gstin: s.gstin ?? b?.gstin ?? null,
    address: s.address ?? b?.address ?? null,
    state: s.state ? `${s.state}${s.stateCode ? ` (${s.stateCode})` : ""}` : (b?.state ?? null),
    phone: s.phone ?? b?.phone ?? null,
    email: s.email ?? b?.email ?? null,
  };
}

/** Printable GST tax invoice with HSN summary, payment status stamp and terms. */
export function InvoicePaper({ detail, session }: { detail: InvoiceDetail; session: ImsSession }) {
  const inv = detail.invoice;
  const totals = computeTotals(inv.lines, inv.intraState, inv.roundToRupee);
  const stamp = INVOICE_STAMP[inv.displayStatus] ?? (inv.displayStatus === "partial" ? { text: "PART PAID", color: "#D98A1F" } : null);
  const meta: Array<{ label: string; value: ReactNode }> = [
    { label: "Invoice no.", value: inv.isDraftNo ? "Draft" : inv.invoiceNo },
    { label: "Invoice date", value: dateLabel(inv.invoiceDate) },
    { label: "Due date", value: inv.dueDate ? dateLabel(inv.dueDate) : "On receipt" },
    { label: "Place of supply", value: inv.placeOfSupply || session.settings.state || "—" },
  ];
  if (inv.sourceRef) meta.push({ label: "Reference", value: inv.sourceRef });
  return (
    <DocumentPaper
      title={inv.status === "draft" ? "DRAFT INVOICE" : "TAX INVOICE"}
      seller={sellerOf(session)}
      party={{ label: "Bill to", name: inv.customerName, gstin: inv.customerGstin, address: inv.customerAddress, state: inv.placeOfSupply, phone: inv.customerMobile, email: inv.customerEmail }}
      meta={meta}
      totals={totals}
      intraState={inv.intraState}
      notes={inv.notes}
      terms={inv.terms}
      stamp={stamp}
      footer={
        <>
          {detail.hsn.length ? (
            <div>
              <div className="fin-paper-h">HSN / SAC summary</div>
              <table className="bos-inv-paper-table" style={{ marginBottom: 8 }}>
                <thead>
                  <tr>
                    <th>HSN</th>
                    <th>Qty</th>
                    <th>GST</th>
                    <th>Taxable</th>
                    {inv.intraState ? (
                      <>
                        <th>CGST</th>
                        <th>SGST</th>
                      </>
                    ) : (
                      <th>IGST</th>
                    )}
                    <th>Tax</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.hsn.map((h) => (
                    <tr key={`${h.hsn}-${h.gstRate}`}>
                      <td>{h.hsn}</td>
                      <td>{qtyText(h.qty, h.unit)}</td>
                      <td>{h.gstRate}%</td>
                      <td>{inrExact(h.taxable)}</td>
                      {inv.intraState ? (
                        <>
                          <td>{inrExact(round2(h.tax / 2))}</td>
                          <td>{inrExact(round2(h.tax - round2(h.tax / 2)))}</td>
                        </>
                      ) : (
                        <td>{inrExact(h.tax)}</td>
                      )}
                      <td>{inrExact(h.tax)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {inv.status === "issued" ? (
            <div>
              Received {inrExact(inv.amountPaid)} · Balance {inrExact(inv.balance)}
              {inv.payMode ? ` · Last paid by ${inv.payMode.toUpperCase()}` : ""}
            </div>
          ) : null}
          {inv.status === "cancelled" ? <div>Cancelled{inv.cancelReason ? ` — ${inv.cancelReason}` : ""}</div> : null}
        </>
      }
    />
  );
}

export const activityTone = (kind: string, status: string | null): TimelineItem["tone"] => {
  if (kind === "payment" || status === "kept" || status === "resolved") return "good";
  if (kind === "dispute" || kind === "escalation" || status === "broken") return status === "resolved" ? "good" : "bad";
  if (kind === "promise" || kind === "reminder") return "warn";
  return null;
};
