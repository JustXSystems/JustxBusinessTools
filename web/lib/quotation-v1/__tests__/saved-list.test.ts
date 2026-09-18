import { describe, expect, it } from "vitest";
import {
  buildSavedQuoteListRow,
  customerCityDisplay,
  customerCompanyDisplay,
  lineItemsSummary,
  newQuotationDraft,
  quotationSubmittedDateIso,
  DEFAULT_COMPANY,
} from "@/lib/quotation-v1";

describe("quotation-v1 saved list helpers", () => {
  it("falls back city to state when city is blank", () => {
    const q = newQuotationDraft("solar", "epc");
    q.customer.city = "";
    q.customer.state = "Karnataka";
    expect(customerCityDisplay(q)).toBe("Karnataka");
    q.customer.city = "Bengaluru";
    expect(customerCityDisplay(q)).toBe("Bengaluru");
  });

  it("prefers company name over customer name", () => {
    const q = newQuotationDraft("solar", "epc");
    q.customer.name = "Site Owner";
    q.customer.company = "";
    expect(customerCompanyDisplay(q)).toBe("Site Owner");
    q.customer.company = "Acme Power";
    expect(customerCompanyDisplay(q)).toBe("Acme Power");
  });

  it("summarizes line items with overflow count", () => {
    const q = newQuotationDraft("solar", "epc");
    q.items = [
      { id: "1", desc: "Panels", qty: 1, rate: 1, gst: 0 },
      { id: "2", desc: "Inverter", qty: 1, rate: 1, gst: 0 },
      { id: "3", desc: "Cables", qty: 1, rate: 1, gst: 0 },
    ];
    expect(lineItemsSummary(q, 2)).toBe("Panels · Inverter · +1 more");
  });

  it("reads submitted date from history or status", () => {
    const q = newQuotationDraft("solar", "epc");
    q.date = "2026-03-01";
    expect(quotationSubmittedDateIso(q)).toBe("");
    q.status = "submitted";
    expect(quotationSubmittedDateIso(q)).toBe("2026-03-01");
    q.history = [{ ts: "2026-03-10T12:00:00.000Z", event: "Submitted" }];
    expect(quotationSubmittedDateIso(q)).toBe("2026-03-10");
  });

  it("maps basic/grand/value columns", () => {
    const q = newQuotationDraft("solar", "epc");
    q.customer.company = "Zigma";
    q.customer.city = "Mysuru";
    q.items = [{ id: "1", desc: "Module", qty: 2, rate: 1000, gst: 18, discount: 0 }];
    q.extraCharge = { label: "x", amount: 0, gst: 0 };
    q.gstOverride = { mode: "auto", cgst: null, sgst: null, igst: null };
    q.status = "submitted";
    q.followUpDate = "2026-04-01";
    const company = { ...DEFAULT_COMPANY, state: "Karnataka" };
    const row = buildSavedQuoteListRow(q, company);
    expect(row.companyName).toBe("Zigma");
    expect(row.companyCity).toBe("Mysuru");
    expect(row.basicTotal).toBe(2000);
    expect(row.grandTotal).toBe(row.totalQuotationValue);
    expect(row.followUpDateRaw).toBe("2026-04-01");
  });
});
