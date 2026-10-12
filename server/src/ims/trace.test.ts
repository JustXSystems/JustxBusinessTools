import { describe, expect, it } from "vitest";
import { normInvoiceNo, reconcileGstr2b, type BookBill } from "./gstr2b.js";
import { billTrace, invoiceTrace, poTrace, type InvoiceFacts } from "./trace.js";

const tally = { enabled: true, lastOkAt: "2026-10-10T10:00:00.000Z", lastStatus: "success" };

const invoice = (over: Partial<InvoiceFacts> = {}): InvoiceFacts => ({
  id: "i1",
  no: "INV/26-27/0001",
  status: "issued",
  date: "2026-09-01",
  due: "2026-09-30",
  customer: "Alpha",
  customerId: null,
  gstin: "29ABCDE1234F1Z5",
  intraState: true,
  taxable: 1000,
  cgst: 90,
  sgst: 90,
  igst: 0,
  total: 1180,
  paid: 1180,
  stockPosted: true,
  stockLines: 2,
  catalogLines: 2,
  source: null,
  changedAt: "2026-09-01T09:00:00.000Z",
  payments: [{ id: "p1", date: "2026-09-10", amount: 1180, method: "upi", reference: "UTR1" }],
  bank: [{ id: "b1", date: "2026-09-10", description: "UPI Alpha", amount: 1180, matchedId: "p1" }],
  returns: [],
  docs: 0,
  tally,
  today: "2026-10-12",
  ...over,
});

const state = (steps: Array<{ label: string; state: string }>, label: string) => steps.find((s) => s.label === label)?.state;

describe("invoiceTrace", () => {
  it("is all green for a paid, matched, synced invoice", () => {
    const t = invoiceTrace(invoice());
    expect(state(t.steps, "Payment")).toBe("ok");
    expect(state(t.steps, "Bank statement")).toBe("ok");
    expect(state(t.steps, "GST")).toBe("ok");
    expect(state(t.steps, "Tally")).toBe("ok");
    expect(t.steps.some((s) => s.state === "bad")).toBe(false);
  });

  it("flags missing stock, wrong tax type, an unmatched bank receipt and an unsynced change", () => {
    const t = invoiceTrace(invoice({ stockPosted: false, stockLines: 0, igst: 180, cgst: 0, sgst: 0, bank: [], paid: 500, changedAt: "2026-10-11T00:00:00.000Z" }));
    expect(state(t.steps, "Stock out")).toBe("bad");
    expect(state(t.steps, "GST")).toBe("bad");
    expect(state(t.steps, "Bank statement")).toBe("warn");
    expect(state(t.steps, "Payment")).toBe("warn");
    expect(state(t.steps, "Tally")).toBe("warn");
  });

  it("marks an unpaid invoice past its due date as overdue", () => {
    const step = invoiceTrace(invoice({ payments: [], bank: [], paid: 0 })).steps.find((s) => s.label === "Payment");
    expect(step?.state).toBe("warn");
    expect(step?.detail).toContain("12 days overdue");
  });
});

describe("billTrace", () => {
  const base = {
    id: "b1",
    no: "BILL-1",
    supplierBillNo: "S-77",
    status: "approved",
    date: "2026-09-05",
    due: "2026-10-05",
    supplier: "Acme",
    supplierGstin: "29ABCDE1234F1Z5",
    subtotal: 1000,
    tax: 180,
    total: 1180,
    paid: 0,
    holdReason: null,
    decidedBy: "Owner",
    po: { id: "po1", no: "PO-1", status: "partially_received", total: 1180, ordered: 10, received: 4 },
    receivedValue: 400,
    changedAt: null,
    payments: [],
    bank: [],
    docs: 0,
    tally: { enabled: false, lastOkAt: null, lastStatus: null },
    today: "2026-10-12",
  };

  it("follows PO → receipt → bill → GST", () => {
    const t = billTrace(base);
    expect(state(t.steps, "Purchase order")).toBe("ok");
    expect(state(t.steps, "Goods receipt")).toBe("warn");
    expect(state(t.steps, "GST input credit")).toBe("ok");
    expect(state(t.steps, "Tally")).toBe("na");
  });

  it("blocks input credit without a supplier GSTIN", () => {
    expect(state(billTrace({ ...base, supplierGstin: null }).steps, "GST input credit")).toBe("bad");
  });
});

describe("poTrace", () => {
  it("asks for the bill once goods arrive", () => {
    const t = poTrace({ id: "po1", no: "PO-1", status: "received", date: "2026-09-01", supplier: "Acme", total: 1000, decidedBy: null, ordered: 5, received: 5, receivedValue: 1000, bills: [], changedAt: null });
    expect(state(t.steps, "Goods receipt")).toBe("ok");
    expect(state(t.steps, "Supplier bill")).toBe("warn");
  });
});

describe("GSTR-2B reconciliation", () => {
  const bill = (id: string, supplierBillNo: string | null, tax: number, over: Partial<BookBill> = {}): BookBill => ({
    id,
    no: `BILL-${id}`,
    supplierBillNo,
    gstin: "29ABCDE1234F1Z5",
    supplier: "Acme",
    date: "2026-09-10",
    taxable: tax / 0.18,
    tax,
    total: round(tax / 0.18 + tax),
    inRange: true,
    ...over,
  });
  const round = (n: number) => Math.round(n * 100) / 100;
  const row = (invoiceNo: string, tax: number, over: Partial<Parameters<typeof reconcileGstr2b>[1][number]> = {}) => ({ gstin: "29ABCDE1234F1Z5", supplier: "Acme", invoiceNo, date: "2026-09-10", value: 0, taxable: tax / 0.18, igst: 0, cgst: tax / 2, sgst: tax / 2, ...over });

  it("normalises invoice numbers", () => {
    expect(normInvoiceNo("INV/0012")).toBe(normInvoiceNo("inv-12"));
    expect(normInvoiceNo("100")).toBe("100");
  });

  it("classifies matched, mismatched, missing from 2B and missing from books", () => {
    const r = reconcileGstr2b([bill("1", "S/001", 180), bill("2", "S-2", 360), bill("3", "S-3", 90)], [row("s-1", 180), row("S2", 300), row("S-9", 50)]);
    expect(r.summary.counts).toEqual({ matched: 1, mismatch: 1, missing_2b: 1, missing_books: 1 });
    expect(r.rows[0].status).toBe("mismatch");
    expect(r.summary.itcAtRisk).toBe(150);
    expect(r.summary.itcNotBooked).toBe(50);
  });

  it("falls back to GSTIN + amount + date when the invoice number differs", () => {
    const r = reconcileGstr2b([bill("1", null, 180)], [row("ZZ-1", 180, { value: 1180 })]);
    expect(r.rows[0].status).toBe("matched");
    expect(r.rows[0].note).toMatch(/matched by amount/i);
  });

  it("ignores bills outside the period unless 2B lists them", () => {
    const r = reconcileGstr2b([bill("1", "S-1", 180, { inRange: false }), bill("2", "S-2", 90, { inRange: false })], [row("S-1", 180)]);
    expect(r.summary.counts.matched).toBe(1);
    expect(r.summary.counts.missing_2b).toBe(0);
  });
});
