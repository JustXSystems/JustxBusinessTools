"use client";

import { useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Field, FormGrid, Input, Select, Switch, Textarea } from "@/components/bos";
import type { PartyOption } from "@/lib/ims/api";
import { finance, gstStateName, GST_STATES, intraStateFor, type InvoiceDetail, type InvoiceInput } from "@/lib/ims/finance";
import { addDaysISO, computeTotals, dateLabel, inrExact, qtyText, round2 } from "@/lib/ims/format";
import { ErrorBlock, LoadingBlock, PageHeader, Stack, useIms, useImsAction, useImsData } from "../core";
import { blankLine, lineKey, LineEditor, toLineInputs, type EditableLine } from "../shared/LineEditor";
import { PartySelect, useItemCatalog } from "../shared/pickers";
import { BackLink, QuickChips } from "./shared";

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const TERM_OPTIONS = [0, 7, 15, 30, 45, 60];

/** New invoice (id null) or edit a draft. `onClose(id)` opens the saved invoice; `onClose(null)` goes back. */
export function InvoiceEditor({ id, onClose }: { id: string | null; onClose: (id: string | null) => void }) {
  const state = useImsData(() => (id ? finance.invoice(id) : Promise.resolve(null)), [id]);
  if (id && state.data === null) {
    return state.error ? <ErrorBlock error={state.error} onRetry={state.reload} /> : <LoadingBlock rows={2} />;
  }
  if (state.data && state.data.invoice.status !== "draft") {
    return (
      <Stack>
        <BackLink onClick={() => onClose(id)}>Back to invoice</BackLink>
        <Alert tone="amber" title="Only drafts can be edited">
          This invoice has been issued. Cancel it and issue a corrected one, or duplicate it into a new draft.
        </Alert>
      </Stack>
    );
  }
  return <EditorForm key={id ?? "new"} draft={state.data} onClose={onClose} />;
}

function EditorForm({ draft, onClose }: { draft: InvoiceDetail | null; onClose: (id: string | null) => void }) {
  const { session } = useIms();
  const settings = session.settings;
  const { run, busy } = useImsAction();
  const catalog = useItemCatalog();
  const inv = draft?.invoice ?? null;
  const today = session.today;

  const [customer, setCustomer] = useState<{ id: string | null; name: string }>({ id: inv?.customerId ?? null, name: inv?.customerName ?? "" });
  const [party, setParty] = useState<PartyOption | null>(null);
  const [gstin, setGstin] = useState(inv?.customerGstin ?? "");
  const [mobile, setMobile] = useState(inv?.customerMobile ?? "");
  const [address, setAddress] = useState(inv?.customerAddress ?? "");
  const [placeOfSupply, setPlaceOfSupply] = useState(inv?.placeOfSupply ?? "");
  const [invoiceDate, setInvoiceDate] = useState(inv?.invoiceDate ?? today);
  const [termsDays, setTermsDays] = useState<number | null>(inv ? null : settings.paymentTermsDays);
  const [dueDate, setDueDate] = useState(inv?.dueDate ?? addDaysISO(today, settings.paymentTermsDays));
  const [lines, setLines] = useState<EditableLine[]>(() =>
    inv?.lines?.length ? inv.lines.map((l) => ({ key: lineKey(), itemId: l.itemId ?? null, name: l.name, sku: l.sku ?? null, hsn: l.hsn ?? null, unit: l.unit ?? null, qty: l.qty, rate: l.rate, discountPct: l.discountPct, gstRate: l.gstRate })) : [],
  );
  const [roundToRupee, setRoundToRupee] = useState(inv?.roundToRupee ?? true);
  const [notes, setNotes] = useState(inv?.notes ?? "");
  const [terms, setTerms] = useState(inv?.terms ?? settings.terms ?? "");
  const [touched, setTouched] = useState(false);

  const effectivePos = placeOfSupply || party?.state || gstStateName(gstin) || settings.state || "";
  const intraState = intraStateFor(settings, effectivePos);
  const totals = useMemo(() => computeTotals(toLineInputs(lines), intraState, roundToRupee), [lines, intraState, roundToRupee]);

  const summary = useImsData(() => (customer.id ? finance.customerSummary(customer.id) : Promise.resolve(null)), [customer.id]);
  const creditWarning = useMemo(() => {
    const s = summary.data;
    if (!s || s.creditLimit == null || s.creditLimit <= 0) return null;
    const after = round2(s.outstanding + totals.grandTotal);
    return after > s.creditLimit ? { after, limit: s.creditLimit, over: round2(after - s.creditLimit) } : null;
  }, [summary.data, totals.grandTotal]);

  const stockIssues = useMemo(() => {
    const items = new Map((catalog.data ?? []).map((i) => [i.id, i]));
    const need = new Map<string, number>();
    for (const l of lines) if (l.itemId) need.set(l.itemId, (need.get(l.itemId) ?? 0) + Number(l.qty || 0));
    return [...need.entries()]
      .map(([itemId, qty]) => ({ item: items.get(itemId), qty }))
      .filter((x): x is { item: NonNullable<typeof x.item>; qty: number } => Boolean(x.item) && x.qty > (x.item?.currentStock ?? 0))
      .map((x) => ({ name: x.item.name, unit: x.item.unit, have: x.item.currentStock, need: x.qty }));
  }, [catalog.data, lines]);

  const gstinError = gstin.trim() && !GSTIN_RE.test(gstin.trim().toUpperCase()) ? "That doesn't look like a valid 15-character GSTIN" : null;
  const errors = {
    customer: !customer.name.trim() ? "Pick a customer or type a name" : null,
    lines: !toLineInputs(lines).length ? "Add at least one line with a quantity" : null,
    due: dueDate && dueDate < invoiceDate ? "The due date can't be before the invoice date" : null,
    gstin: gstinError,
  };
  const invalid = Object.values(errors).some(Boolean);

  const applyTerms = (days: number, from = invoiceDate) => {
    setTermsDays(days);
    setDueDate(addDaysISO(from, days));
  };

  const pickCustomer = (v: { id: string | null; name: string; party: PartyOption | null }) => {
    setCustomer({ id: v.id, name: v.name });
    setParty(v.party);
    if (v.party) {
      setGstin(v.party.gstin ?? "");
      setMobile(v.party.mobile ?? "");
      setAddress([v.party.address, v.party.city].filter(Boolean).join(", "));
      setPlaceOfSupply(v.party.state ?? gstStateName(v.party.gstin) ?? "");
      applyTerms(v.party.paymentTermsDays ?? settings.paymentTermsDays);
    }
  };

  const input = (): InvoiceInput => ({
    customerId: customer.id,
    customerName: customer.name.trim(),
    customerGstin: gstin.trim().toUpperCase() || null,
    customerAddress: address.trim() || null,
    customerMobile: mobile.trim() || null,
    placeOfSupply: effectivePos || null,
    invoiceDate,
    dueDate: dueDate || null,
    lines: toLineInputs(lines),
    roundToRupee,
    notes: notes.trim() || null,
    terms: terms.trim() || null,
  });

  const save = async (issue: boolean) => {
    setTouched(true);
    if (invalid) return;
    const body = input();
    const out = await run(
      issue ? "issue" : "save",
      async () => {
        if (!draft) return finance.createInvoice({ ...body, issue });
        await finance.updateInvoice(draft.invoice.id, body);
        return issue ? finance.issueInvoice(draft.invoice.id) : finance.invoice(draft.invoice.id);
      },
      { success: issue ? "Invoice issued — stock updated" : "Draft saved" },
    );
    if (out) onClose(out.invoice.id);
  };

  const blockedByStock = stockIssues.length > 0 && !settings.allowNegativeStock;

  return (
    <Stack gap={16}>
      <BackLink onClick={() => onClose(draft?.invoice.id ?? null)}>{draft ? "Back to invoice" : "All invoices"}</BackLink>
      <PageHeader
        title={draft ? "Edit draft invoice" : "New invoice"}
        sub="Stock moves out when the invoice is issued. Drafts don't touch stock or the invoice number series."
        actions={inv?.sourceTool && inv.sourceTool !== "pos" ? <Badge tag="lavender">From Quotation{inv.sourceRef ? ` · ${inv.sourceRef}` : ""}</Badge> : null}
      />

      <Card interactive={false}>
        <div className="fin-doc-grid">
          <div className="fin-box">
            <div className="fin-box-label">Bill to</div>
            <FormGrid columns="1fr">
              <Field label="Customer *" error={touched ? errors.customer : undefined}>
                {({ id }) => <PartySelect id={id} kind="customer" value={customer} onChange={pickCustomer} />}
              </Field>
              <FormGrid columns="1fr 1fr">
                <Field label="GSTIN" error={errors.gstin ?? undefined} hint={!gstin ? "Leave blank for unregistered (B2C)" : undefined}>
                  {({ id, describedBy, invalid: bad }) => (
                    <Input id={id} aria-describedby={describedBy} aria-invalid={bad} value={gstin} maxLength={15} onChange={(e) => setGstin(e.target.value.toUpperCase())} placeholder="29ABCDE1234F1Z5" />
                  )}
                </Field>
                <Field label="Mobile">{({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} maxLength={40} />}</Field>
              </FormGrid>
              <Field label="Billing address">{({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={2} value={address} onChange={(e) => setAddress(e.target.value)} maxLength={500} />}</Field>
            </FormGrid>
          </div>

          <div className="fin-box">
            <div className="fin-box-label">
              Invoice details
              <Badge tone={intraState ? "blue" : "amber"}>{intraState ? "CGST + SGST" : "IGST"}</Badge>
            </div>
            <FormGrid columns="1fr 1fr">
              <Field label="Invoice date">
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    type="date"
                    value={invoiceDate}
                    max={today}
                    onChange={(e) => {
                      setInvoiceDate(e.target.value);
                      if (termsDays !== null && e.target.value) setDueDate(addDaysISO(e.target.value, termsDays));
                    }}
                  />
                )}
              </Field>
              <Field label="Due date" error={touched ? errors.due : undefined}>
                {({ id, describedBy, invalid: bad }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    aria-invalid={bad}
                    type="date"
                    value={dueDate}
                    min={invoiceDate}
                    onChange={(e) => {
                      setTermsDays(null);
                      setDueDate(e.target.value);
                    }}
                  />
                )}
              </Field>
              <Field label="Place of supply" full hint={`Business state: ${settings.state || "not set"} · ${intraState ? "intra-state supply" : "inter-state supply"}`}>
                {({ id, describedBy }) => (
                  <Select id={id} aria-describedby={describedBy} value={placeOfSupply} onChange={(e) => setPlaceOfSupply(e.target.value)}>
                    <option value="">{effectivePos ? `Auto — ${effectivePos}` : "Same as business"}</option>
                    {GST_STATES.map((s) => (
                      <option key={s.code} value={s.name}>
                        {s.code} · {s.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </FormGrid>
            <div style={{ marginTop: 10 }}>
              <QuickChips
                label="Payment terms"
                active={termsDays === null ? "" : String(termsDays)}
                options={TERM_OPTIONS.map((d) => ({ key: String(d), label: d === 0 ? "On receipt" : `${d} days` }))}
                onPick={(k) => applyTerms(Number(k))}
              />
            </div>
          </div>
        </div>
      </Card>

      {creditWarning ? (
        <Alert tone="amber" title="Credit limit exceeded">
          {customer.name} owes {inrExact(summary.data?.outstanding ?? 0)} already. With this invoice it becomes {inrExact(creditWarning.after)} — {inrExact(creditWarning.over)} over the {inrExact(creditWarning.limit)} limit.
          {summary.data?.overdue ? ` ${inrExact(summary.data.overdue)} is overdue.` : ""}
        </Alert>
      ) : summary.data && summary.data.overdue > 0 ? (
        <Alert tone="blue" title={`${customer.name} has overdue dues`}>
          {inrExact(summary.data.overdue)} overdue across {summary.data.openCount} open invoice{summary.data.openCount === 1 ? "" : "s"}
          {summary.data.lastInvoiceDate ? ` · last invoiced ${dateLabel(summary.data.lastInvoiceDate)}` : ""}.
        </Alert>
      ) : null}

      <Card interactive={false}>
        <div className="ims-between" style={{ marginBottom: 10 }}>
          <h2 className="fin-section-title" style={{ margin: 0 }}>
            Items
          </h2>
          <label className="ims-row" style={{ fontSize: 13 }}>
            <Switch checked={roundToRupee} onChange={setRoundToRupee} aria-label="Round total to the nearest rupee" />
            Round off total
          </label>
        </div>
        <LineEditor lines={lines.length ? lines : []} onChange={setLines} intraState={intraState} price="selling" roundToRupee={roundToRupee} />
        {touched && errors.lines ? (
          <p className="ims-neg" role="alert" style={{ fontSize: 12.5, marginTop: 6 }}>
            {errors.lines}
          </p>
        ) : null}
        {!lines.length ? (
          <div style={{ marginTop: 8 }}>
            <Button size="sm" variant="ghost" onClick={() => setLines([blankLine(settings.defaultGstRate)])}>
              Start with a free-text line
            </Button>
          </div>
        ) : null}
      </Card>

      {stockIssues.length ? (
        <Alert tone={blockedByStock ? "coral" : "amber"} title={blockedByStock ? "Not enough stock to issue" : "Stock will go negative"}>
          {stockIssues.map((s) => `${s.name}: need ${qtyText(s.need, s.unit)}, have ${qtyText(s.have, s.unit)}`).join(" · ")}
          {blockedByStock ? ". Reduce the quantity, receive stock first, or allow negative stock in Settings. You can still save a draft." : "."}
        </Alert>
      ) : null}

      <Card interactive={false}>
        <FormGrid columns="1fr 1fr">
          <Field label="Notes (printed)">{({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} placeholder="Thank you for your business!" />}</Field>
          <Field label="Terms & conditions">{({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={3} value={terms} onChange={(e) => setTerms(e.target.value)} maxLength={4000} />}</Field>
        </FormGrid>
      </Card>

      <div className="fin-sticky-actions">
        <span className="ims-muted" style={{ marginRight: "auto", alignSelf: "center", fontSize: 13 }}>
          Total <b className="ims-num" style={{ fontSize: 16, color: "var(--bos-text)" }}>{inrExact(totals.grandTotal)}</b>
          {totals.taxTotal ? ` · GST ${inrExact(totals.taxTotal)}` : ""}
        </span>
        <Button variant="ghost" onClick={() => onClose(draft?.invoice.id ?? null)} disabled={Boolean(busy)}>
          Cancel
        </Button>
        <Button onClick={() => save(false)} disabled={Boolean(busy)}>
          {busy === "save" ? "Saving…" : "Save draft"}
        </Button>
        <Button variant="primary" icon="check" onClick={() => save(true)} disabled={Boolean(busy) || blockedByStock}>
          {busy === "issue" ? "Issuing…" : "Save & issue"}
        </Button>
      </div>
    </Stack>
  );
}
