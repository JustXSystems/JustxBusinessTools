import { describe, expect, it } from "vitest";
import {
  addDaysISO,
  agingBucket,
  apPriority,
  arPriority,
  billDisplayStatus,
  canMovePo,
  computeTotals,
  daysBetween,
  DEFAULT_PERMISSIONS,
  exciseApplies,
  expectedCash,
  fiscalYearLabel,
  formatDocNo,
  haversineKm,
  hsnSummary,
  invoiceBalance,
  invoiceDisplayStatus,
  isISODate,
  isIntraState,
  movementEffect,
  normalizePermissions,
  normalizeReminders,
  normalizeTaxonomy,
  periodRange,
  permissionsFor,
  poNeedsApproval,
  poReceiptStatus,
  reminderRuleFor,
  renderTemplate,
  reorderQty,
  stockStatus,
  travelKm,
} from "./logic.js";

describe("dates", () => {
  it("validates real calendar dates", () => {
    expect(isISODate("2026-02-28")).toBe(true);
    expect(isISODate("2026-02-30")).toBe(false);
    expect(isISODate("26-02-01")).toBe(false);
  });

  it("adds days and measures gaps across months", () => {
    expect(addDaysISO("2026-01-31", 1)).toBe("2026-02-01");
    expect(daysBetween("2026-03-01", "2026-02-27")).toBe(-2);
  });

  it("labels fiscal years from April", () => {
    expect(fiscalYearLabel("2026-03-31")).toBe("25-26");
    expect(fiscalYearLabel("2026-04-01")).toBe("26-27");
    expect(fiscalYearLabel("2026-06-01", 1)).toBe("2026");
  });

  it("formats document numbers", () => {
    expect(formatDocNo("po", "26-27", 7)).toBe("PO/26-27/0007");
    expect(formatDocNo("", "26-27", 12)).toBe("DOC/26-27/0012");
  });

  it("resolves period presets", () => {
    expect(periodRange("today", "2026-10-12")).toEqual({ from: "2026-10-12", to: "2026-10-12" });
    expect(periodRange("7d", "2026-10-12")).toEqual({ from: "2026-10-06", to: "2026-10-12" });
    expect(periodRange("mtd", "2026-10-12")).toEqual({ from: "2026-10-01", to: "2026-10-12" });
    expect(periodRange("lastmonth", "2026-10-12")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(periodRange("qtd", "2026-11-05")).toEqual({ from: "2026-10-01", to: "2026-11-05" });
    expect(periodRange("fytd", "2026-02-10")).toEqual({ from: "2025-04-01", to: "2026-02-10" });
    expect(periodRange("custom", "2026-10-12", 4, { from: "2026-10-05", to: "2026-10-01" })).toEqual({ from: "2026-09-13", to: "2026-10-12" });
  });
});

describe("GST totals", () => {
  const lines = [
    { name: "LED panel", qty: 10, rate: 450, gstRate: 18 },
    { name: "Cable", qty: 2.5, rate: 120, discountPct: 10, gstRate: 18 },
    { name: "Installation", qty: 1, rate: 1000, gstRate: 0 },
  ];

  it("splits intra-state tax into CGST + SGST", () => {
    const t = computeTotals(lines, true);
    expect(t.subtotal).toBe(5800);
    expect(t.discountTotal).toBe(30);
    expect(t.taxable).toBe(5770);
    expect(t.taxTotal).toBe(858.6);
    expect(t.cgst + t.sgst).toBe(858.6);
    expect(t.igst).toBe(0);
    expect(t.grandTotal).toBe(6628.6);
  });

  it("charges IGST inter-state and rounds to the rupee when asked", () => {
    const t = computeTotals(lines, false, true);
    expect(t.igst).toBe(858.6);
    expect(t.cgst).toBe(0);
    expect(t.grandTotal).toBe(6629);
    expect(t.roundOff).toBe(0.4);
  });

  it("clamps bad input", () => {
    const t = computeTotals([{ name: "", qty: -3, rate: 10, discountPct: 150, gstRate: 500 }], true);
    expect(t.lines[0]).toMatchObject({ name: "Item", qty: 0, discountPct: 100, gstRate: 100, amount: 0 });
  });

  it("compares states case-insensitively and treats unknown as intra-state", () => {
    expect(isIntraState("Karnataka", "karnataka ")).toBe(true);
    expect(isIntraState("Karnataka", "Kerala")).toBe(false);
    expect(isIntraState(null, "Kerala")).toBe(true);
  });

  it("rolls up HSN by code and rate", () => {
    const t = computeTotals(
      [
        { name: "A", hsn: "9405", qty: 2, rate: 100, gstRate: 18 },
        { name: "B", hsn: "9405", qty: 1, rate: 50, gstRate: 18 },
        { name: "C", hsn: "8544", qty: 1, rate: 10, gstRate: 12 },
      ],
      true,
    );
    expect(hsnSummary(t.lines)).toEqual([
      { hsn: "8544", unit: "", gstRate: 12, qty: 1, taxable: 10, tax: 1.2 },
      { hsn: "9405", unit: "", gstRate: 18, qty: 3, taxable: 250, tax: 45 },
    ]);
  });
});

describe("stock rules", () => {
  it("derives stock status", () => {
    expect(stockStatus(0, 5)).toBe("OUT_OF_STOCK");
    expect(stockStatus(5, 5)).toBe("LOW");
    expect(stockStatus(50, 5, 40)).toBe("OVERSTOCK");
    expect(stockStatus(20, 5, 40)).toBe("GOOD");
  });

  it("suggests reorder quantities", () => {
    expect(reorderQty({ current: 2, min: 5, max: 20 })).toBe(18);
    expect(reorderQty({ current: 2, min: 5 })).toBe(8);
    expect(reorderQty({ current: 2, min: 5, reorderQty: 24 })).toBe(24);
  });

  it("moves units between saleable and quarantine buckets", () => {
    expect(movementEffect("IN", 4)).toEqual({ saleable: 4, damaged: 0 });
    expect(movementEffect("OUT", 4)).toEqual({ saleable: -4, damaged: 0 });
    expect(movementEffect("DAMAGE", 2)).toEqual({ saleable: -2, damaged: 2 });
    expect(movementEffect("WRITE_OFF", 2)).toEqual({ saleable: 0, damaged: -2 });
    expect(movementEffect("RETURN_IN", 1, { damaged: true })).toEqual({ saleable: 0, damaged: 1 });
    expect(movementEffect("RETURN_OUT", 1, { damaged: true })).toEqual({ saleable: 0, damaged: -1 });
    expect(movementEffect("ADJUSTMENT", -3)).toEqual({ saleable: -3, damaged: 0 });
  });
});

describe("receivables & payables", () => {
  it("buckets aging and prioritises collections", () => {
    expect(agingBucket(0)).toBe("0-15");
    expect(agingBucket(16)).toBe("16-30");
    expect(agingBucket(61)).toBe("61-90");
    expect(agingBucket(400)).toBe("90+");
    expect(arPriority(95)).toBe("CRITICAL");
    expect(arPriority(61)).toBe("HIGH");
    expect(arPriority(31)).toBe("MEDIUM");
    expect(arPriority(3)).toBe("LOW");
  });

  it("derives invoice display status", () => {
    const base = { status: "issued", grandTotal: 1000, amountPaid: 0, dueDate: "2026-10-01" };
    expect(invoiceDisplayStatus({ ...base, status: "draft" }, "2026-10-12")).toBe("draft");
    expect(invoiceDisplayStatus(base, "2026-10-12")).toBe("overdue");
    expect(invoiceDisplayStatus({ ...base, dueDate: "2026-10-20", amountPaid: 200 }, "2026-10-12")).toBe("partial");
    expect(invoiceDisplayStatus({ ...base, amountPaid: 1000 }, "2026-10-12")).toBe("paid");
    expect(invoiceBalance({ status: "cancelled", grandTotal: 1000, amountPaid: 0 })).toBe(0);
  });

  it("derives bill status and urgency", () => {
    const bill = { status: "approved", grandTotal: 500, amountPaid: 0, dueDate: "2026-10-10" };
    expect(billDisplayStatus(bill, "2026-10-12")).toBe("overdue");
    expect(billDisplayStatus({ ...bill, status: "on_hold" }, "2026-10-12")).toBe("on_hold");
    expect(billDisplayStatus({ ...bill, amountPaid: 500 }, "2026-10-12")).toBe("paid");
    expect(apPriority("2026-10-12", "2026-10-12")).toBe("DUE_TODAY");
    expect(apPriority("2026-10-15", "2026-10-12")).toBe("DUE_SOON");
    expect(apPriority("2026-10-01", "2026-10-12")).toBe("OVERDUE");
    expect(apPriority(null, "2026-10-12")).toBe("UPCOMING");
  });

  it("matches reminder rules and renders templates", () => {
    expect(reminderRuleFor("2026-10-15", "2026-10-12")).toBe("3b");
    expect(reminderRuleFor("2026-10-12", "2026-10-12")).toBe("due");
    expect(reminderRuleFor("2026-09-12", "2026-10-12")).toBe("30d");
    expect(reminderRuleFor("2026-10-01", "2026-10-12")).toBeNull();
    expect(renderTemplate("Hi {customer}, {invoice} {unknown}", { customer: "Asha", invoice: "INV/1" })).toBe("Hi Asha, INV/1 {unknown}");
  });

  it("computes expected cash for the day", () => {
    expect(expectedCash({ openingCash: 1000, cashSales: 5000, cashCollections: 2000, cashPaid: 1500, cashExpenses: 250.5 })).toBe(6249.5);
  });
});

describe("purchase orders", () => {
  it("allows only valid status moves", () => {
    expect(canMovePo("draft", "pending_approval")).toBe(true);
    expect(canMovePo("received", "cancelled")).toBe(false);
    expect(canMovePo("approved", "partially_received")).toBe(true);
  });

  it("needs approval at or above the limit", () => {
    expect(poNeedsApproval(50000, 50000)).toBe(true);
    expect(poNeedsApproval(49999, 50000)).toBe(false);
    expect(poNeedsApproval(1e7, 0)).toBe(false);
  });

  it("derives receipt status", () => {
    expect(poReceiptStatus([{ qty: 5, receivedQty: 5 }, { qty: 2, receivedQty: 2 }])).toBe("received");
    expect(poReceiptStatus([{ qty: 5, receivedQty: 3 }])).toBe("partially_received");
  });
});

describe("roles & settings", () => {
  it("gives owners everything and others their matrix row", () => {
    expect(permissionsFor("owner", DEFAULT_PERMISSIONS)).toContain("settings");
    expect(permissionsFor("field", DEFAULT_PERMISSIONS)).toEqual(["field"]);
    expect(permissionsFor("manager", DEFAULT_PERMISSIONS)).not.toContain("settings");
  });

  it("normalizes stored permission matrices", () => {
    const m = normalizePermissions({ staff: { sales: false, bogus: true }, nobody: { sales: true } });
    expect(m.staff.sales).toBe(false);
    expect(m.staff.stockIn).toBe(true);
    expect(Object.keys(m)).not.toContain("nobody");
  });

  it("normalizes taxonomy and reminders", () => {
    const t = normalizeTaxonomy({ categories: ["Fans", { name: "Lights", hsn: 9405, gstRate: 250 }], units: ["pcs", "pcs", " box "] });
    expect(t.categories).toEqual([
      { name: "Fans", hsn: null, gstRate: null },
      { name: "Lights", hsn: "9405", gstRate: 100 },
    ]);
    expect(t.units).toEqual(["pcs", "box"]);
    expect(t.damageReasons.length).toBeGreaterThan(0);
    const r = normalizeReminders({ autoEnabled: 1, channels: ["fax"], templates: [] });
    expect(r.autoEnabled).toBe(true);
    expect(r.channels).toEqual(["whatsapp"]);
    expect(r.templates.length).toBeGreaterThan(0);
  });

  it("turns excise on for liquor businesses", () => {
    expect(exciseApplies("bar_pub", false)).toBe(true);
    expect(exciseApplies("distributor", false)).toBe(false);
    expect(exciseApplies("distributor", true)).toBe(true);
  });
});

describe("field distance", () => {
  it("measures great-circle distance and skips missing fixes", () => {
    const blr = { lat: 12.9716, lng: 77.5946 };
    const mys = { lat: 12.2958, lng: 76.6394 };
    expect(haversineKm(blr, mys)).toBeGreaterThan(125);
    expect(haversineKm(blr, mys)).toBeLessThan(130);
    expect(travelKm([blr, { lat: null, lng: null }, mys])).toBe(haversineKm(blr, mys));
  });
});
