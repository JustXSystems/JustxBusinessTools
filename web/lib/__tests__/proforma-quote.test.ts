import { describe, expect, it } from "vitest";
import { buildProformaQuoteHtml } from "../proforma-quote";

describe("proforma-quote", () => {
  it("renders GST 18% inclusive breakup and SAC 998314 for Business/Enterprise GSTIN accounts", () => {
    const html = buildProformaQuoteHtml({
      quoteNumber: "PFQ-2026-001",
      issuedAt: new Date("2026-11-26T00:00:00.000Z"),
      sellerAppName: "JustX",
      sellerLegalName: "JustX Systems Pvt Ltd",
      customerName: "Acme Steel Pvt Ltd",
      customerGstin: "27ABCDE1234F1Z5",
      userCategory: "enterprise",
      branchCount: 3,
      billingCycle: "year",
      quote: {
        lines: [
          {
            toolId: "invoice",
            name: "Invoice & Billing",
            category: "Finance",
            priceInr: 1180,
            billingInterval: "year",
          },
        ],
        subtotalInr: 1480,
        totalInr: 1180,
        packName: "Finance Suite",
        savingsInr: 200,
        annualSavingsInr: 300,
        durationDays: 365,
        periodEndPreview: "2027-11-26T00:00:00.000Z",
        promo: { code: "ANNUAL20", description: null, discountInr: 300, label: "20% off" },
        upi: { enabled: true, vpa: "justx@icici", payeeName: "JustX Systems", amountInr: 1180, intent: null },
      },
    });

    expect(html).toContain("Proforma Tax Quotation");
    expect(html).toContain("27ABCDE1234F1Z5");
    expect(html).toContain("998314");
    expect(html).toContain("1,000.00"); // 1180 / 1.18
    expect(html).toContain("180.00"); // 18% GST inclusive
    expect(html).toContain("Promo ANNUAL20");
    expect(html).toContain("justx@icici");
    expect(html).toContain("3 branches");
  });

  it("renders clean Personal estimate without GSTIN or SAC for individual accounts and escapes HTML", () => {
    const html = buildProformaQuoteHtml({
      issuedAt: new Date("2026-11-26T00:00:00.000Z"),
      sellerAppName: "JustX",
      sellerLegalName: "JustX Systems",
      customerName: "Riya <Solo>",
      customerGstin: null,
      userCategory: "individual",
      billingCycle: "month",
      quote: {
        lines: [
          {
            toolId: "todo",
            name: "Task & Notes",
            category: "Productivity",
            priceInr: 199,
            billingInterval: "month",
          },
        ],
        totalInr: 199,
        durationDays: 30,
      },
    });

    expect(html).toContain("Subscription Estimate");
    expect(html).toContain("Personal / Individual Account");
    expect(html).not.toContain("998314");
    expect(html).toContain("Riya &lt;Solo&gt;");
  });

  it("respects custom admin CommercePolicy GST exclusive rate, SAC code, seller GSTIN, and footer note", () => {
    const html = buildProformaQuoteHtml({
      issuedAt: new Date("2026-11-26T00:00:00.000Z"),
      sellerAppName: "JustX",
      sellerLegalName: "JustX Systems",
      customerName: "Delta Works",
      customerGstin: "29ABCDE1234F1Z2",
      userCategory: "business",
      billingCycle: "month",
      policy: {
        gstEnabled: true,
        gstRatePct: 12,
        gstPricingMode: "exclusive",
        sacCode: "998315",
        sellerGstin: "27SELLR9999K1Z1",
        proformaValidityDays: 15,
        proformaFooterNote: "NEFT / UPI accepted within 15 days.",
      },
      quote: {
        lines: [
          {
            toolId: "invoice",
            name: "Invoice",
            category: "Finance",
            priceInr: 1000,
            billingInterval: "month",
          },
        ],
        totalInr: 1000,
      },
    });

    expect(html).toContain("27SELLR9999K1Z1");
    expect(html).toContain("998315");
    expect(html).toContain("GST @ 12% (Exclusive)");
    expect(html).toContain("120.00");
    expect(html).toContain("₹1,120");
    expect(html).toContain("NEFT / UPI accepted within 15 days.");
  });
});
