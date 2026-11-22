"use client";

import { useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Field, FormGrid, Input, Select, Switch, Textarea } from "@/components/bos";
import type { PartyOption } from "@/lib/ims/api";
import { ims } from "@/lib/ims/api";
import { COMMON_CURRENCIES, finance, fxPreview, gstStateName, GST_STATES, intraStateFor, normalizeCurrencyCode, parseCurrencyCode, type InvoiceDetail, type InvoiceInput } from "@/lib/ims/finance";
import { normalizePaymentTermPresets, termChipLabel } from "@/lib/ims/settings";
import { addDaysISO, computeTotals, dateLabel, inrExact, moneyFmt, qtyText, round2 } from "@/lib/ims/format";
import { DocRefLink } from "../bom/DocRefLink";
import { ErrorBlock, LoadingBlock, PageHeader, Stack, useIms, useImsAction, useImsData } from "../core";
import { blankLine, lineKey, LineEditor, toLineInputs, type EditableLine } from "../shared/LineEditor";
import { fillRelated, ForceRelatedToggle, PartySelect, useItemCatalog } from "../shared/pickers";
import { SuggestInput } from "../shared/SuggestInput";
import { BackLink, QuickChips } from "./shared";

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;


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
  const { session, can } = useIms();
  const settings = session.settings;
  const { run, busy } = useImsAction();
  const catalog = useItemCatalog();
  const team = useImsData(() => ims.team(), []);
  const inv = draft?.invoice ?? null;
  const today = session.today;
  const salespeople = (team.data?.members ?? []).filter((m) => m.active !== false);

  const [customer, setCustomer] = useState<{ id: string | null; name: string }>({ id: inv?.customerId ?? null, name: inv?.customerName ?? "" });
  const [party, setParty] = useState<PartyOption | null>(null);
  const [gstin, setGstin] = useState(inv?.customerGstin ?? "");
  const [mobile, setMobile] = useState(inv?.customerMobile ?? "");
  const [address, setAddress] = useState(inv?.customerAddress ?? "");
  const [customerPoNo, setCustomerPoNo] = useState(inv?.customerPoNo ?? "");
  const [shipSame, setShipSame] = useState(!inv?.shipToName && !inv?.shipToAddress);
  const [shipToName, setShipToName] = useState(inv?.shipToName ?? "");
  const [shipToGstin, setShipToGstin] = useState(inv?.shipToGstin ?? "");
  const [shipToAddress, setShipToAddress] = useState(inv?.shipToAddress ?? "");
  const [shipToState, setShipToState] = useState(inv?.shipToState ?? "");
  const [shipToMobile, setShipToMobile] = useState(inv?.shipToMobile ?? "");
  const [placeOfSupply, setPlaceOfSupply] = useState(inv?.placeOfSupply ?? "");
  const [docKind, setDocKind] = useState<"tax_invoice" | "proforma" | "retainer">(
    inv?.docKind === "proforma" ? "proforma" : inv?.docKind === "retainer" ? "retainer" : "tax_invoice",
  );
  const [invoiceDate, setInvoiceDate] = useState(inv?.invoiceDate ?? today);
  const [termsDays, setTermsDays] = useState<number | null>(inv ? null : settings.paymentTermsDays);
  const [dueDate, setDueDate] = useState(inv?.dueDate ?? addDaysISO(today, settings.paymentTermsDays));
  const [lines, setLines] = useState<EditableLine[]>(() =>
    inv?.lines?.length ? inv.lines.map((l) => ({ key: lineKey(), itemId: l.itemId ?? null, name: l.name, sku: l.sku ?? null, hsn: l.hsn ?? null, unit: l.unit ?? null, qty: l.qty, rate: l.rate, discountPct: l.discountPct, gstRate: l.gstRate })) : [],
  );
  const [shippingCharges, setShippingCharges] = useState(String(inv?.shippingCharges ? inv.shippingCharges : ""));
  const [shippingGstRate, setShippingGstRate] = useState(String(inv?.shippingGstRate ?? settings.defaultGstRate));
  const [retentionPct, setRetentionPct] = useState(String(inv ? (inv.retentionPct ? inv.retentionPct : "") : settings.defaultRetentionPct > 0 ? settings.defaultRetentionPct : ""));
  const [progressPct, setProgressPct] = useState(String(inv?.progressPct != null && inv.progressPct > 0 ? inv.progressPct : ""));
  const [progressLabel, setProgressLabel] = useState(inv?.progressLabel ?? "");
  const [salespersonId, setSalespersonId] = useState<string>(inv?.accountManagerId != null ? String(inv.accountManagerId) : "");
  const [roundToRupee, setRoundToRupee] = useState(inv?.roundToRupee ?? settings.defaultRoundToRupee ?? true);
  const [notes, setNotes] = useState(inv?.notes ?? "");
  const [terms, setTerms] = useState(inv?.terms ?? settings.terms ?? "");
  const termOptions = useMemo(() => normalizePaymentTermPresets(settings.paymentTermPresets), [settings.paymentTermPresets]);
  const baseCurrency = normalizeCurrencyCode(settings.baseCurrency);
  const currencyChoices = useMemo(() => [...new Set<string>([baseCurrency, ...COMMON_CURRENCIES])], [baseCurrency]);
  const startCurrency = normalizeCurrencyCode(inv?.currencyCode, baseCurrency);
  const [currencyChoice, setCurrencyChoice] = useState<string>(currencyChoices.includes(startCurrency) ? startCurrency : "__other");
  const [currencyCustom, setCurrencyCustom] = useState(currencyChoices.includes(startCurrency) ? "" : startCurrency);
  const [fxRate, setFxRate] = useState(inv && startCurrency !== baseCurrency && inv.fxRate > 0 ? String(inv.fxRate) : "");
  const [touched, setTouched] = useState(false);
  const [forceRelatedFill, setForceRelatedFill] = useState(false);
  const isCreditNote = inv?.docKind === "credit_note" || inv?.docKind === "debit_note";
  const currencyCode = currencyChoice === "__other" ? (parseCurrencyCode(currencyCustom) ?? "") : currencyChoice;
  const foreign = currencyCode !== "" && currencyCode !== baseCurrency;
  const fxRateNum = Number(fxRate);

  const effectivePos = placeOfSupply || party?.state || gstStateName(gstin) || settings.state || "";
  const intraState = intraStateFor(settings, effectivePos);
  const shipAmt = Math.max(0, Number(shippingCharges) || 0);
  const shipGst = Math.max(0, Math.min(100, Number(shippingGstRate) || 0));
  const retPct = Math.max(0, Math.min(100, Number(retentionPct) || 0));
  const totals = useMemo(() => {
    const base = computeTotals(toLineInputs(lines), intraState, false);
    const shipTax = shipAmt > 0.005 && shipGst > 0 ? round2((shipAmt * shipGst) / 100) : 0;
    let taxTotal = round2(base.taxTotal + shipTax);
    let cgst = base.cgst;
    let sgst = base.sgst;
    let igst = base.igst;
    if (intraState) {
      const half = round2(shipTax / 2);
      cgst = round2(cgst + half);
      sgst = round2(sgst + (shipTax - half));
    } else {
      igst = round2(igst + shipTax);
    }
    let grandTotal = round2(base.subtotal - base.discountTotal + taxTotal + shipAmt);
    let roundOff = 0;
    if (roundToRupee) {
      const rounded = Math.round(grandTotal);
      roundOff = round2(rounded - grandTotal);
      grandTotal = rounded;
    }
    const retentionAmount = retPct > 0 ? round2((grandTotal * retPct) / 100) : 0;
    return { ...base, taxTotal, cgst, sgst, igst, roundOff, grandTotal, shippingCharges: shipAmt, shippingTax: shipTax, retentionAmount };
  }, [lines, intraState, roundToRupee, shipAmt, shipGst, retPct]);
  const salesperson = salespeople.find((m) => String(m.userId) === salespersonId) ?? null;

  const summary = useImsData(() => (customer.id ? finance.customerSummary(customer.id) : Promise.resolve(null)), [customer.id]);
  const creditWarning = useMemo(() => {
    const s = summary.data;
    if (!s || s.creditLimit == null || s.creditLimit <= 0) return null;
    const after = round2(s.outstanding + totals.grandTotal);
    return after > s.creditLimit ? { after, limit: s.creditLimit, over: round2(after - s.creditLimit) } : null;
  }, [summary.data, totals.grandTotal]);

  const stockViaDc = Boolean(inv?.dcLinks?.length || inv?.dcIds?.length);
  const stockIssues = useMemo(() => {
    if (stockViaDc) return [];
    const items = new Map((catalog.data ?? []).map((i) => [i.id, i]));
    const need = new Map<string, number>();
    for (const l of lines) if (l.itemId) need.set(l.itemId, (need.get(l.itemId) ?? 0) + Number(l.qty || 0));
    return [...need.entries()]
      .map(([itemId, qty]) => ({ item: items.get(itemId), qty }))
      .filter((x): x is { item: NonNullable<typeof x.item>; qty: number } => Boolean(x.item) && x.qty > (x.item?.currentStock ?? 0))
      .map((x) => ({ name: x.item.name, unit: x.item.unit, have: x.item.currentStock, need: x.qty }));
  }, [catalog.data, lines, stockViaDc]);

  const gstinError = gstin.trim() && !GSTIN_RE.test(gstin.trim().toUpperCase()) ? "That doesn't look like a valid 15-character GSTIN" : null;
  const errors = {
    customer: !customer.name.trim() ? "Pick a customer or type a name" : null,
    lines: !toLineInputs(lines).length ? "Add at least one line with a quantity" : null,
    due: dueDate && dueDate < invoiceDate ? "The due date can't be before the invoice date" : null,
    gstin: gstinError,
    currency: currencyChoice === "__other" && !currencyCode ? "Enter a 3-letter currency code (e.g. SGD)" : null,
    fx: foreign && !(fxRateNum > 0) ? "Enter the locked FX rate (base currency per 1 unit)" : null,
  };
  const invalid = Object.values(errors).some(Boolean);
  const fx = fxPreview({ currencyCode: currencyCode || baseCurrency, fxRate: fxRateNum, baseCurrency, grandTotal: totals.grandTotal });

  const applyTerms = (days: number, from = invoiceDate) => {
    setTermsDays(days);
    setDueDate(addDaysISO(from, days));
  };

  const pickCustomer = (
    v: { id: string | null; name: string; party: PartyOption | null },
    meta?: { picked?: boolean },
  ) => {
    setCustomer({ id: v.id, name: v.name });
    setParty(v.party);
    if (!v.party) return;
    const force = Boolean(meta?.picked && forceRelatedFill);
    fillRelated(gstin, v.party.gstin, setGstin, force);
    fillRelated(mobile, v.party.mobile, setMobile, force);
    fillRelated(address, [v.party.address, v.party.city].filter(Boolean).join(", "), setAddress, force);
    fillRelated(placeOfSupply, v.party.state ?? gstStateName(v.party.gstin), setPlaceOfSupply, force);
    // Payment terms: empty-only when still on settings default (new invoice); force always applies.
    if (v.party.paymentTermsDays != null) {
      const termsUntouched = !draft && termsDays === settings.paymentTermsDays;
      if (force || termsUntouched) applyTerms(v.party.paymentTermsDays);
    }
  };

  const input = (): InvoiceInput => ({
    customerId: customer.id,
    customerName: customer.name.trim(),
    customerGstin: gstin.trim().toUpperCase() || null,
    customerAddress: address.trim() || null,
    customerMobile: mobile.trim() || null,
    customerPoNo: customerPoNo.trim() || null,
    shipToName: shipSame ? null : shipToName.trim() || null,
    shipToGstin: shipSame ? null : shipToGstin.trim().toUpperCase() || null,
    shipToAddress: shipSame ? null : shipToAddress.trim() || null,
    shipToState: shipSame ? null : shipToState.trim() || null,
    shipToMobile: shipSame ? null : shipToMobile.trim() || null,
    placeOfSupply: effectivePos || null,
    invoiceDate,
    dueDate: dueDate || null,
    docKind: isCreditNote ? inv?.docKind : docKind,
    shippingCharges: shipAmt,
    shippingGstRate: shipGst,
    retentionPct: retPct,
    progressPct: progressPct.trim() === "" ? null : Math.max(0, Math.min(100, Number(progressPct) || 0)),
    progressLabel: progressLabel.trim() || null,
    accountManagerId: salesperson ? salesperson.userId : salespersonId === "" ? null : Number(salespersonId) || null,
    accountManagerName: salesperson ? salesperson.name || null : null,
    currencyCode: currencyCode || baseCurrency,
    fxRate: foreign ? fxRateNum : 1,
    lines: toLineInputs(lines),
    roundToRupee,
    notes: notes.trim() || null,
    terms: terms.trim() || null,
  });

  const needsApproval =
    settings.invoiceApprovalLimit > 0 &&
    totals.grandTotal >= settings.invoiceApprovalLimit &&
    (docKind === "tax_invoice" || docKind === "retainer") &&
    !isCreditNote;

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
      {
        success: issue
          ? needsApproval
            ? "Submitted for approval"
            : stockViaDc
              ? "Invoice issued — stock stays on linked DCs"
              : "Invoice issued — stock updated"
          : "Draft saved",
      },
    );
    if (out) onClose(out.invoice.id);
  };
  const blockedByStock =
    !isCreditNote && docKind !== "proforma" && docKind !== "retainer" && !stockViaDc && stockIssues.length > 0 && !settings.allowNegativeStock;

  return (
    <Stack gap={16}>
      <BackLink onClick={() => onClose(draft?.invoice.id ?? null)}>{draft ? "Back to invoice" : "All invoices"}</BackLink>
      <PageHeader
        title={
          isCreditNote
            ? draft
              ? `Edit draft ${inv?.docKind === "debit_note" ? "debit note" : "credit note"}`
              : "New credit note"
            : draft
              ? docKind === "proforma"
                ? "Edit draft proforma"
                : "Edit draft invoice"
              : docKind === "proforma"
                ? "New proforma"
                : "New invoice"
        }
        sub={
          isCreditNote
            ? inv?.againstInvoiceNo
              ? `Against ${inv.againstInvoiceNo}. Issuing applies credit to that invoice’s balance — no stock movement.`
              : "Issuing applies credit to the linked tax invoice — no stock movement."
            : stockViaDc
              ? "Stock already moved on linked delivery challans — issuing won’t post stock again. Unlink DCs before changing item quantities."
              : docKind === "proforma"
                ? "Proforma does not post stock or create a receivable. Convert later by duplicating into a tax invoice."
                : "Stock moves out when the invoice is issued. Drafts don't touch stock or the invoice number series."
        }
        actions={
          inv?.sourceTool && inv.sourceTool !== "pos" ? (
            <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <Badge tag="lavender">{inv.sourceTool === "ims_bom" ? "From BOM" : "From Quotation"}</Badge>
              {inv.sourceTool === "ims_bom" && inv.sourceLabel ? (
                <DocRefLink module="bom" intent={inv.sourceRef ? `open:${inv.sourceRef}` : undefined} enabled={can("bom") && Boolean(inv.sourceRef)}>
                  {inv.sourceLabel}
                </DocRefLink>
              ) : null}
            </span>
          ) : null
        }
      />

      {stockViaDc ? (
        <Alert tone="blue" title="Delivery challans linked">
          {(inv?.dcLinks ?? []).length ? (
            <>
              {(inv?.dcLinks ?? []).map((d, i) => (
                <span key={d.id}>
                  <DocRefLink module="bomDc" intent={`open:${d.id}`} enabled={can("bom")}>
                    {d.docNo}
                  </DocRefLink>
                  {i < (inv?.dcLinks?.length ?? 0) - 1 ? ", " : ""}
                </span>
              ))}
              {" — "}
            </>
          ) : (
            `${inv?.dcIds?.length ?? 0} DC(s) — `
          )}
          stock stays on those DCs. Item lines are locked while links remain; manage links on the invoice view.
        </Alert>
      ) : null}

      <Card interactive={false}>
        <div className="fin-doc-grid">
          <div className="fin-box">
            <div className="fin-box-label">
              Bill to
              <ForceRelatedToggle checked={forceRelatedFill} onChange={setForceRelatedFill} />
            </div>
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
              <label className="ims-row" style={{ fontSize: 12.5, marginTop: 4 }}>
                <Switch checked={shipSame} onChange={setShipSame} aria-label="Ship to same as bill to" />
                Ship to same as bill to
              </label>
              {!shipSame ? (
                <>
                  <Field label="Ship-to name">
                    {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={shipToName} maxLength={200} onChange={(e) => setShipToName(e.target.value)} placeholder={customer.name || "Consignee"} />}
                  </Field>
                  <FormGrid columns="1fr 1fr">
                    <Field label="Ship-to GSTIN">
                      {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={shipToGstin} maxLength={15} onChange={(e) => setShipToGstin(e.target.value.toUpperCase())} />}
                    </Field>
                    <Field label="Ship-to mobile">
                      {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="tel" value={shipToMobile} maxLength={40} onChange={(e) => setShipToMobile(e.target.value)} />}
                    </Field>
                  </FormGrid>
                  <Field label="Ship-to address">{({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={2} value={shipToAddress} onChange={(e) => setShipToAddress(e.target.value)} maxLength={500} />}</Field>
                  <Field label="Ship-to state">
                    {({ id, describedBy }) => (
                      <SuggestInput
                        id={id}
                        aria-describedby={describedBy}
                        value={shipToState}
                        onChange={setShipToState}
                        placeholder="Delivery state…"
                        emptyLabel="No state match — keep typing"
                        options={GST_STATES.map((s) => ({
                          id: s.code,
                          value: s.name,
                          label: s.name,
                          meta: `State code ${s.code}`,
                          trailing: s.code,
                        }))}
                      />
                    )}
                  </Field>
                </>
              ) : null}
            </FormGrid>
          </div>

          <div className="fin-box">
            <div className="fin-box-label">
              Invoice details
              <Badge tone={intraState ? "blue" : "amber"}>{intraState ? "CGST + SGST" : "IGST"}</Badge>
            </div>
            <FormGrid columns="1fr 1fr">
              {!isCreditNote && !draft ? (
                <Field label="Document" full>
                  {({ id, describedBy }) => (
                    <QuickChips
                      label="Document kind"
                      active={docKind}
                      options={[
                        { key: "tax_invoice", label: "Tax invoice" },
                        { key: "proforma", label: "Proforma" },
                        { key: "retainer", label: "Retainer / advance" },
                      ]}
                      onPick={(k) => setDocKind(k as "tax_invoice" | "proforma" | "retainer")}
                    />
                  )}
                </Field>
              ) : null}
              <Field label="Customer PO / order ref">
                {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={customerPoNo} maxLength={64} onChange={(e) => setCustomerPoNo(e.target.value)} placeholder="Optional" />}
              </Field>
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
              <Field
                label="Place of supply"
                full
                hint={`Business state: ${settings.state || "not set"} · ${intraState ? "intra-state supply" : "inter-state supply"}${!placeOfSupply ? ` · Auto ${effectivePos || "business"}` : ""}`}
              >
                {({ id, describedBy }) => (
                  <SuggestInput
                    id={id}
                    aria-describedby={describedBy}
                    value={placeOfSupply}
                    onChange={setPlaceOfSupply}
                    placeholder={effectivePos ? `Auto — ${effectivePos}` : "Type or pick GST state…"}
                    emptyLabel="No state match — keep typing"
                    options={GST_STATES.map((s) => ({
                      id: s.code,
                      value: s.name,
                      label: s.name,
                      meta: `State code ${s.code}`,
                      trailing: s.code,
                    }))}
                  />
                )}
              </Field>
              <Field label="Currency" error={touched ? (errors.currency ?? undefined) : undefined} hint={isCreditNote ? "Matches the original invoice" : `Base currency is ${baseCurrency}`}>
                {({ id, describedBy }) => (
                  <Select id={id} aria-describedby={describedBy} value={currencyChoice} disabled={isCreditNote} onChange={(e) => setCurrencyChoice(e.target.value)}>
                    {currencyChoices.map((c) => (
                      <option key={c} value={c}>
                        {c}
                        {c === baseCurrency ? " (base)" : ""}
                      </option>
                    ))}
                    <option value="__other">Other…</option>
                  </Select>
                )}
              </Field>
              {currencyChoice === "__other" ? (
                <Field label="Currency code">
                  {({ id, describedBy }) => (
                    <Input id={id} aria-describedby={describedBy} className="ims-mono" maxLength={3} placeholder="SGD" disabled={isCreditNote} value={currencyCustom} onChange={(e) => setCurrencyCustom(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))} />
                  )}
                </Field>
              ) : null}
              {foreign ? (
                <Field
                  label={`FX rate (${baseCurrency} per 1 ${currencyCode})`}
                  error={touched ? (errors.fx ?? undefined) : undefined}
                  hint={fxRateNum > 0 ? `Locked on save · ${moneyFmt(totals.grandTotal, currencyCode)} ≈ ${moneyFmt(fx.fxBaseTotal, baseCurrency)}` : "Rate is locked on this document when you save"}
                >
                  {({ id, describedBy, invalid: bad }) => (
                    <Input id={id} aria-describedby={describedBy} aria-invalid={bad} type="number" min={0} step="0.0001" inputMode="decimal" disabled={isCreditNote} value={fxRate} onChange={(e) => setFxRate(e.target.value)} placeholder="e.g. 83.25" />
                  )}
                </Field>
              ) : null}
            </FormGrid>
            <div style={{ marginTop: 10 }}>
              <QuickChips
                label="Payment terms"
                active={termsDays === null ? "" : String(termsDays)}
                options={termOptions.map((d) => ({ key: String(d), label: termChipLabel(d) }))}
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
        <div className="ims-compose-section">
          <div className="ims-between" style={{ marginBottom: 2 }}>
            <h2 className="ims-compose-section-title" style={{ margin: 0 }}>
              Line items
            </h2>
            <label className="ims-row" style={{ fontSize: 12.5 }}>
              <Switch checked={roundToRupee} onChange={setRoundToRupee} aria-label="Round total to the nearest rupee" />
              Round off total
            </label>
          </div>
          {stockViaDc ? (
            <p className="ims-compose-hint">Lines locked while DCs are linked.</p>
          ) : (
            <p className="ims-compose-hint">Stock items post on issue · free-text does not.</p>
          )}
          <LineEditor
            lines={lines.length ? lines : []}
            onChange={setLines}
            intraState={intraState}
            price="selling"
            roundToRupee={roundToRupee}
            readOnly={stockViaDc}
            currencyCode={currencyCode || baseCurrency}
            baseEquivalent={foreign && fxRateNum > 0 ? { code: baseCurrency, amount: fx.fxBaseTotal } : null}
          />
          {touched && errors.lines ? (
            <p className="ims-neg" role="alert" style={{ fontSize: 12.5, margin: 0 }}>
              {errors.lines}
            </p>
          ) : null}
          {!lines.length && !stockViaDc ? (
            <Button size="sm" variant="ghost" onClick={() => setLines([blankLine(settings.defaultGstRate)])}>
              Start with a free-text line
            </Button>
          ) : null}
        </div>
      </Card>

      {stockIssues.length ? (
        <Alert tone={blockedByStock ? "coral" : "amber"} title={blockedByStock ? "Not enough stock to issue" : "Stock will go negative"}>
          {stockIssues.map((s) => `${s.name}: need ${qtyText(s.need, s.unit)}, have ${qtyText(s.have, s.unit)}`).join(" · ")}
          {blockedByStock ? ". Reduce the quantity, receive stock first, or allow negative stock in Settings. You can still save a draft." : "."}
        </Alert>
      ) : null}

      <Card interactive={false}>
        <FormGrid columns="1fr 1fr">
          <Field label="Shipping charges (taxable)">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                type="number"
                min={0}
                step="0.01"
                value={shippingCharges}
                onChange={(e) => setShippingCharges(e.target.value)}
                placeholder="0"
              />
            )}
          </Field>
          <Field label="Shipping GST %" hint={shipAmt > 0 ? `Tax ${inrExact(totals.shippingTax ?? 0)}` : "Optional freight / delivery"}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={shippingGstRate}
                onChange={(e) => setShippingGstRate(e.target.value)}
              />
            )}
          </Field>
          <Field label="Retention %" hint={retPct > 0 ? `Withheld ${inrExact(totals.retentionAmount ?? 0)} — not due yet` : "Contract retention (Zoho / SAP parity)"}>
            {({ id, describedBy }) => (
              <Input id={id} aria-describedby={describedBy} type="number" min={0} max={100} step="0.01" value={retentionPct} onChange={(e) => setRetentionPct(e.target.value)} placeholder="0" />
            )}
          </Field>
          <Field label="Progress %" hint="Milestone / stage billing against the job or quote (optional)">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={progressPct}
                onChange={(e) => setProgressPct(e.target.value)}
                placeholder="e.g. 40"
              />
            )}
          </Field>
          <Field label="Progress label" hint="Printed on the invoice, e.g. Stage 2 — Cabling">
            {({ id, describedBy }) => (
              <Input id={id} aria-describedby={describedBy} maxLength={120} value={progressLabel} onChange={(e) => setProgressLabel(e.target.value)} placeholder="Optional milestone name" />
            )}
          </Field>
          <Field label="Salesperson">
            {({ id, describedBy }) => (
              <Select id={id} aria-describedby={describedBy} value={salespersonId} onChange={(e) => setSalespersonId(e.target.value)}>
                <option value="">From customer / none</option>
                {salespeople.map((m) => (
                  <option key={m.userId} value={String(m.userId)}>
                    {m.name || m.email || `User ${m.userId}`}
                    {m.isAccountManager ? " · AM" : ""}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Notes (printed)">{({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} placeholder="Thank you for your business!" />}</Field>
          <Field label="Terms & conditions">{({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={3} value={terms} onChange={(e) => setTerms(e.target.value)} maxLength={4000} />}</Field>
        </FormGrid>
      </Card>

      <div className="fin-sticky-actions">
        <span className="ims-muted" style={{ marginRight: "auto", alignSelf: "center", fontSize: 13 }}>
          Total <b className="ims-num" style={{ fontSize: 16, color: "var(--bos-text)" }}>{moneyFmt(totals.grandTotal, currencyCode || baseCurrency)}</b>
          {totals.taxTotal ? ` · GST ${moneyFmt(totals.taxTotal, currencyCode || baseCurrency)}` : ""}
          {foreign && fxRateNum > 0 ? ` · ≈ ${moneyFmt(fx.fxBaseTotal, baseCurrency)}` : ""}
        </span>
        <Button variant="ghost" onClick={() => onClose(draft?.invoice.id ?? null)} disabled={Boolean(busy)}>
          Cancel
        </Button>
        <Button onClick={() => save(false)} disabled={Boolean(busy)}>
          {busy === "save" ? "Saving…" : "Save draft"}
        </Button>
        <Button variant="primary" icon="check" onClick={() => save(true)} disabled={Boolean(busy) || blockedByStock}>
          {busy === "issue" ? (needsApproval ? "Submitting…" : "Issuing…") : needsApproval ? "Save & submit for approval" : "Save & issue"}
        </Button>
      </div>
      {needsApproval ? (
        <p className="ims-muted" style={{ fontSize: 12, margin: 0 }}>
          Total is at or above the {inrExact(settings.invoiceApprovalLimit)} invoice approval limit — Approvals must sign off before stock and AR post.
        </p>
      ) : null}
    </Stack>
  );
}
