import { describe, expect, it } from "vitest";
import {
  buildQuotationEmailBodies,
  emailAccentPalette,
  escapeHtml,
  normalizeQuotationEmailTemplateId,
  renderCorporateQuotationEmailHtml,
  safeEmailLogoUrl,
  summarizeQuoteLineItems,
} from "../quotation-email-templates";

describe("quotation email templates", () => {
  it("normalizes template ids", () => {
    expect(normalizeQuotationEmailTemplateId("plain")).toBe("plain");
    expect(normalizeQuotationEmailTemplateId("CORPORATE")).toBe("corporate");
    expect(normalizeQuotationEmailTemplateId(null)).toBe("corporate");
  });

  it("builds accent soft/muted from document accent and darkens pale accents", () => {
    const p = emailAccentPalette("#123456");
    expect(p.accent).toBe("#123456");
    expect(p.soft).toMatch(/^#[0-9a-f]{6}$/);
    expect(p.muted).toMatch(/^#[0-9a-f]{6}$/);
    const pale = emailAccentPalette("#f5f5f5");
    expect(pale.accent).not.toBe("#f5f5f5");
    // Pale brand colors are darkened so header text can stay white.
    expect(pale.onAccent).toBe("#ffffff");
  });

  it("rejects data-url logos for email", () => {
    expect(safeEmailLogoUrl("data:image/png;base64,aaa")).toBe("");
    expect(safeEmailLogoUrl("https://cdn.example/logo.png")).toBe("https://cdn.example/logo.png");
  });

  it("summarizes line items with overflow count", () => {
    const items = Array.from({ length: 7 }, (_, i) => ({
      desc: `Item ${i + 1}`,
      qty: 1,
      rate: 100,
    }));
    const { lineItems, moreItemsCount } = summarizeQuoteLineItems(items, 5);
    expect(lineItems).toHaveLength(5);
    expect(moreItemsCount).toBe(2);
  });

  it("escapes html and renders intro/closing/gstin/line items", () => {
    expect(escapeHtml(`A <b> & "x"`)).toBe("A &lt;b&gt; &amp; &quot;x&quot;");
    const html = renderCorporateQuotationEmailHtml({
      customerName: `<script>alert(1)</script>`,
      quoteNo: "Q-1",
      typeLabel: "Solar",
      date: "08 Sep 2026",
      validTill: "22 Sep 2026",
      grandTotal: "1,000.00",
      grandTotalWords: "One Thousand Only",
      companyName: "JustX & Co",
      companyPhone: "999",
      companyEmail: "a@b.com",
      companyGstin: "29ABCDE1234F1Z5",
      companyAddress: "1 Main St",
      accentColor: "#0f3d3e",
      quoteLink: "https://example.com/q/abc",
      intro: "Custom intro for {{companyName}}".replace("{{companyName}}", "JustX & Co"),
      closing: "Custom closing.",
      lineItems: [{ desc: "Panel <x>", qty: "2", amount: "100.00" }],
      moreItemsCount: 3,
    });
    expect(html).toContain("#0f3d3e");
    expect(html).toContain("JustX &amp; Co");
    expect(html).not.toContain("<script>");
    expect(html).toContain("View Full Quotation");
    expect(html).toContain("GSTIN: 29ABCDE1234F1Z5");
    expect(html).toContain("Panel &lt;x&gt;");
    expect(html).toContain("…and 3 more");
    expect(html).toContain("Custom intro");
    expect(html).toContain("Custom closing.");
  });

  it("returns html only for corporate template", () => {
    const vars = {
      customerName: "Acme",
      quoteNo: "Q-2",
      typeLabel: "EPC",
      date: "1 Jan 2026",
      validTill: "15 Jan 2026",
      grandTotal: "10.00",
      grandTotalWords: "Ten Only",
      companyName: "Co",
      companyPhone: "1",
      accentColor: "#224466",
    };
    const corporate = buildQuotationEmailBodies({ templateId: "corporate", vars });
    expect(corporate.html).toBeTruthy();
    expect(corporate.text).toContain("Acme");
    const plain = buildQuotationEmailBodies({
      templateId: "plain",
      vars,
      customPlainMessage: "Custom body",
    });
    expect(plain.html).toBeUndefined();
    expect(plain.text).toBe("Custom body");
  });
});
