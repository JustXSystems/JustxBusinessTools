import { describe, expect, it } from "vitest";
import { assistantAnswer, assistantContext, auditAsk, type AskableIssue, type AssistantSnapshot } from "./assistant.js";

const item = (name: string, stock: number, min: number, sold30: number, extra: Partial<NonNullable<AssistantSnapshot["items"]>[number]> = {}) => ({
  name,
  brand: null,
  category: "General",
  unit: "pcs",
  stock,
  min,
  max: null,
  reorderQty: null,
  cost: 10,
  supplier: "Acme",
  sold30,
  ...extra,
});

const snap: AssistantSnapshot = {
  business: "Test Traders",
  today: "2026-10-12",
  items: [item("Bolt", 0, 5, 40), item("Nut", 3, 5, 2, { supplier: "Zen" }), item("Washer", 100, 5, 0, { category: "Spares", cost: 50 })],
  moves: [
    { date: "2026-10-10", type: "OUT", item: "Bolt", qty: 10, ref: null, by: "Ravi" },
    { date: "2026-10-01", type: "IN", item: "Nut", qty: 5, ref: null, by: null },
  ],
  receivables: [
    { no: "INV-1", party: "Alpha", total: 1000, paid: 0, balance: 1000, due: "2026-07-01", daysLate: 103, status: "issued" },
    { no: "INV-2", party: "Beta", total: 500, paid: 100, balance: 400, due: "2026-10-20", daysLate: -8, status: "issued" },
  ],
};

describe("assistantAnswer", () => {
  it("lists low stock most urgent first", () => {
    const a = assistantAnswer("Which items should I reorder first?", snap)!;
    expect(a).toContain("2 items are at or below minimum");
    expect(a.indexOf("Bolt")).toBeLessThan(a.indexOf("Nut"));
  });

  it("groups the reorder list by supplier", () => {
    const a = assistantAnswer("Suggest a reorder list grouped by supplier.", snap)!;
    expect(a).toContain("**Acme**");
    expect(a).toContain("**Zen**");
  });

  it("finds stock that is not moving", () => {
    expect(assistantAnswer("Which stock is not moving?", snap)).toContain("Washer");
  });

  it("answers receivables questions only when that data is present", () => {
    expect(assistantAnswer("How much is overdue by more than 60 days?", snap)).toContain("₹1,000");
    expect(assistantAnswer("Who should I chase first?", { ...snap, receivables: undefined })).toBeNull();
  });

  it("summarises the week's movements", () => {
    expect(assistantAnswer("Summarise stock movement this week.", snap)).toContain("1 movements");
  });

  it("returns null for questions it cannot answer", () => {
    expect(assistantAnswer("What is the meaning of life?", snap)).toBeNull();
  });
});

describe("assistantContext", () => {
  it("includes only the parts in the snapshot", () => {
    const c = assistantContext({ ...snap, receivables: undefined });
    expect(c).toContain("INVENTORY: 3 items");
    expect(c).not.toContain("RECEIVABLES");
  });
});

const issue = (key: string, category: AskableIssue["category"], amount: number | null, extra: Partial<AskableIssue> = {}): AskableIssue => ({
  key,
  category,
  severity: "medium",
  title: `${category} issue`,
  detail: "detail",
  entityType: "invoice",
  entityId: key,
  entityLabel: `INV-${key}`,
  amount,
  date: "2026-09-01",
  open: true,
  ...extra,
});

describe("auditAsk", () => {
  const issues = [issue("101", "gst", 1800, { severity: "high" }), issue("102", "duplicates", 5000), issue("103", "documents", 250000), issue("104", "gst", 90, { open: false })];

  it("maps a question to a category and skips closed findings", () => {
    const r = auditAsk("Show GST mismatches", issues, "2026-10-12");
    expect(r.matched).toBe(1);
    expect(r.rows[0].key).toBe("101");
    expect(r.answer).toContain("What to do");
  });

  it("filters by amount", () => {
    expect(auditAsk("findings above ₹10,000", issues, "2026-10-12").rows.map((r) => r.key)).toEqual(["103"]);
    expect(auditAsk("anything for 5,000", issues, "2026-10-12").rows.map((r) => r.key)).toEqual(["102"]);
  });

  it("finds a document by number without treating it as an amount", () => {
    expect(auditAsk("why is INV-2024-001 flagged", [issue("x", "gst", 10, { entityLabel: "INV-2024-001" }), issue("y", "gst", 2024)], "2026-10-12").rows.map((r) => r.key)).toEqual(["x"]);
  });

  it("filters by age", () => {
    expect(auditAsk("pending more than 30 days", [issue("old", "ar", 1, { date: "2026-08-01" }), issue("new", "ar", 1, { date: "2026-10-01" })], "2026-10-12").rows.map((r) => r.key)).toEqual(["old"]);
  });

  it("summarises everything open", () => {
    const r = auditAsk("Give me a summary", issues, "2026-10-12");
    expect(r.matched).toBe(3);
    expect(r.answer).toContain("1 high or critical");
  });

  it("includes closed findings only when asked for all of them", () => {
    expect(auditAsk("small GST issues", issues, "2026-10-12").matched).toBe(1);
    expect(auditAsk("all GST issues", issues, "2026-10-12").matched).toBe(2);
  });
});
