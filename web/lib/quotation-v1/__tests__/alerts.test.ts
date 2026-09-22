import { describe, expect, it } from "vitest";
import {
  classifyQuoteAlert,
  countQuoteAlerts,
  quoteAlertFilterStats,
  quoteAlertMatchesFilter,
} from "../alerts";

describe("classifyQuoteAlert", () => {
  it("detects send, approval, reject, and link kinds", () => {
    expect(classifyQuoteAlert("Quotation QT-1 emailed to a@b.com.").kind).toBe("sent");
    expect(classifyQuoteAlert("Quotation QT-1 approved by customer.").kind).toBe("approval");
    expect(classifyQuoteAlert("Quotation QT-1 rejected.").kind).toBe("rejected");
    expect(classifyQuoteAlert("Approval link generated for QT-1.").kind).toBe("link");
    expect(classifyQuoteAlert("Quotation QT-1 submitted — delivered.").kind).toBe("submit");
  });
});

describe("quoteAlertMatchesFilter", () => {
  it("filters unread and actionable", () => {
    expect(
      quoteAlertMatchesFilter("unread", { read: false, kind: "sent", actionable: true }),
    ).toBe(true);
    expect(
      quoteAlertMatchesFilter("action", { read: true, kind: "sent", actionable: true }),
    ).toBe(false);
    expect(
      quoteAlertMatchesFilter("sent", { read: true, kind: "sent", actionable: true }),
    ).toBe(true);
  });
});

describe("quoteAlertFilterStats", () => {
  it("counts each filter bucket exactly", () => {
    const list = [
      { message: "Quotation QT emailed to a@b.com.", read: false },
      { message: "Quotation QT submitted — ok", read: false },
      { message: "Quotation QT approved.", read: true },
      { message: "Approval link generated for QT.", read: false },
      { message: "Quotation QT rejected.", read: false },
    ];
    const stats = quoteAlertFilterStats(list);
    expect(stats.all).toBe(5);
    expect(stats.unread).toBe(4);
    expect(stats.sent).toBe(1);
    expect(stats.submit).toBe(1);
    expect(stats.approval).toBe(1);
    expect(stats.link).toBe(1);
    expect(stats.rejected).toBe(1);
    expect(countQuoteAlerts(list, "sent")).toBe(stats.sent);
    expect(countQuoteAlerts(list, "approval")).toBe(stats.approval);
  });
});
