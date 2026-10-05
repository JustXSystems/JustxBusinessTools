import { describe, expect, it } from "vitest";
import {
  challanBlock,
  deleteBlock,
  deliveredPct,
  editBlock,
  invoiceBlock,
  lineKey,
  orderBlock,
  posSummary,
  remainingLines,
  salesStage,
  salesTotals,
  type TotalsDoc,
} from "./sales-logic.js";

const line = (description: string, quantity: number, extra: Partial<{ hsn: string; unit: string }> = {}) => ({ description, quantity, rate: 100, taxRate: 18, ...extra });
const TODAY = "2026-10-05";

describe("line matching & fulfilment", () => {
  it("matches lines by description, HSN and unit, ignoring case and spacing", () => {
    expect(lineKey({ description: " Solar Panel ", hsn: "8541", unit: "Nos" })).toBe(lineKey({ description: "solar panel", hsn: "8541", unit: "nos" }));
    expect(lineKey({ description: "Solar Panel", hsn: "8541" })).not.toBe(lineKey({ description: "Solar Panel", hsn: "8542" }));
  });

  it("subtracts every challan that isn't cancelled from the order", () => {
    const order = [line("Panel", 10), line("Inverter", 1)];
    const left = remainingLines(order, [
      { status: "delivered", lines: [line("Panel", 4)] },
      { status: "dispatched", lines: [line("Panel", 3), line("Inverter", 1)] },
      { status: "cancelled", lines: [line("Panel", 3)] },
    ]);
    expect(left.map((l) => l.quantity)).toEqual([3, 0]);
  });

  it("splits shipped quantity across repeated order lines and never goes negative", () => {
    const left = remainingLines([line("Cable", 5), line("Cable", 5)], [{ status: "delivered", lines: [line("Cable", 7)] }, { status: "delivered", lines: [line("Cable", 9)] }]);
    expect(left.map((l) => l.quantity)).toEqual([0, 0]);
  });

  it("counts only delivered challans towards the delivered share", () => {
    const order = [line("Panel", 10)];
    expect(deliveredPct(order, [{ status: "delivered", lines: [line("Panel", 4)] }, { status: "dispatched", lines: [line("Panel", 6)] }])).toBe(40);
    expect(deliveredPct([], [])).toBe(100);
  });
});

describe("salesStage", () => {
  it("walks a quotation from draft to converted, expiring unanswered quotes", () => {
    const q = { kind: "quotation" as const, invoiced: false, validUntil: "2026-10-10" };
    expect(salesStage({ ...q, status: "draft" }, TODAY)).toBe("draft");
    expect(salesStage({ ...q, status: "sent" }, TODAY)).toBe("sent");
    expect(salesStage({ ...q, status: "sent" }, "2026-10-11")).toBe("expired");
    expect(salesStage({ ...q, status: "accepted" }, "2026-10-11")).toBe("accepted");
    expect(salesStage({ ...q, status: "accepted", hasOrder: true }, TODAY)).toBe("converted");
    expect(salesStage({ ...q, status: "sent", invoiced: true }, TODAY)).toBe("converted");
  });

  it("derives an order's stage from its challans and invoice", () => {
    const o = { kind: "order" as const, status: "confirmed", invoiced: false, lines: [line("Panel", 10)] };
    expect(salesStage({ ...o, challans: [] }, TODAY)).toBe("confirmed");
    expect(salesStage({ ...o, challans: [{ status: "draft", lines: [line("Panel", 10)] }] }, TODAY)).toBe("confirmed");
    expect(salesStage({ ...o, challans: [{ status: "dispatched", lines: [line("Panel", 10)] }] }, TODAY)).toBe("in_transit");
    expect(salesStage({ ...o, challans: [{ status: "delivered", lines: [line("Panel", 6)] }] }, TODAY)).toBe("part_delivered");
    expect(salesStage({ ...o, challans: [{ status: "delivered", lines: [line("Panel", 10)] }] }, TODAY)).toBe("delivered");
    expect(salesStage({ ...o, invoiced: true, challans: [] }, TODAY)).toBe("invoiced");
    expect(salesStage({ ...o, status: "cancelled", invoiced: true }, TODAY)).toBe("cancelled");
  });

  it("maps challan statuses, with invoicing on top", () => {
    const c = { kind: "challan" as const, invoiced: false };
    expect(salesStage({ ...c, status: "draft" }, TODAY)).toBe("draft");
    expect(salesStage({ ...c, status: "dispatched" }, TODAY)).toBe("in_transit");
    expect(salesStage({ ...c, status: "delivered" }, TODAY)).toBe("delivered");
    expect(salesStage({ ...c, status: "delivered", invoiced: true }, TODAY)).toBe("invoiced");
  });
});

describe("conversion rules", () => {
  it("never invoices a document twice, or both an order and its challans", () => {
    expect(invoiceBlock({ kind: "order", status: "confirmed", invoiceNo: "INV/26-27/0004" })).toMatch(/INV\/26-27\/0004/);
    expect(invoiceBlock({ kind: "order", status: "confirmed", linkedInvoiced: true })).toMatch(/one by one/);
    expect(invoiceBlock({ kind: "challan", status: "delivered", linkedInvoiced: true })).toMatch(/order is already invoiced/);
    expect(invoiceBlock({ kind: "order", status: "confirmed" })).toBeNull();
  });

  it("keeps declined, cancelled, superseded and undispatched documents out of invoicing", () => {
    expect(invoiceBlock({ kind: "quotation", status: "declined" })).toMatch(/declined/);
    expect(invoiceBlock({ kind: "quotation", status: "accepted", hasOrder: true })).toMatch(/sales order/);
    expect(invoiceBlock({ kind: "order", status: "cancelled" })).toMatch(/Cancelled/);
    expect(invoiceBlock({ kind: "challan", status: "draft" })).toMatch(/Dispatch/);
    expect(invoiceBlock({ kind: "quotation", status: "sent" })).toBeNull();
    expect(invoiceBlock({ kind: "challan", status: "dispatched" })).toBeNull();
  });

  it("turns a quotation into one order at most", () => {
    expect(orderBlock({ status: "sent", invoiced: false, hasOrder: false })).toBeNull();
    expect(orderBlock({ status: "declined", invoiced: false, hasOrder: false })).toMatch(/declined/);
    expect(orderBlock({ status: "accepted", invoiced: false, hasOrder: true })).toMatch(/already/);
    expect(orderBlock({ status: "accepted", invoiced: true, hasOrder: false })).toMatch(/invoiced/);
  });

  it("ships challans only while something is left on a live order", () => {
    expect(challanBlock({ status: "confirmed" }, [line("Panel", 2)])).toBeNull();
    expect(challanBlock({ status: "confirmed" }, [line("Panel", 0)])).toMatch(/already on a challan/);
    expect(challanBlock({ status: "cancelled" }, [line("Panel", 2)])).toMatch(/cancelled/);
  });

  it("locks documents once they move on", () => {
    expect(editBlock({ kind: "quotation", status: "sent", invoiced: false, hasChildren: false })).toBeNull();
    expect(editBlock({ kind: "quotation", status: "accepted", invoiced: false, hasChildren: false })).toMatch(/Decided/);
    expect(editBlock({ kind: "order", status: "confirmed", invoiced: false, hasChildren: true })).toMatch(/challans/);
    expect(editBlock({ kind: "challan", status: "dispatched", invoiced: false, hasChildren: false })).toMatch(/Dispatched/);
    expect(editBlock({ kind: "order", status: "confirmed", invoiced: true, hasChildren: false })).toMatch(/Invoiced/);
  });

  it("only deletes documents nothing else points at", () => {
    expect(deleteBlock({ kind: "quotation", status: "draft", invoiceNo: null, children: 0 })).toBeNull();
    expect(deleteBlock({ kind: "quotation", status: "accepted", invoiceNo: null, children: 1 })).toMatch(/sales order/);
    expect(deleteBlock({ kind: "order", status: "confirmed", invoiceNo: null, children: 1 })).toMatch(/cancel instead/);
    expect(deleteBlock({ kind: "order", status: "confirmed", invoiceNo: "INV/26-27/0004", children: 0 })).toMatch(/INV\/26-27\/0004/);
    expect(deleteBlock({ kind: "challan", status: "dispatched", invoiceNo: null, children: 0 })).toMatch(/draft challans/);
    expect(deleteBlock({ kind: "challan", status: "draft", invoiceNo: null, children: 0 })).toBeNull();
  });
});

describe("totals", () => {
  it("summarises the month's orders, the open pipeline, challans and what's ready to invoice", () => {
    const doc = (d: Partial<TotalsDoc>): TotalsDoc => ({ kind: "order", stage: "confirmed", docDate: "2026-10-02", grandTotal: 1000, sourceId: null, canInvoice: true, ...d });
    const t = salesTotals(
      [
        doc({}),
        doc({ stage: "delivered", grandTotal: 2500 }),
        doc({ stage: "cancelled" }),
        doc({ docDate: "2026-09-30" }),
        doc({ kind: "quotation", stage: "sent", grandTotal: 400 }),
        doc({ kind: "quotation", stage: "draft", grandTotal: 600 }),
        doc({ kind: "quotation", stage: "expired" }),
        doc({ kind: "quotation", stage: "accepted", grandTotal: 700 }),
        doc({ kind: "challan", stage: "draft" }),
        doc({ kind: "challan", stage: "in_transit" }),
        doc({ kind: "challan", stage: "delivered", sourceId: "o1" }),
        doc({ kind: "challan", stage: "delivered", grandTotal: 300 }),
      ],
      TODAY,
    );
    expect(t.ordersMonth).toEqual({ count: 2, value: 3500 });
    expect(t.quotesOpen).toEqual({ count: 2, value: 1000 });
    expect(t.challans).toEqual({ month: 4, pendingDispatch: 1, inTransit: 1 });
    expect(t.toInvoice).toEqual({ count: 3, value: 3500 });
  });

  it("adds up POS bills by payment method", () => {
    expect(posSummary([{ grandTotal: 118, method: "cash" }, { grandTotal: 236.5, method: "upi" }, { grandTotal: 50, method: "cash" }, { grandTotal: 10, method: null }])).toEqual({
      count: 4,
      total: 414.5,
      byMethod: { cash: 168, upi: 236.5, card: 0 },
    });
  });
});
