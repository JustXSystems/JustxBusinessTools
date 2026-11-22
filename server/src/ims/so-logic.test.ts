import { describe, expect, it } from "vitest";
import { mergeQtys, planFromRemaining, soDerivedStatus, soLineKey, soProgress, soSummary, type SoLineRef } from "./so-logic.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const lines: SoLineRef[] = [
  { itemId: A, name: "Cable", qty: 10 },
  { itemId: B, name: "Switch", qty: 4 },
  { itemId: null, name: "Installation", qty: 1 },
];

describe("soProgress", () => {
  it("starts with everything remaining", () => {
    const p = soProgress(lines, [], []);
    expect(p.map((x) => x.remaining)).toEqual([10, 4, 1]);
    expect(soDerivedStatus("confirmed", p)).toBe("confirmed");
  });

  it("reserves draft DC qty, ships approved DC qty and tracks unbilled", () => {
    const p = soProgress(
      lines,
      [
        { status: "approved", lines: [{ lineIndex: 0, qty: 6 }] },
        { status: "approved", invoiced: true, lines: [{ lineIndex: 1, qty: 1 }] },
        { status: "draft", lines: [{ lineIndex: 0, qty: 2 }] },
        { status: "cancelled", lines: [{ lineIndex: 0, qty: 99 }] },
      ],
      [],
    );
    expect(p[0]).toMatchObject({ delivered: 6, reserved: 2, remaining: 2, deliveredUnbilled: 6 });
    expect(p[1]).toMatchObject({ delivered: 1, remaining: 3, deliveredUnbilled: 0 });
    expect(soDerivedStatus("confirmed", p)).toBe("partial");
  });

  it("counts direct invoices against remaining and only issued ones toward fulfilment", () => {
    const direct = [
      { status: "draft", lines: [{ itemId: A, name: "Cable", qty: 4 }] },
      { status: "cancelled", lines: [{ itemId: A, name: "Cable", qty: 50 }] },
    ];
    const p = soProgress(lines, [{ status: "approved", lines: [{ lineIndex: 0, qty: 6 }] }], direct);
    expect(p[0]).toMatchObject({ invoicedDirect: 4, invoicedIssued: 0, remaining: 0 });
    expect(soDerivedStatus("confirmed", p)).toBe("partial");
    const issued = soProgress(lines, [{ status: "approved", lines: [{ lineIndex: 0, qty: 6 }] }], [{ status: "issued", lines: [{ itemId: A, name: "Cable", qty: 4 }] }]);
    expect(issued[0].invoicedIssued).toBe(4);
  });

  it("is fulfilled once every line is delivered or billed", () => {
    const p = soProgress(
      lines,
      [{ status: "approved", lines: [{ lineIndex: 0, qty: 10 }, { lineIndex: 1, qty: 4 }] }],
      [{ status: "issued", lines: [{ itemId: null, name: "installation", qty: 1 }] }],
    );
    expect(soDerivedStatus("partial", p)).toBe("fulfilled");
    expect(soSummary(p)).toMatchObject({ orderedQty: 15, deliveredQty: 15, remainingQty: 0, deliveredPct: 100 });
  });

  it("never changes draft or cancelled orders", () => {
    const p = soProgress(lines, [{ status: "approved", lines: [{ lineIndex: 0, qty: 10 }] }], []);
    expect(soDerivedStatus("draft", p)).toBe("draft");
    expect(soDerivedStatus("cancelled", p)).toBe("cancelled");
  });

  it("keys unlinked lines by name + sku", () => {
    expect(soLineKey({ name: " Install ", sku: "X" })).toBe(soLineKey({ name: "install", sku: "x" }));
    expect(soLineKey({ itemId: A, name: "a" })).not.toBe(soLineKey({ name: "a" }));
  });
});

describe("planFromRemaining", () => {
  const p = soProgress(lines, [{ status: "approved", lines: [{ lineIndex: 0, qty: 10 }] }], []);

  it("defaults to everything remaining", () => {
    expect(planFromRemaining(p, undefined, "none")).toEqual({ lines: [{ lineIndex: 1, qty: 4 }, { lineIndex: 2, qty: 1 }], error: null });
  });

  it("reports nothing left", () => {
    const done = soProgress(lines, [{ status: "approved", lines: [{ lineIndex: 0, qty: 10 }, { lineIndex: 1, qty: 4 }, { lineIndex: 2, qty: 1 }] }], []);
    expect(planFromRemaining(done, [], "none").error).toBe("none");
  });

  it("validates a subset against remaining and merges duplicate picks", () => {
    expect(planFromRemaining(p, [{ lineIndex: 1, qty: 1 }, { lineIndex: 1, qty: 2 }], "x").lines).toEqual([{ lineIndex: 1, qty: 3 }]);
    expect(planFromRemaining(p, [{ lineIndex: 0, qty: 1 }], "x").error).toMatch(/only 0 left/);
    expect(planFromRemaining(p, [{ lineIndex: 9, qty: 1 }], "x").error).toMatch(/not on this order/);
  });
});

describe("mergeQtys", () => {
  it("adds quantities per line across documents", () => {
    expect(mergeQtys([[{ lineIndex: 1, qty: 1 }], [{ lineIndex: 0, qty: 2 }, { lineIndex: 1, qty: 0.5 }]])).toEqual([
      { lineIndex: 0, qty: 2 },
      { lineIndex: 1, qty: 1.5 },
    ]);
  });
});
