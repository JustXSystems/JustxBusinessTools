import { describe, expect, it } from "vitest";
import { classifyQuoteAlert, quoteAlertMatchesFilter } from "../alerts";

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
