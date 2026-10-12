import { isoOf, json, money, one, rows, tsOf, type Queryable } from "./db.js";
import { AUDIT_RULES, daysBetween, isValidGstin, round2, type ImsLine } from "./logic.js";

/* ---------- Document trail: follows one record through order → stock → bill / invoice → payment → bank → GST → Tally ---------- */

export const TRACE_TYPES = ["invoice", "bill", "po", "payment", "expense"] as const;
export type TraceType = (typeof TRACE_TYPES)[number];
export type TraceState = "ok" | "warn" | "bad" | "na";
export type TraceLink = { type: string; id: string };
export type TraceStep = { label: string; title: string; detail: string; state: TraceState; link?: TraceLink };
export type TraceDetail = [label: string, value: string];
export type Trace = { type: TraceType; id: string; title: string; subtitle: string; details: TraceDetail[]; steps: TraceStep[]; events: Array<{ at: string | null; by: string | null; summary: string }> };

export type TracePay = { id: string; date: string; amount: number; method: string; reference: string | null; docNo?: string | null };
export type TraceBank = { id: string; date: string; description: string; amount: number; matchedId: string };
export type TraceTally = { enabled: boolean; lastOkAt: string | null; lastStatus: string | null };

const inr = (n: number) => `₹${round2(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const sum = <T>(l: ReadonlyArray<T>, f: (x: T) => number) => round2(l.reduce((s, x) => s + f(x), 0));

function paymentStep(pays: ReadonlyArray<TracePay>, total: number, paid: number, due: string | null, today: string, verb: "received" | "paid"): TraceStep {
  if (!pays.length && paid <= 0.005) {
    const late = due ? daysBetween(due, today) : 0;
    return { label: "Payment", title: verb === "received" ? "Not received yet" : "Unpaid", detail: due ? (late > 0 ? `${plural(late, "day")} overdue` : `Due ${due}`) : "No due date", state: late > 0 ? "warn" : "na" };
  }
  const last = pays[0];
  const detail = last ? `${plural(pays.length, "payment")} · last ${last.date} by ${last.method}${last.reference ? ` · ${last.reference}` : ""}` : "Recorded on the document";
  if (paid + 0.005 >= total) return { label: "Payment", title: `${inr(paid)} ${verb} in full`, detail, state: "ok", link: last ? { type: "payment", id: last.id } : undefined };
  return { label: "Payment", title: `${inr(paid)} of ${inr(total)} ${verb}`, detail: `${detail} · ${inr(total - paid)} outstanding`, state: "warn", link: last ? { type: "payment", id: last.id } : undefined };
}

function bankStep(pays: ReadonlyArray<TracePay>, bank: ReadonlyArray<TraceBank>): TraceStep {
  const nonCash = pays.filter((p) => p.method !== "cash");
  if (!pays.length) return { label: "Bank statement", title: "—", detail: "Nothing to match yet", state: "na" };
  if (!nonCash.length) return { label: "Bank statement", title: "Cash", detail: "Cash payments don't appear on the bank statement", state: "na" };
  const matched = nonCash.filter((p) => bank.some((b) => b.matchedId === p.id));
  if (matched.length === nonCash.length) {
    const b = bank.find((x) => x.matchedId === nonCash[0].id);
    return { label: "Bank statement", title: "Matched", detail: b ? `${b.date} · ${b.description}` : `${plural(matched.length, "payment")} matched`, state: "ok" };
  }
  return { label: "Bank statement", title: `${nonCash.length - matched.length} of ${nonCash.length} not matched`, detail: "Import the bank statement in Bank reconciliation and match it", state: "warn" };
}

function tallyStep(t: TraceTally, changedAt: string | null, applies: boolean): TraceStep {
  if (!t.enabled) return { label: "Tally", title: "Not connected", detail: "Connect Tally in Integrations to post vouchers", state: "na" };
  if (!applies) return { label: "Tally", title: "Not posted", detail: "Only issued / approved documents are sent to Tally", state: "na" };
  if (t.lastOkAt && changedAt && t.lastOkAt >= changedAt) return { label: "Tally", title: "Included in the last sync", detail: `Last successful sync ${t.lastOkAt.slice(0, 16).replace("T", " ")}`, state: "ok" };
  return { label: "Tally", title: "Changed since the last sync", detail: t.lastOkAt ? `Last successful sync ${t.lastOkAt.slice(0, 16).replace("T", " ")}${t.lastStatus && t.lastStatus !== "success" ? ` · last run ${t.lastStatus}` : ""}` : "Never synced", state: "warn" };
}

const docStep = (n: number, needed: boolean): TraceStep =>
  n > 0 ? { label: "Supporting documents", title: `${plural(n, "document")} attached`, detail: "See Auditing → Documents", state: "ok" } : { label: "Supporting documents", title: "None attached", detail: needed ? "Attach the supporting document in Auditing → Documents" : "Optional for this record", state: needed ? "warn" : "na" };

export type InvoiceFacts = {
  id: string;
  no: string;
  status: string;
  date: string;
  due: string | null;
  customer: string;
  customerId: string | null;
  gstin: string | null;
  intraState: boolean;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  paid: number;
  stockPosted: boolean;
  stockLines: number;
  catalogLines: number;
  source: { tool: string; ref: string | null } | null;
  changedAt: string | null;
  payments: TracePay[];
  bank: TraceBank[];
  returns: Array<{ id: string; no: string; status: string; refundStatus: string; amount: number; date: string }>;
  docs: number;
  tally: TraceTally;
  today: string;
};

export function invoiceTrace(f: InvoiceFacts): Omit<Trace, "events"> {
  const issued = f.status === "issued";
  const tax = round2(f.cgst + f.sgst + f.igst);
  const steps: TraceStep[] = [];
  if (f.source) steps.push({ label: "Source", title: `From ${f.source.tool.replace(/_/g, " ")}`, detail: f.source.ref ? `Reference ${f.source.ref}` : "Imported from another JBT tool", state: "ok" });
  steps.push({
    label: "Invoice",
    title: f.no,
    detail: `${f.date} · ${inr(f.total)} · ${f.customer}`,
    state: f.status === "cancelled" ? "na" : issued ? "ok" : "warn",
  });
  if (f.status === "draft") steps[steps.length - 1].detail += " · draft, not issued";
  if (f.status === "cancelled") steps[steps.length - 1].detail += " · cancelled";
  steps.push(
    !issued
      ? { label: "Stock out", title: "Not posted", detail: "Stock moves when the invoice is issued", state: "na" }
      : f.catalogLines === 0
        ? { label: "Stock out", title: "No catalog items", detail: "Service or free-text lines — no stock to move", state: "na" }
        : f.stockPosted && f.stockLines > 0
          ? { label: "Stock out", title: `${plural(f.stockLines, "line")} issued from stock`, detail: "Posted to the stock ledger on issue", state: "ok" }
          : { label: "Stock out", title: "Stock not reduced", detail: "The invoice is issued but no stock movement was posted", state: "bad" },
  );
  steps.push(issued ? paymentStep(f.payments, f.total, f.paid, f.due, f.today, "received") : { label: "Payment", title: "—", detail: "Not issued", state: "na" });
  steps.push(bankStep(f.payments, f.bank));
  if (f.returns.length) {
    const open = f.returns.filter((r) => r.status !== "completed" && r.status !== "cancelled");
    const notes = f.returns.filter((r) => r.refundStatus === "credit_note");
    steps.push({
      label: "Returns & credit notes",
      title: `${plural(f.returns.length, "return")}${notes.length ? ` · ${plural(notes.length, "credit note")}` : ""}`,
      detail: f.returns.map((r) => `${r.no} ${inr(r.amount)} (${r.status})`).join(" · "),
      state: open.length ? "warn" : "ok",
      link: { type: "return", id: f.returns[0].id },
    });
  } else steps.push({ label: "Returns & credit notes", title: "None", detail: "No goods returned against this invoice", state: "na" });

  const gstinOk = f.gstin ? isValidGstin(f.gstin) : false;
  const wrongSplit = (f.intraState && f.igst > 0) || (!f.intraState && f.cgst + f.sgst > 0);
  steps.push(
    tax <= 0
      ? { label: "GST", title: "No GST charged", detail: "Exempt or nil-rated", state: "na" }
      : wrongSplit
        ? { label: "GST", title: "Wrong tax type", detail: f.intraState ? "Same-state sale but IGST charged" : "Inter-state sale but CGST/SGST charged", state: "bad" }
        : f.gstin && !gstinOk
          ? { label: "GST", title: "Invalid customer GSTIN", detail: `${f.gstin} doesn't pass the GSTIN check`, state: "bad" }
          : !f.gstin && f.total > AUDIT_RULES.b2cLargeLimit && !f.intraState
            ? { label: "GST", title: "Large B2C inter-state sale", detail: `Over ${inr(AUDIT_RULES.b2cLargeLimit)} — reported invoice-wise in GSTR-1 (B2CL)`, state: "warn" }
            : { label: "GST", title: f.gstin ? "B2B" : "B2C", detail: f.intraState ? `CGST ${inr(f.cgst)} + SGST ${inr(f.sgst)}` : `IGST ${inr(f.igst)}`, state: "ok" },
  );
  steps.push(docStep(f.docs, false));
  steps.push(tallyStep(f.tally, f.changedAt, issued));
  return {
    type: "invoice",
    id: f.id,
    title: `Invoice ${f.no}`,
    subtitle: `${f.customer} · ${f.date}`,
    details: [
      ["Customer", f.customer],
      ["GSTIN", f.gstin || "Unregistered"],
      ["Status", f.status],
      ["Invoice date", f.date],
      ["Due date", f.due ?? "—"],
      ["Taxable value", inr(f.taxable)],
      ["GST", inr(tax)],
      ["Total", inr(f.total)],
      ["Received", inr(f.paid)],
      ["Outstanding", inr(Math.max(0, f.total - f.paid))],
    ],
    steps,
  };
}

export type BillFacts = {
  id: string;
  no: string;
  supplierBillNo: string | null;
  status: string;
  date: string;
  due: string | null;
  supplier: string;
  supplierGstin: string | null;
  subtotal: number;
  tax: number;
  total: number;
  paid: number;
  holdReason: string | null;
  decidedBy: string | null;
  po: { id: string; no: string; status: string; total: number; ordered: number; received: number } | null;
  receivedValue: number;
  changedAt: string | null;
  payments: TracePay[];
  bank: TraceBank[];
  docs: number;
  tally: TraceTally;
  today: string;
};

export function receiptStep(po: NonNullable<BillFacts["po"]>, receivedValue: number): TraceStep {
  if (po.received <= 0) return { label: "Goods receipt", title: "Nothing received", detail: `0 of ${po.ordered} units received against ${po.no}`, state: "bad", link: { type: "po", id: po.id } };
  if (po.received + 1e-6 < po.ordered) return { label: "Goods receipt", title: "Partly received", detail: `${po.received} of ${po.ordered} units · ${inr(receivedValue)} into stock`, state: "warn", link: { type: "po", id: po.id } };
  return { label: "Goods receipt", title: "Fully received", detail: `${po.ordered} units · ${inr(receivedValue)} into stock`, state: "ok", link: { type: "po", id: po.id } };
}

export function billTrace(f: BillFacts): Omit<Trace, "events"> {
  const live = f.status !== "cancelled";
  const steps: TraceStep[] = [];
  if (f.po) {
    const diff = round2(f.total - f.po.total);
    steps.push({
      label: "Purchase order",
      title: f.po.no,
      detail: Math.abs(diff) > 1 ? `PO ${inr(f.po.total)} · bill is ${diff > 0 ? "higher" : "lower"} by ${inr(Math.abs(diff))}` : `PO ${inr(f.po.total)} · matches the bill`,
      state: Math.abs(diff) > 1 ? "warn" : "ok",
      link: { type: "po", id: f.po.id },
    });
    steps.push(receiptStep(f.po, f.receivedValue));
  } else {
    steps.push({ label: "Purchase order", title: "No purchase order", detail: "Fine for services; goods should be ordered on a PO", state: "warn" });
    steps.push({ label: "Goods receipt", title: "—", detail: "No PO to receive against", state: "na" });
  }
  steps.push({
    label: "Supplier invoice",
    title: f.supplierBillNo || "Number not recorded",
    detail: `${f.no} · ${f.date} · ${inr(f.total)}`,
    state: f.supplierBillNo ? "ok" : "warn",
  });
  steps.push(
    f.status === "pending_approval"
      ? { label: "Approval", title: "Waiting for approval", detail: "Approve it in Approvals before paying", state: "warn" }
      : f.status === "on_hold"
        ? { label: "Approval", title: "On hold", detail: f.holdReason || "No reason recorded", state: "warn" }
        : f.status === "cancelled"
          ? { label: "Approval", title: "Cancelled", detail: "Not payable", state: "na" }
          : { label: "Approval", title: f.status === "scheduled" ? "Approved · payment scheduled" : "Approved", detail: f.decidedBy ? `By ${f.decidedBy}` : "Approved", state: "ok" },
  );
  steps.push(live ? paymentStep(f.payments, f.total, f.paid, f.due, f.today, "paid") : { label: "Payment", title: "—", detail: "Cancelled", state: "na" });
  steps.push(bankStep(f.payments, f.bank));
  const gstinOk = f.supplierGstin ? isValidGstin(f.supplierGstin) : false;
  steps.push(
    f.tax <= 0
      ? { label: "GST input credit", title: "No GST on the bill", detail: "Nothing to claim", state: "na" }
      : !f.supplierGstin
        ? { label: "GST input credit", title: "Supplier GSTIN missing", detail: `${inr(f.tax)} credit can't be claimed without the supplier's GSTIN`, state: "bad" }
        : !gstinOk
          ? { label: "GST input credit", title: "Invalid supplier GSTIN", detail: `${f.supplierGstin} doesn't pass the GSTIN check`, state: "bad" }
          : { label: "GST input credit", title: `${inr(f.tax)} claimable`, detail: `Supplier ${f.supplierGstin} · check it appears in GSTR-2B`, state: "ok" },
  );
  steps.push(docStep(f.docs, live));
  steps.push(tallyStep(f.tally, f.changedAt, live && f.status !== "pending_approval"));
  return {
    type: "bill",
    id: f.id,
    title: `Bill ${f.no}`,
    subtitle: `${f.supplier} · ${f.date}`,
    details: [
      ["Supplier", f.supplier],
      ["Supplier GSTIN", f.supplierGstin || "—"],
      ["Supplier invoice", f.supplierBillNo || "—"],
      ["Status", f.status.replace(/_/g, " ")],
      ["Bill date", f.date],
      ["Due date", f.due ?? "—"],
      ["Taxable value", inr(f.subtotal)],
      ["GST", inr(f.tax)],
      ["Total", inr(f.total)],
      ["Paid", inr(f.paid)],
    ],
    steps,
  };
}

export type PoFacts = {
  id: string;
  no: string;
  status: string;
  date: string;
  supplier: string;
  total: number;
  decidedBy: string | null;
  ordered: number;
  received: number;
  receivedValue: number;
  bills: Array<{ id: string; no: string; total: number; paid: number; status: string }>;
  changedAt: string | null;
};

export function poTrace(f: PoFacts): Omit<Trace, "events"> {
  const steps: TraceStep[] = [];
  const approved = !["draft", "pending_approval", "rejected", "cancelled"].includes(f.status);
  steps.push({ label: "Purchase order", title: f.no, detail: `${f.date} · ${inr(f.total)} · ${f.supplier}`, state: f.status === "cancelled" || f.status === "rejected" ? "na" : "ok" });
  steps.push(
    f.status === "rejected"
      ? { label: "Approval", title: "Rejected", detail: f.decidedBy ? `By ${f.decidedBy}` : "Rejected", state: "na" }
      : approved
        ? { label: "Approval", title: "Approved", detail: f.decidedBy ? `By ${f.decidedBy}` : "Within the auto-approval limit", state: "ok" }
        : { label: "Approval", title: f.status === "draft" ? "Draft" : "Waiting for approval", detail: "Not yet sent to the supplier", state: f.status === "draft" ? "na" : "warn" },
  );
  steps.push(approved ? receiptStep({ id: f.id, no: f.no, status: f.status, total: f.total, ordered: f.ordered, received: f.received }, f.receivedValue) : { label: "Goods receipt", title: "—", detail: "Not approved yet", state: "na" });
  const live = f.bills.filter((b) => b.status !== "cancelled");
  const billed = sum(live, (b) => b.total);
  steps.push(
    !live.length
      ? { label: "Supplier bill", title: "Not billed", detail: f.received > 0 ? "Goods received — record the supplier's bill" : "Nothing received yet", state: f.received > 0 ? "warn" : "na" }
      : { label: "Supplier bill", title: `${plural(live.length, "bill")} · ${inr(billed)}`, detail: Math.abs(billed - f.total) > 1 ? `PO ${inr(f.total)} · difference ${inr(billed - f.total)}` : "Matches the PO", state: Math.abs(billed - f.total) > 1 ? "warn" : "ok", link: { type: "bill", id: live[0].id } },
  );
  const paid = sum(live, (b) => b.paid);
  steps.push(!live.length ? { label: "Payment", title: "—", detail: "No bill yet", state: "na" } : paid + 0.005 >= billed ? { label: "Payment", title: "Paid in full", detail: inr(paid), state: "ok" } : { label: "Payment", title: `${inr(paid)} of ${inr(billed)} paid`, detail: `${inr(billed - paid)} outstanding`, state: paid > 0 ? "warn" : "na" });
  return {
    type: "po",
    id: f.id,
    title: `Purchase order ${f.no}`,
    subtitle: `${f.supplier} · ${f.date}`,
    details: [
      ["Supplier", f.supplier],
      ["Status", f.status.replace(/_/g, " ")],
      ["Order date", f.date],
      ["Total", inr(f.total)],
      ["Ordered units", String(f.ordered)],
      ["Received units", String(f.received)],
      ["Billed", inr(billed)],
    ],
    steps,
  };
}

export type PaymentFacts = { id: string; direction: "in" | "out"; party: string; amount: number; method: string; reference: string | null; date: string; doc: { type: "invoice" | "bill"; id: string; no: string | null } | null; bank: TraceBank[] };

export function paymentTrace(f: PaymentFacts): Omit<Trace, "events"> {
  const pay: TracePay = { id: f.id, date: f.date, amount: f.amount, method: f.method, reference: f.reference };
  return {
    type: "payment",
    id: f.id,
    title: `${f.direction === "in" ? "Receipt from" : "Payment to"} ${f.party}`,
    subtitle: `${f.date} · ${inr(f.amount)}`,
    details: [
      ["Party", f.party],
      ["Direction", f.direction === "in" ? "Received" : "Paid"],
      ["Amount", inr(f.amount)],
      ["Method", f.method],
      ["Reference", f.reference || "—"],
      ["Date", f.date],
    ],
    steps: [
      { label: f.direction === "in" ? "Receipt" : "Payment", title: inr(f.amount), detail: `${f.date} · ${f.method}${f.reference ? ` · ${f.reference}` : ""}`, state: f.method !== "cash" && !f.reference ? "warn" : "ok" },
      f.doc ? { label: "Against", title: `${f.doc.type === "invoice" ? "Invoice" : "Bill"} ${f.doc.no ?? ""}`.trim(), detail: "Settles this document", state: "ok", link: { type: f.doc.type, id: f.doc.id } } : { label: "Against", title: "On account", detail: "Not allocated to an invoice or bill", state: "warn" },
      bankStep([pay], f.bank),
    ],
  };
}

export type ExpenseFacts = { id: string; date: string; category: string; description: string | null; vendor: string | null; amount: number; gst: number; method: string; reference: string | null; by: string | null; bank: TraceBank[]; docs: number };

export function expenseTrace(f: ExpenseFacts): Omit<Trace, "events"> {
  const pay: TracePay = { id: f.id, date: f.date, amount: f.amount, method: f.method, reference: f.reference };
  return {
    type: "expense",
    id: f.id,
    title: `Expense · ${f.category}`,
    subtitle: `${f.date} · ${inr(f.amount)}`,
    details: [
      ["Category", f.category],
      ["Description", f.description || "—"],
      ["Paid to", f.vendor || "—"],
      ["Amount", inr(f.amount)],
      ["GST", inr(f.gst)],
      ["Method", f.method],
      ["Recorded by", f.by || "—"],
    ],
    steps: [
      { label: "Expense", title: inr(f.amount), detail: `${f.date} · ${f.category}${f.vendor ? ` · ${f.vendor}` : ""}`, state: "ok" },
      docStep(f.docs, f.amount >= AUDIT_RULES.largeWriteOffValue || f.gst > 0),
      f.gst > 0 ? { label: "GST input credit", title: inr(f.gst), detail: f.docs > 0 ? "Supported by an attached bill" : "Needs the supplier's tax invoice to claim", state: f.docs > 0 ? "ok" : "warn" } : { label: "GST input credit", title: "None", detail: "No GST recorded", state: "na" },
      bankStep([pay], f.bank),
    ],
  };
}

/* ---------- Loader ---------- */

const linesQty = (raw: unknown) => {
  const lines = json<ImsLine[]>(raw, []);
  return {
    ordered: round2(lines.reduce((s, l) => s + (Number(l.qty) || 0), 0)),
    received: round2(lines.reduce((s, l) => s + Math.min(Number(l.qty) || 0, Number(l.receivedQty) || 0), 0)),
    catalog: lines.filter((l) => l.itemId).length,
  };
};

async function payments(db: Queryable, tenantId: number, docType: "invoice" | "bill", ids: string[]): Promise<TracePay[]> {
  if (!ids.length) return [];
  const list = await rows<{ id: string; paid_on: string; amount: string; method: string; reference: string | null; doc_no: string | null }>(
    db,
    `SELECT id, paid_on, amount, method, reference, doc_no FROM ims_payments WHERE tenant_id = :tenantId AND doc_type = :docType AND doc_id IN (:ids) ORDER BY paid_on DESC, created_at DESC LIMIT 200`,
    { tenantId, docType, ids },
  );
  return list.map((p) => ({ id: p.id, date: isoOf(p.paid_on), amount: money(p.amount), method: p.method, reference: p.reference, docNo: p.doc_no }));
}

async function bankHits(db: Queryable, tenantId: number, type: "payment" | "expense", ids: string[]): Promise<TraceBank[]> {
  if (!ids.length) return [];
  const list = await rows<{ id: string; txn_date: string; description: string; amount: string; matched_id: string }>(
    db,
    `SELECT id, txn_date, description, amount, matched_id FROM ims_bank_txns WHERE tenant_id = :tenantId AND status = 'matched' AND matched_type = :type AND matched_id IN (:ids)`,
    { tenantId, type, ids },
  );
  return list.map((b) => ({ id: b.id, date: isoOf(b.txn_date), description: b.description, amount: money(b.amount), matchedId: b.matched_id }));
}

async function docCount(db: Queryable, tenantId: number, type: string, id: string): Promise<number> {
  const r = await one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM ims_documents WHERE tenant_id = :tenantId AND entity_type = :type AND entity_id = :id`, { tenantId, type, id });
  return Number(r?.n ?? 0);
}

async function tallyState(db: Queryable, tenantId: number, entity: "sales" | "purchases"): Promise<TraceTally> {
  const [cfg, last, lastOk] = await Promise.all([
    one<{ enabled: number }>(db, `SELECT enabled FROM ims_integrations WHERE tenant_id = :tenantId AND provider = 'tally'`, { tenantId }),
    one<{ status: string }>(db, `SELECT status FROM ims_sync_log WHERE tenant_id = :tenantId AND provider = 'tally' AND entity = :entity ORDER BY id DESC LIMIT 1`, { tenantId, entity }),
    one<{ created_at: string }>(db, `SELECT created_at FROM ims_sync_log WHERE tenant_id = :tenantId AND provider = 'tally' AND entity = :entity AND status = 'success' ORDER BY id DESC LIMIT 1`, { tenantId, entity }),
  ]);
  return { enabled: Boolean(cfg?.enabled), lastOkAt: lastOk ? tsOf(lastOk.created_at) : null, lastStatus: last?.status ?? null };
}

const EVENT_TYPES: Record<TraceType, string[]> = { invoice: ["invoice"], bill: ["bill"], po: ["po", "purchase_order"], payment: ["payment"], expense: ["expense"] };

async function events(db: Queryable, tenantId: number, type: TraceType, id: string): Promise<Trace["events"]> {
  const list = await rows<{ created_at: string; actor_name: string | null; summary: string }>(
    db,
    `SELECT created_at, actor_name, summary FROM ims_events WHERE tenant_id = :tenantId AND entity_type IN (:types) AND entity_id = :id ORDER BY id DESC LIMIT 40`,
    { tenantId, types: EVENT_TYPES[type], id },
  );
  return list.map((e) => ({ at: tsOf(e.created_at), by: e.actor_name, summary: e.summary }));
}

async function poFacts(db: Queryable, tenantId: number, poId: string) {
  const [po, moved] = await Promise.all([
    one<{ id: string; po_no: string; status: string; order_date: string; supplier_name: string; grand_total: string; decided_by_name: string | null; lines: unknown; updated_at: string }>(
      db,
      `SELECT id, po_no, status, order_date, supplier_name, grand_total, decided_by_name, \`lines\`, updated_at FROM ims_purchase_orders WHERE tenant_id = :tenantId AND id = :id`,
      { tenantId, id: poId },
    ),
    one<{ v: string | null }>(db, `SELECT SUM(value) AS v FROM ims_movements WHERE tenant_id = :tenantId AND ref_type = 'po' AND ref_id = :id`, { tenantId, id: poId }),
  ]);
  return po ? { po, qty: linesQty(po.lines), receivedValue: money(moved?.v) } : null;
}

/** Null when the record doesn't exist for this tenant. Read-only. */
export async function loadTrace(db: Queryable, tenantId: number, type: TraceType, id: string, today: string): Promise<Trace | null> {
  let base: Omit<Trace, "events"> | null = null;
  if (type === "invoice") {
    const r = await one<{
      id: string;
      invoice_no: string;
      status: string;
      invoice_date: string;
      due_date: string | null;
      customer_name: string;
      customer_id: string | null;
      customer_gstin: string | null;
      intra_state: number;
      subtotal: string;
      discount_total: string;
      cgst: string;
      sgst: string;
      igst: string;
      grand_total: string;
      amount_paid: string;
      stock_posted: number;
      source_tool: string | null;
      source_ref: string | null;
      lines: unknown;
      updated_at: string;
    }>(
      db,
      `SELECT id, invoice_no, status, invoice_date, due_date, customer_name, customer_id, customer_gstin, intra_state, subtotal, discount_total, cgst, sgst, igst, grand_total, amount_paid, stock_posted, source_tool, source_ref, \`lines\`, updated_at
       FROM ims_invoices WHERE tenant_id = :tenantId AND id = :id`,
      { tenantId, id },
    );
    if (!r) return null;
    const [pays, moves, rets, docs, tally] = await Promise.all([
      payments(db, tenantId, "invoice", [id]),
      one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM ims_movements WHERE tenant_id = :tenantId AND ref_type IN ('invoice', 'pos') AND ref_id = :id`, { tenantId, id }),
      rows<{ id: string; return_no: string; status: string; refund_status: string; total: string; refund_amount: string; return_date: string }>(
        db,
        `SELECT id, return_no, status, refund_status, total, refund_amount, return_date FROM ims_returns WHERE tenant_id = :tenantId AND ref_doc_id = :id ORDER BY return_date`,
        { tenantId, id },
      ),
      docCount(db, tenantId, "invoice", id),
      tallyState(db, tenantId, "sales"),
    ]);
    const bank = await bankHits(db, tenantId, "payment", pays.map((p) => p.id));
    base = invoiceTrace({
      id,
      no: r.invoice_no,
      status: r.status,
      date: isoOf(r.invoice_date),
      due: r.due_date ? isoOf(r.due_date) : null,
      customer: r.customer_name,
      customerId: r.customer_id,
      gstin: r.customer_gstin,
      intraState: Boolean(r.intra_state),
      taxable: round2(money(r.subtotal) - money(r.discount_total)),
      cgst: money(r.cgst),
      sgst: money(r.sgst),
      igst: money(r.igst),
      total: money(r.grand_total),
      paid: money(r.amount_paid),
      stockPosted: Boolean(r.stock_posted),
      stockLines: Number(moves?.n ?? 0),
      catalogLines: linesQty(r.lines).catalog,
      source: r.source_tool ? { tool: r.source_tool, ref: r.source_ref } : null,
      changedAt: tsOf(r.updated_at),
      payments: pays,
      bank,
      returns: rets.map((x) => ({ id: x.id, no: x.return_no, status: x.status, refundStatus: x.refund_status, amount: money(x.refund_amount) > 0 ? money(x.refund_amount) : money(x.total), date: isoOf(x.return_date) })),
      docs,
      tally,
      today,
    });
  } else if (type === "bill") {
    const r = await one<{
      id: string;
      bill_no: string;
      supplier_bill_no: string | null;
      status: string;
      bill_date: string;
      due_date: string | null;
      supplier_name: string;
      supplier_gstin: string | null;
      po_id: string | null;
      subtotal: string;
      tax_total: string;
      grand_total: string;
      amount_paid: string;
      hold_reason: string | null;
      decided_by_name: string | null;
      updated_at: string;
    }>(
      db,
      `SELECT b.id, b.bill_no, b.supplier_bill_no, b.status, b.bill_date, b.due_date, b.supplier_name, p.gstin AS supplier_gstin, b.po_id, b.subtotal, b.tax_total, b.grand_total, b.amount_paid, b.hold_reason, b.decided_by_name, b.updated_at
       FROM ims_bills b LEFT JOIN ims_parties p ON p.tenant_id = b.tenant_id AND p.id = b.supplier_id
       WHERE b.tenant_id = :tenantId AND b.id = :id`,
      { tenantId, id },
    );
    if (!r) return null;
    const [pays, po, docs, tally] = await Promise.all([payments(db, tenantId, "bill", [id]), r.po_id ? poFacts(db, tenantId, r.po_id) : null, docCount(db, tenantId, "bill", id), tallyState(db, tenantId, "purchases")]);
    const bank = await bankHits(db, tenantId, "payment", pays.map((p) => p.id));
    base = billTrace({
      id,
      no: r.bill_no,
      supplierBillNo: r.supplier_bill_no,
      status: r.status,
      date: isoOf(r.bill_date),
      due: r.due_date ? isoOf(r.due_date) : null,
      supplier: r.supplier_name,
      supplierGstin: r.supplier_gstin,
      subtotal: money(r.subtotal),
      tax: money(r.tax_total),
      total: money(r.grand_total),
      paid: money(r.amount_paid),
      holdReason: r.hold_reason,
      decidedBy: r.decided_by_name,
      po: po ? { id: po.po.id, no: po.po.po_no, status: po.po.status, total: money(po.po.grand_total), ordered: po.qty.ordered, received: po.qty.received } : null,
      receivedValue: po?.receivedValue ?? 0,
      changedAt: tsOf(r.updated_at),
      payments: pays,
      bank,
      docs,
      tally,
      today,
    });
  } else if (type === "po") {
    const f = await poFacts(db, tenantId, id);
    if (!f) return null;
    const bills = await rows<{ id: string; bill_no: string; grand_total: string; amount_paid: string; status: string }>(
      db,
      `SELECT id, bill_no, grand_total, amount_paid, status FROM ims_bills WHERE tenant_id = :tenantId AND po_id = :id ORDER BY bill_date`,
      { tenantId, id },
    );
    base = poTrace({
      id,
      no: f.po.po_no,
      status: f.po.status,
      date: isoOf(f.po.order_date),
      supplier: f.po.supplier_name,
      total: money(f.po.grand_total),
      decidedBy: f.po.decided_by_name,
      ordered: f.qty.ordered,
      received: f.qty.received,
      receivedValue: f.receivedValue,
      bills: bills.map((b) => ({ id: b.id, no: b.bill_no, total: money(b.grand_total), paid: money(b.amount_paid), status: b.status })),
      changedAt: tsOf(f.po.updated_at),
    });
  } else if (type === "payment") {
    const r = await one<{ id: string; direction: string; party_name: string; amount: string; method: string; reference: string | null; paid_on: string; doc_type: string; doc_id: string | null; doc_no: string | null }>(
      db,
      `SELECT id, direction, party_name, amount, method, reference, paid_on, doc_type, doc_id, doc_no FROM ims_payments WHERE tenant_id = :tenantId AND id = :id`,
      { tenantId, id },
    );
    if (!r) return null;
    base = paymentTrace({
      id,
      direction: r.direction === "out" ? "out" : "in",
      party: r.party_name,
      amount: money(r.amount),
      method: r.method,
      reference: r.reference,
      date: isoOf(r.paid_on),
      doc: r.doc_id && (r.doc_type === "invoice" || r.doc_type === "bill") ? { type: r.doc_type, id: r.doc_id, no: r.doc_no } : null,
      bank: await bankHits(db, tenantId, "payment", [id]),
    });
  } else {
    const r = await one<{ id: string; expense_date: string; category: string; description: string | null; vendor: string | null; amount: string; gst_amount: string; pay_method: string; reference: string | null; created_by_name: string | null }>(
      db,
      `SELECT id, expense_date, category, description, vendor, amount, gst_amount, pay_method, reference, created_by_name FROM ims_expenses WHERE tenant_id = :tenantId AND id = :id`,
      { tenantId, id },
    );
    if (!r) return null;
    const [bank, docs] = await Promise.all([bankHits(db, tenantId, "expense", [id]), docCount(db, tenantId, "expense", id)]);
    base = expenseTrace({
      id,
      date: isoOf(r.expense_date),
      category: r.category,
      description: r.description,
      vendor: r.vendor,
      amount: money(r.amount),
      gst: money(r.gst_amount),
      method: r.pay_method,
      reference: r.reference,
      by: r.created_by_name,
      bank,
      docs,
    });
  }
  return { ...base, events: await events(db, tenantId, type, id) };
}
