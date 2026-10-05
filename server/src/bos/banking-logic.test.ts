import { describe, expect, it } from "vitest";
import { bestSuggestion, fingerprintLines, scoreCandidates, type MatchCandidate, type StatementLine } from "./banking-logic.js";

const line = (over: Partial<StatementLine> = {}): StatementLine => ({ date: "2026-10-03", description: "NEFT CR MERIDIAN SOLAR EPC", reference: "N123", amount: 118000, ...over });

const candidate = (over: Partial<MatchCandidate>): MatchCandidate => ({
  type: "invoice",
  id: "x",
  action: "settle",
  label: "INV/26-27/0001",
  detail: "Meridian Solar EPC",
  date: "2026-09-20",
  amount: 118000,
  keywords: ["Meridian Solar EPC", "INV/26-27/0001"],
  ...over,
});

describe("fingerprintLines", () => {
  it("is stable across imports and ignores case and spacing", () => {
    const a = fingerprintLines([line()]);
    const b = fingerprintLines([line({ description: "  neft cr   meridian solar epc " })]);
    expect(a).toEqual(b);
    expect(a[0]).toMatch(/^[0-9a-f]{40}$/);
  });

  it("keeps identical lines in one statement apart", () => {
    const [x, y] = fingerprintLines([line({ amount: -50 }), line({ amount: -50 })]);
    expect(x).not.toBe(y);
    expect(fingerprintLines([line({ amount: -50 })])[0]).toBe(x);
  });

  it("differs when the amount, date or reference differs", () => {
    const base = fingerprintLines([line()])[0];
    expect(fingerprintLines([line({ amount: 118001 })])[0]).not.toBe(base);
    expect(fingerprintLines([line({ date: "2026-10-04" })])[0]).not.toBe(base);
    expect(fingerprintLines([line({ reference: "N124" })])[0]).not.toBe(base);
  });
});

describe("scoreCandidates", () => {
  it("only offers money-in records for credits and money-out records for debits", () => {
    const pool = [candidate({ id: "inv" }), candidate({ id: "bill", type: "bill", action: "match", date: "2026-10-02" })];
    expect(scoreCandidates(line(), pool).map((c) => c.id)).toEqual(["inv"]);
    expect(scoreCandidates(line({ amount: -118000 }), pool).map((c) => c.id)).toEqual(["bill"]);
  });

  it("prefers an already-recorded payment over recording it again", () => {
    const pool = [candidate({ id: "inv" }), candidate({ id: "pay", type: "payment", action: "match", date: "2026-10-03" })];
    const scored = scoreCandidates(line(), pool);
    expect(scored[0].id).toBe("pay");
    expect(bestSuggestion(scored)?.id).toBe("pay");
  });

  it("lets a part-payment settle an invoice but never more than its balance", () => {
    expect(scoreCandidates(line({ amount: 50000 }), [candidate({})])[0]).toMatchObject({ exact: false, action: "settle" });
    expect(scoreCandidates(line({ amount: 200000 }), [candidate({})])).toEqual([]);
  });

  it("requires the exact amount and a nearby date to match a recorded item", () => {
    const pay = candidate({ type: "payment", action: "match", date: "2026-10-01" });
    expect(scoreCandidates(line({ amount: 117000 }), [pay])).toEqual([]);
    expect(scoreCandidates(line({ date: "2026-10-30" }), [pay])).toEqual([]);
    expect(scoreCandidates(line(), [pay])).toHaveLength(1);
  });

  it("allows reimbursements up to 60 days after the spend", () => {
    const claim = candidate({ type: "expense", action: "match", date: "2026-08-20", amount: 2500, keywords: ["Ravi Kumar"] });
    expect(scoreCandidates(line({ amount: -2500, description: "IMPS RAVI KUMAR" }), [claim])).toHaveLength(1);
    expect(scoreCandidates(line({ amount: -2500, date: "2026-11-01" }), [claim])).toEqual([]);
  });

  it("doesn't settle a document dated well after the money moved", () => {
    expect(scoreCandidates(line(), [candidate({ date: "2026-10-20" })])).toEqual([]);
  });

  it("ranks by the party name or document number in the narration", () => {
    const pool = [candidate({ id: "other", label: "INV/26-27/0002", detail: "Coastal Resorts", keywords: ["Coastal Resorts", "INV/26-27/0002"] }), candidate({ id: "meridian" })];
    const scored = scoreCandidates(line(), pool);
    expect(scored.map((c) => c.id)).toEqual(["meridian", "other"]);
    expect(bestSuggestion(scored)?.id).toBe("meridian");
  });

  it("doesn't suggest when two candidates are equally likely", () => {
    const pool = [candidate({ id: "a", keywords: [] }), candidate({ id: "b", label: "INV/26-27/0009", keywords: [] })];
    expect(bestSuggestion(scoreCandidates(line({ description: "UPI CREDIT" }), pool))).toBeNull();
  });
});
