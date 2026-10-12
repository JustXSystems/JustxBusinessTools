"use client";

import { useMemo, useState } from "react";
import { Alert, Button, Dialog, Field, FormGrid, Input, Segmented, Select, Switch, Textarea } from "@/components/bos";
import type { PartyOption } from "@/lib/ims/api";
import { BILL_BADGE, finance, gstStateName, intraStateFor, methodLabel, RUN_BADGE, type BillInput, type ImsBill, type PaymentRun, type PayMethod } from "@/lib/ims/finance";
import { addDaysISO, computeTotals, dateLabel, downloadCsv, inrExact, num, round2 } from "@/lib/ims/format";
import { Loaded, StatusBadge, useIms, useImsAction, useImsData } from "../core";
import { lineKey, LineEditor, toLineInputs, type EditableLine } from "../shared/LineEditor";
import { PartySelect } from "../shared/pickers";
import { ConfirmDialog, KeyValues, MethodSelect, Stats } from "./shared";

/* ---------- Add / edit bill ---------- */

export function BillEditorDialog({ bill, canApprove, onClose, onSaved }: { bill: ImsBill | null; canApprove: boolean; onClose: () => void; onSaved: (id: string) => void }) {
  const { session } = useIms();
  const settings = session.settings;
  const { run, busy } = useImsAction();
  const today = session.today;
  const [supplier, setSupplier] = useState<{ id: string | null; name: string }>({ id: bill?.supplierId ?? null, name: bill?.supplierName ?? "" });
  const [party, setParty] = useState<PartyOption | null>(null);
  const [supplierBillNo, setSupplierBillNo] = useState(bill?.supplierBillNo ?? "");
  const [billDate, setBillDate] = useState(bill?.billDate ?? today);
  const [dueDate, setDueDate] = useState(bill?.dueDate ?? addDaysISO(today, settings.paymentTermsDays));
  const [mode, setMode] = useState<"lines" | "amount">(bill && !bill.lines?.length ? "amount" : "lines");
  const [lines, setLines] = useState<EditableLine[]>(() => (bill?.lines ?? []).map((l) => ({ key: lineKey(), itemId: l.itemId ?? null, name: l.name, sku: l.sku ?? null, hsn: l.hsn ?? null, unit: l.unit ?? null, qty: l.qty, rate: l.rate, discountPct: l.discountPct, gstRate: l.gstRate })));
  const [amount, setAmount] = useState(bill && !bill.lines?.length ? String(bill.subtotal) : "");
  const [taxAmount, setTaxAmount] = useState(bill && !bill.lines?.length ? String(bill.taxTotal) : "");
  const [category, setCategory] = useState(bill?.category ?? "");
  const [notes, setNotes] = useState(bill?.notes ?? "");
  const [approveNow, setApproveNow] = useState(canApprove);
  const [touched, setTouched] = useState(false);

  const intraState = intraStateFor(settings, party?.state || gstStateName(party?.gstin) || null);
  const totals = useMemo(() => computeTotals(toLineInputs(lines), intraState), [lines, intraState]);
  const grand = mode === "lines" ? totals.grandTotal : round2(num(amount) + num(taxAmount));
  const errors = {
    supplier: !supplier.name.trim() ? "Pick a supplier or type a name" : null,
    total: !(grand > 0) ? (mode === "lines" ? "Add at least one line" : "Enter the bill amount") : null,
    due: dueDate && dueDate < billDate ? "The due date can't be before the bill date" : null,
  };
  const invalid = Object.values(errors).some(Boolean);

  const save = async () => {
    setTouched(true);
    if (invalid) return;
    const input: BillInput = {
      supplierId: supplier.id,
      supplierName: supplier.name.trim(),
      supplierBillNo: supplierBillNo.trim() || null,
      billDate,
      dueDate: dueDate || null,
      ...(mode === "lines" ? { lines: toLineInputs(lines) } : { lines: [], amount: round2(num(amount)), taxAmount: round2(num(taxAmount)) }),
      category: category || null,
      notes: notes.trim() || null,
    };
    const out = await run("bill", () => (bill ? finance.updateBill(bill.id, input) : finance.createBill({ ...input, approveNow: canApprove && approveNow })), {
      success: bill ? "Bill updated" : canApprove && approveNow ? "Bill added and approved" : "Bill added — sent for approval",
    });
    if (out) onSaved(out.bill.id);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={bill ? `Edit bill ${bill.billNo}` : "Add supplier bill"}
      description="Record a purchase or expense bill you need to pay. Bills from received purchase orders are created automatically."
      wide
      actions={
        <>
          <span className="ims-muted" style={{ marginRight: "auto", fontSize: 13 }}>
            Total <b className="ims-num">{inrExact(grand)}</b>
          </span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon="check" onClick={save} disabled={busy === "bill"}>
            {busy === "bill" ? "Saving…" : bill ? "Save changes" : "Add bill"}
          </Button>
        </>
      }
    >
      <div className="fin-xl">
        <FormGrid columns="1fr 1fr">
          <Field label="Supplier *" error={touched ? errors.supplier : undefined}>
            {({ id }) => (
              <PartySelect
                id={id}
                kind="supplier"
                value={supplier}
                onChange={(v) => {
                  setSupplier({ id: v.id, name: v.name });
                  setParty(v.party);
                  if (v.party?.paymentTermsDays != null) setDueDate(addDaysISO(billDate, v.party.paymentTermsDays));
                }}
              />
            )}
          </Field>
          <Field label="Supplier's bill / invoice no.">{({ id }) => <Input id={id} value={supplierBillNo} onChange={(e) => setSupplierBillNo(e.target.value)} maxLength={64} placeholder="As printed on their invoice" />}</Field>
          <Field label="Bill date">{({ id }) => <Input id={id} type="date" max={today} value={billDate} onChange={(e) => setBillDate(e.target.value)} />}</Field>
          <Field label="Due date" error={touched ? errors.due : undefined}>
            {({ id, describedBy, invalid: bad }) => <Input id={id} aria-describedby={describedBy} aria-invalid={bad} type="date" min={billDate} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}
          </Field>
        </FormGrid>

        <div className="fin-section" style={{ marginTop: 14 }}>
          <div className="ims-between" style={{ marginBottom: 10 }}>
            <h3 className="fin-section-title" style={{ margin: 0 }}>
              Bill contents
            </h3>
            <Segmented
              size="sm"
              aria-label="Bill entry mode"
              value={mode}
              onChange={setMode}
              options={[
                { value: "lines", label: "Itemised (GST lines)" },
                { value: "amount", label: "Amount only" },
              ]}
            />
          </div>
          {mode === "lines" ? (
            <LineEditor lines={lines} onChange={setLines} intraState={intraState} price="purchase" />
          ) : (
            <FormGrid columns="1fr 1fr 1fr">
              <Field label="Taxable amount (₹) *" error={touched && errors.total ? errors.total : undefined}>
                {({ id, describedBy, invalid: bad }) => <Input id={id} aria-describedby={describedBy} aria-invalid={bad} type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />}
              </Field>
              <Field label="GST amount (₹)">{({ id }) => <Input id={id} type="number" min={0} step="0.01" value={taxAmount} onChange={(e) => setTaxAmount(e.target.value)} />}</Field>
              <Field label="Category">
                {({ id }) => (
                  <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="">Purchase</option>
                    {settings.taxonomy.expenseCategories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </FormGrid>
          )}
          {touched && mode === "lines" && errors.total ? (
            <p className="ims-neg" role="alert" style={{ fontSize: 12.5 }}>
              {errors.total}
            </p>
          ) : null}
        </div>

        <FormGrid columns="1fr">
          <Field label="Notes">{({ id }) => <Textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />}</Field>
        </FormGrid>
        {!bill ? (
          canApprove ? (
            <label className="ims-row" style={{ marginTop: 10, fontSize: 13 }}>
              <Switch checked={approveNow} onChange={setApproveNow} aria-label="Approve for payment now" />
              Approve for payment now
            </label>
          ) : (
            <p className="fin-note" style={{ marginTop: 10 }}>
              The bill goes to an approver before it can be paid.
            </p>
          )
        ) : null}
      </div>
    </Dialog>
  );
}

/* ---------- Schedule ---------- */

export function ScheduleDialog({ bill, today, onClose }: { bill: ImsBill; today: string; onClose: () => void }) {
  const { run, busy } = useImsAction();
  const [date, setDate] = useState(bill.scheduledOn ?? (bill.dueDate && bill.dueDate >= today ? bill.dueDate : today));
  const [method, setMethod] = useState<PayMethod>((bill.payMethod as PayMethod) || "bank");
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Schedule payment · ${bill.billNo}`}
      description={`${bill.supplierName} · ${inrExact(bill.balance)} due ${dateLabel(bill.dueDate)}`}
      icon={{ tone: "blue", name: "calendar" }}
      wide
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!date || busy === "schedule"}
            onClick={async () => {
              const out = await run("schedule", () => finance.scheduleBill(bill.id, date, method), { success: `Scheduled for ${dateLabel(date)}` });
              if (out) onClose();
            }}
          >
            Schedule
          </Button>
        </>
      }
    >
      <FormGrid columns="1fr 1fr">
        <Field label="Pay on">{({ id }) => <Input id={id} type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        <Field label="Method">{({ id }) => <MethodSelect id={id} value={method} onChange={setMethod} />}</Field>
      </FormGrid>
    </Dialog>
  );
}

/* ---------- Payment runs ---------- */

export function CreateRunDialog({ bills, today, onClose, onCreated }: { bills: ImsBill[]; today: string; onClose: () => void; onCreated: (run: PaymentRun) => void }) {
  const { run, busy } = useImsAction();
  const [runDate, setRunDate] = useState(today);
  const [method, setMethod] = useState<PayMethod>("bank");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [markPaid, setMarkPaid] = useState(false);
  const total = round2(bills.reduce((s, b) => s + b.balance, 0));
  const suppliers = new Set(bills.map((b) => b.supplierId ?? b.supplierName)).size;
  return (
    <Dialog
      open
      onClose={onClose}
      title="Create payment run"
      description={`${bills.length} bill${bills.length === 1 ? "" : "s"} · ${suppliers} supplier${suppliers === 1 ? "" : "s"} · ${inrExact(total)}`}
      icon={{ tone: "blue", name: "wallet" }}
      wide
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={markPaid ? "success" : "primary"}
            disabled={!bills.length || busy === "run" || (markPaid && runDate > today)}
            onClick={async () => {
              const out = await run("run", () => finance.createPaymentRun({ billIds: bills.map((b) => b.id), runDate, method, reference: reference.trim() || null, notes: notes.trim() || null, markPaid }), {
                success: markPaid ? "Payment run paid" : "Payment run scheduled",
              });
              if (out?.run) onCreated(out.run);
            }}
          >
            {busy === "run" ? "Working…" : markPaid ? `Pay ${inrExact(total)} now` : "Schedule run"}
          </Button>
        </>
      }
    >
      <div className="fin-lg">
        <div className="fin-table-wrap" style={{ maxHeight: 220, overflowY: "auto", marginBottom: 12 }}>
          <table className="fin-table">
            <tbody>
              {bills.map((b) => (
                <tr key={b.id}>
                  <td>
                    <span className="ims-cell-stack">
                      <span className="ims-strong">{b.supplierName}</span>
                      <small>
                        {b.billNo}
                        {b.supplierBillNo ? ` · ${b.supplierBillNo}` : ""} · due {dateLabel(b.dueDate)}
                      </small>
                    </span>
                  </td>
                  <td className="is-num">{inrExact(b.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="is-num">{inrExact(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <FormGrid columns="1fr 1fr">
          <Field label="Run date">{({ id }) => <Input id={id} type="date" value={runDate} onChange={(e) => setRunDate(e.target.value)} />}</Field>
          <Field label="Method">{({ id }) => <MethodSelect id={id} value={method} onChange={setMethod} />}</Field>
          <Field label="Reference / batch id">{({ id }) => <Input id={id} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} />}</Field>
          <Field label="Notes">{({ id }) => <Input id={id} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />}</Field>
        </FormGrid>
        <label className="ims-row" style={{ marginTop: 12, fontSize: 13 }}>
          <Switch checked={markPaid} onChange={setMarkPaid} aria-label="Mark all as paid now" />
          Mark all as paid now (otherwise the bills are scheduled for the run date)
        </label>
        {markPaid && runDate > today ? (
          <div style={{ marginTop: 10 }}>
            <Alert tone="amber" title="Future date">
              Payments can only be marked paid for today or earlier.
            </Alert>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

export function exportRunCsv(run: PaymentRun, bills: ImsBill[]) {
  downloadCsv(`payment-run-${run.runNo}`, bills, [
    { header: "Beneficiary", value: (b) => b.supplierName },
    { header: "Amount", value: (b) => (run.status === "paid" ? b.amountPaid : b.balance) },
    { header: "Payment date", value: () => run.runDate },
    { header: "Mode", value: () => methodLabel(run.method) },
    { header: "Narration", value: (b) => `${run.runNo} ${b.supplierBillNo || b.billNo}`.slice(0, 30) },
    { header: "Bill no", value: (b) => b.billNo },
    { header: "Supplier bill no", value: (b) => b.supplierBillNo },
    { header: "Supplier GSTIN", value: (b) => b.supplierGstin },
    { header: "Supplier mobile", value: (b) => b.supplierMobile },
    { header: "Supplier email", value: (b) => b.supplierEmail },
    { header: "Due date", value: (b) => b.dueDate },
    { header: "Reference", value: () => run.reference },
  ]);
}

export function RunDetailDialog({ runId, today, canPay, onClose, onOpenBill }: { runId: string; today: string; canPay: boolean; onClose: () => void; onOpenBill: (id: string) => void }) {
  const { run, busy } = useImsAction();
  const state = useImsData(() => finance.paymentRun(runId), [runId]);
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [paidOn, setPaidOn] = useState(today);
  const [reference, setReference] = useState("");
  const r = state.data?.run ?? null;
  return (
    <>
      <Dialog
        open={!paying && !cancelling}
        onClose={onClose}
        title={r ? `Payment run ${r.runNo}` : "Payment run"}
        wide
        actions={
          r ? (
            <>
              <Button variant="ghost" icon="download" onClick={() => state.data && exportRunCsv(state.data.run, state.data.bills)}>
                Bank CSV
              </Button>
              {canPay && r.status === "scheduled" ? (
                <>
                  <Button variant="ghost" onClick={() => setCancelling(true)}>
                    Cancel run
                  </Button>
                  <Button variant="success" icon="check" onClick={() => setPaying(true)}>
                    Mark paid
                  </Button>
                </>
              ) : null}
            </>
          ) : undefined
        }
      >
        <div className="fin-lg">
          <Loaded state={state} rows={1}>
            {(d) => (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div className="ims-row">
                  <StatusBadge view={RUN_BADGE[d.run.status]} />
                  <span className="ims-muted" style={{ fontSize: 13 }}>
                    {dateLabel(d.run.runDate)} · {methodLabel(d.run.method)}
                    {d.run.reference ? ` · ${d.run.reference}` : ""}
                  </span>
                </div>
                <Stats
                  items={[
                    { label: "Bills", value: d.run.billCount },
                    { label: "Total", value: inrExact(d.run.total) },
                    { label: "Paid out", value: inrExact(round2(d.payments.reduce((s, p) => s + p.amount, 0))), tone: d.payments.length ? "emerald" : null },
                  ]}
                />
                <div className="fin-table-wrap">
                  <table className="fin-table">
                    <thead>
                      <tr>
                        <th>Bill</th>
                        <th>Status</th>
                        <th className="is-num">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.bills.map((b) => (
                        <tr key={b.id} className="is-click" onClick={() => onOpenBill(b.id)}>
                          <td>
                            <span className="ims-cell-stack">
                              <span className="ims-strong">{b.supplierName}</span>
                              <small>
                                {b.billNo}
                                {b.supplierBillNo ? ` · ${b.supplierBillNo}` : ""}
                              </small>
                            </span>
                          </td>
                          <td>
                            <StatusBadge view={BILL_BADGE[b.displayStatus]} />
                          </td>
                          <td className="is-num">{inrExact(b.grandTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <KeyValues
                  rows={[
                    ["Created by", d.run.createdByName],
                    ["Paid at", d.run.paidAt],
                    ["Notes", d.run.notes],
                  ]}
                />
              </div>
            )}
          </Loaded>
        </div>
      </Dialog>
      {paying && r ? (
        <Dialog
          open
          onClose={() => setPaying(false)}
          title={`Mark ${r.runNo} paid`}
          description={`Records a payment for every bill still open in this run (${inrExact(r.total)} scheduled).`}
          icon={{ tone: "emerald", name: "check" }}
          wide
          actions={
            <>
              <Button variant="ghost" onClick={() => setPaying(false)}>
                Back
              </Button>
              <Button
                variant="success"
                disabled={busy === "payrun" || paidOn > today}
                onClick={async () => {
                  const out = await run("payrun", () => finance.payPaymentRun(r.id, { paidOn, reference: reference.trim() || null }), { success: "Payment run marked paid" });
                  if (out) setPaying(false);
                }}
              >
                {busy === "payrun" ? "Saving…" : "Mark paid"}
              </Button>
            </>
          }
        >
          <FormGrid columns="1fr 1fr">
            <Field label="Paid on">{({ id }) => <Input id={id} type="date" max={today} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />}</Field>
            <Field label="Bank reference / UTR">{({ id }) => <Input id={id} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} />}</Field>
          </FormGrid>
        </Dialog>
      ) : null}
      <ConfirmDialog
        open={cancelling}
        onClose={() => setCancelling(false)}
        title={r ? `Cancel ${r.runNo}?` : "Cancel run?"}
        description="The bills go back to approved and can be paid or scheduled again."
        confirmLabel="Cancel run"
        destructive
        busy={busy === "cancelrun"}
        onConfirm={async () => {
          if (!r) return;
          const out = await run("cancelrun", () => finance.cancelPaymentRun(r.id), { success: "Payment run cancelled" });
          if (out) {
            setCancelling(false);
            onClose();
          }
        }}
      />
    </>
  );
}
