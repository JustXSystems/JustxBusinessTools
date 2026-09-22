import { describe, expect, it } from "vitest";
import { buildQuoteActivityTimeline, filterQuoteActivity } from "../history-activity";
import type { QuoteHistoryRow, QuotationV1 } from "../types";

describe("buildQuoteActivityTimeline", () => {
  const history: QuoteHistoryRow[] = [
    {
      id: "2",
      quotationId: "q1",
      quoteNo: "QT-1",
      customerName: "Acme",
      typeLabel: "solar · epc",
      status: "sent",
      grand: 120000,
      savedAt: "2026-03-15T10:00:00.000Z",
      action: "status:sent",
    },
    {
      id: "1",
      quotationId: "q1",
      quoteNo: "QT-1",
      customerName: "Acme",
      typeLabel: "solar · epc",
      status: "draft",
      grand: 100000,
      savedAt: "2026-03-14T10:00:00.000Z",
      action: "create",
    },
  ];

  it("labels actions and amount deltas", () => {
    const rows = buildQuoteActivityTimeline(history, [{ id: "q1" } as QuotationV1]);
    expect(rows[0].actionLabel).toBe("Marked sent");
    expect(rows[0].amountDelta).toBe(20000);
    expect(rows[0].quoteExists).toBe(true);
    expect(rows[0].isLatestForQuote).toBe(true);
    expect(rows[1].actionLabel).toBe("Created");
  });

  it("filters by search query", () => {
    const rows = buildQuoteActivityTimeline(history, []);
    expect(filterQuoteActivity(rows, "acme")).toHaveLength(2);
    expect(filterQuoteActivity(rows, "nope")).toHaveLength(0);
  });
});
