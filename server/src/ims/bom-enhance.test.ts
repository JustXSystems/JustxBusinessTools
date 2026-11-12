import { describe, expect, it } from "vitest";
import {
  applyPartialIssue,
  applyRateCardRates,
  computeAsBuiltVariance,
  computeCostRollup,
  defaultVariablesFromCapacity,
  diffBomLines,
  diffKeyOf,
  evalQtyFormula,
  evaluateConfirmGates,
  lineIncludedByOptions,
  matchRateCardToBomLines,
  proposalWhatsAppUrl,
  remainingIssueQty,
  wouldCreatePackageCycle,
} from "./bom-enhance.js";

describe("evaluateConfirmGates", () => {
  const baseLine = {
    id: "l1",
    section: "Main",
    lineKind: "stock",
    itemId: "i1",
    description: "Panel",
    qty: 2,
    unit: "nos",
    rate: 100,
    itemActive: true,
  };

  it("passes a clean draft", () => {
    const r = evaluateConfirmGates({ customerName: "Acme", capacityLabel: null, lines: [baseLine] });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("blocks unmatched catalogue stock lines and zero qty", () => {
    const r = evaluateConfirmGates({
      customerName: "Acme",
      capacityLabel: null,
      lines: [
        { ...baseLine, itemId: null },
        { ...baseLine, id: "l2", qty: 0, description: "Cable" },
      ],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code).sort()).toEqual(["unmatched_catalogue", "zero_qty"]);
  });

  it("requires capacity when scaled lines exist", () => {
    const r = evaluateConfirmGates({
      customerName: "Acme",
      capacityLabel: "Size S",
      lines: [{ ...baseLine, scaleByCapacity: true }],
    });
    expect(r.errors.some((e) => e.code === "capacity_required")).toBe(true);
  });

  it("treats zero rate as warning that must be acknowledged", () => {
    const pending = evaluateConfirmGates({
      customerName: "Acme",
      capacityLabel: null,
      lines: [{ ...baseLine, rate: 0 }],
    });
    expect(pending.ok).toBe(false);
    expect(pending.warnings[0]?.code).toBe("zero_rate");
    const ack = evaluateConfirmGates({
      customerName: "Acme",
      capacityLabel: null,
      lines: [{ ...baseLine, rate: 0 }],
      acknowledgeWarnings: true,
    });
    expect(ack.ok).toBe(true);
  });
});

describe("computeCostRollup", () => {
  it("rolls sell vs cost with scrap", () => {
    const r = computeCostRollup(
      [
        { qty: 10, rate: 100, costRate: 60, scrapPct: 10 },
        { qty: 1, rate: 50, costRate: 40 },
      ],
      10,
    );
    // line1 qty 11 → sell 1100 cost 660; line2 sell 50 cost 40
    expect(r.materialsSell).toBe(1150);
    expect(r.materialsCost).toBe(700);
    expect(r.marginAmount).toBe(115);
  });
});

describe("evalQtyFormula", () => {
  it("evaluates arithmetic with variables and ceil", () => {
    expect(evalQtyFormula("capacityKw * 2", { capacityKw: 3 })).toBe(6);
    expect(evalQtyFormula("ceil(capacityKw * 1000 / panelWp)", { capacityKw: 3, panelWp: 550 })).toBe(6);
  });

  it("rejects unknown identifiers", () => {
    expect(() => evalQtyFormula("hack()", {})).toThrow();
    expect(() => evalQtyFormula("capacityKw + foo", { capacityKw: 1 })).toThrow();
  });

  it("builds defaults from capacity label", () => {
    expect(defaultVariablesFromCapacity("5.5 kW")).toEqual({ capacity: 5.5, capacityKw: 5.5 });
  });
});

describe("wouldCreatePackageCycle", () => {
  it("detects direct and transitive cycles", () => {
    const edges = new Map<string, string[]>([
      ["A", ["B"]],
      ["B", ["C"]],
      ["C", []],
    ]);
    expect(wouldCreatePackageCycle("A", "A", edges)).toBe(true);
    expect(wouldCreatePackageCycle("C", "A", edges)).toBe(true);
    expect(wouldCreatePackageCycle("A", "C", edges)).toBe(false);
  });
});

describe("lineIncludedByOptions", () => {
  it("includes required lines and selected options only", () => {
    expect(lineIncludedByOptions(false, null, [])).toBe(true);
    expect(lineIncludedByOptions(true, "battery", ["battery"])).toBe(true);
    expect(lineIncludedByOptions(true, "battery", ["inverter"])).toBe(false);
  });
});

describe("diffBomLines", () => {
  it("classifies added removed and changed", () => {
    const left = [{ key: "a", description: "A", section: "Main", qty: 1, rate: 10, unit: "nos" }];
    const right = [
      { key: "a", description: "A", section: "Main", qty: 2, rate: 10, unit: "nos" },
      { key: "b", description: "B", section: "Main", qty: 1, rate: 5, unit: "nos" },
    ];
    const d = diffBomLines(left, right);
    expect(d.find((x) => x.kind === "changed" && "fields" in x && x.fields.includes("qty"))).toBeTruthy();
    expect(d.some((x) => x.kind === "added")).toBe(true);
    expect(diffKeyOf({ itemId: "i1", description: "X", section: "S" })).toBe("item:i1");
  });
});

describe("as-built and partial issue", () => {
  it("computes variance and remaining qty", () => {
    expect(computeAsBuiltVariance([{ lineId: "1", description: "A", soldQty: 5, issuedQty: 3, unit: "nos" }])[0]?.variance).toBe(-2);
    expect(remainingIssueQty(5, 3)).toBe(2);
    expect(applyPartialIssue([{ id: "1", qty: 5, issuedQty: 3 }], [{ lineId: "1", qty: 10 }])).toEqual([
      { lineId: "1", qty: 2, nextIssuedQty: 5 },
    ]);
  });
});

describe("proposalWhatsAppUrl", () => {
  it("encodes customer and link", () => {
    const url = proposalWhatsAppUrl("https://example.com/p/abc", "Riya");
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(url.split("text=")[1]!)).toContain("Riya");
  });
});

describe("matchRateCardToBomLines", () => {
  const rateLines = [
    { itemId: "item-a", sku: "SKU-A", rate: 100, costRate: 60 },
    { itemId: null, sku: "sku-b", rate: 50, costRate: 30 },
    { itemId: "item-c", sku: "SKU-C", rate: 200, costRate: null },
  ];

  it("matches by itemId first, then sku", () => {
    const matches = matchRateCardToBomLines(
      [
        { id: "l1", itemId: "item-a", itemSku: "OTHER" },
        { id: "l2", itemId: null, itemSku: "SKU-B" },
        { id: "l3", itemId: "missing", itemSku: null },
      ],
      rateLines,
    );
    expect(matches).toEqual([
      { lineId: "l1", rate: 100, costRate: 60, matchedBy: "itemId" },
      { lineId: "l2", rate: 50, costRate: 30, matchedBy: "sku" },
    ]);
  });

  it("prefers itemId over sku when both could match", () => {
    const matches = matchRateCardToBomLines(
      [{ id: "l1", itemId: "item-c", itemSku: "sku-b" }],
      rateLines,
    );
    expect(matches).toEqual([{ lineId: "l1", rate: 200, costRate: null, matchedBy: "itemId" }]);
  });

  it("applyRateCardRates updates rate and costRate on matched lines only", () => {
    const updated = applyRateCardRates(
      [
        { id: "l1", itemId: "item-a", itemSku: null, rate: 1, costRate: 1 },
        { id: "l2", itemId: null, itemSku: "nope", rate: 9, costRate: 9 },
      ],
      rateLines,
    );
    expect(updated[0]).toMatchObject({ id: "l1", rate: 100, costRate: 60 });
    expect(updated[1]).toMatchObject({ id: "l2", rate: 9, costRate: 9 });
  });
});
