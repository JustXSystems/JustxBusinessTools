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
  explodeNestedPackageLines,
  isLegacyFullIssue,
  lineIncludedByOptions,
  matchRateCardToBomLines,
  mergeSerialNotes,
  normalizeOptionSelection,
  pickAlternateWhenShort,
  proposalWhatsAppUrl,
  remainingIssueQty,
  rotateAlternates,
  selectedOptionKeys,
  suggestAlternatesForShortfall,
  wouldCreatePackageCycle,
  type PackageLineLike,
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

describe("pickAlternateWhenShort", () => {
  const stock = new Map([["a1", 2], ["a2", 10], ["a3", 50]]);

  it("returns the first alternate with enough stock", () => {
    expect(pickAlternateWhenShort("p", ["a1", "a2", "a3"], stock, 5)).toBe("a2");
  });

  it("returns null when none cover the need, skipping the primary", () => {
    expect(pickAlternateWhenShort("a3", ["a1", "a3"], stock, 5)).toBeNull();
    expect(pickAlternateWhenShort("p", [], stock, 1)).toBeNull();
    expect(pickAlternateWhenShort("p", ["zzz"], stock, 1)).toBeNull();
  });

  it("accepts a plain record", () => {
    expect(pickAlternateWhenShort("p", ["a1"], { a1: 3 }, 3)).toBe("a1");
  });
});

describe("suggestAlternatesForShortfall", () => {
  const line = (over: Record<string, unknown>) => ({
    id: "l1",
    lineKind: "stock",
    itemId: "p",
    description: "Panel",
    qty: 10,
    issuedQty: 0,
    alternateItemIds: ["a1", "a2"],
    ...over,
  });

  it("suggests an alternate for short primaries only", () => {
    const out = suggestAlternatesForShortfall([line({})], new Map([["p", 4], ["a1", 3], ["a2", 20]]));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ lineId: "l1", need: 10, onHand: 4, shortfall: 6, suggestedItemId: "a2" });
    expect(out[0]!.candidates).toEqual([
      { itemId: "a1", onHand: 3, covers: false },
      { itemId: "a2", onHand: 20, covers: true },
    ]);
    expect(suggestAlternatesForShortfall([line({})], new Map([["p", 50]]))).toEqual([]);
  });

  it("uses remaining qty and aggregates need across lines of the same item", () => {
    const out = suggestAlternatesForShortfall(
      [line({ id: "l1", qty: 6, issuedQty: 2 }), line({ id: "l2", qty: 6, alternateItemIds: [] })],
      new Map([["p", 8], ["a1", 4]]),
    );
    // need = 4 + 6 = 10 vs on-hand 8 → short by 2; l2 has no alternates
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ lineId: "l1", need: 10, shortfall: 2, suggestedItemId: "a1" });
  });

  it("ignores fully issued and non-stock lines", () => {
    expect(suggestAlternatesForShortfall([line({ issuedQty: 10 }), line({ id: "l2", lineKind: "service" })], new Map())).toEqual([]);
  });
});

describe("rotateAlternates", () => {
  it("moves the old item into the alternates list", () => {
    expect(rotateAlternates(["a1", "a2"], "p", "a1")).toEqual(["a2", "p"]);
    expect(rotateAlternates(["a1"], null, "a1")).toEqual([]);
    expect(rotateAlternates(["a1", "p"], "p", "a1")).toEqual(["p"]);
  });
});

describe("option selection helpers", () => {
  it("normalizes arrays and records", () => {
    expect(normalizeOptionSelection(["a", " b ", ""])).toEqual({ a: true, b: true });
    expect(normalizeOptionSelection({ a: true, b: false, c: "true" })).toEqual({ a: true, b: false, c: true });
    expect(normalizeOptionSelection(null)).toEqual({});
  });

  it("lists only truthy keys", () => {
    expect(selectedOptionKeys({ a: true, b: false })).toEqual(["a"]);
    expect(selectedOptionKeys(["x", "y"])).toEqual(["x", "y"]);
  });
});

describe("explodeNestedPackageLines", () => {
  const base = (over: Partial<PackageLineLike>): PackageLineLike => ({
    section: "Main",
    lineKind: "stock",
    itemId: null,
    description: "Line",
    qty: 1,
    unit: "nos",
    defaultRate: 10,
    ...over,
  });

  const makeLoader = (graph: Record<string, PackageLineLike[]>) => async (id: string) => graph[id] ?? null;

  it("flattens child packages (phantom) and multiplies by the child qty", async () => {
    const lines = await explodeNestedPackageLines(
      makeLoader({
        root: [base({ id: "r1", description: "Frame" }), base({ id: "r2", description: "Kit", childPackageId: "kit", qty: 3 })],
        kit: [base({ id: "k1", description: "Bolt", qty: 4, defaultRate: 2 })],
      }),
      "root",
      {},
    );
    expect(lines.map((l) => [l.description, l.qty, l.depth, l.sourcePackageId])).toEqual([
      ["Frame", 1, 0, "root"],
      ["Bolt", 12, 1, "kit"],
    ]);
    expect(lines.map((l) => l.sortNo)).toEqual([0, 1]);
    expect(lines[1]).toMatchObject({ rate: 2, sourcePackageLineId: "k1" });
  });

  it("scales by capacity and evaluates formulas", async () => {
    const lines = await explodeNestedPackageLines(
      makeLoader({
        root: [
          base({ description: "Scaled", qty: 2, scaleByCapacity: true }),
          base({ description: "Panels", qty: 1, qtyFormula: "ceil(capacityKw * 1000 / panelWp)" }),
          base({ description: "Plain", qty: 5 }),
        ],
      }),
      "root",
      { capacityLabel: "3KW", variables: { panelWp: 550 } },
    );
    expect(lines.map((l) => l.qty)).toEqual([6, 6, 5]);
  });

  it("does not capacity-scale the child reference line itself", async () => {
    const lines = await explodeNestedPackageLines(
      makeLoader({
        root: [base({ childPackageId: "c", qty: 2, scaleByCapacity: true })],
        c: [base({ description: "Leaf", qty: 1, scaleByCapacity: true })],
      }),
      "root",
      { capacityLabel: "5KW" },
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]!.qty).toBe(10);
  });

  it("includes optional lines only when selected (also inside children)", async () => {
    const graph = {
      root: [
        base({ description: "Always" }),
        base({ description: "Battery", optionalFlag: true, optionKey: "battery" }),
        base({ description: "Child", childPackageId: "c" }),
      ],
      c: [base({ description: "Child option", optionalFlag: true, optionKey: "battery" })],
    };
    const off = await explodeNestedPackageLines(makeLoader(graph), "root", {});
    expect(off.map((l) => l.description)).toEqual(["Always"]);
    const on = await explodeNestedPackageLines(makeLoader(graph), "root", { selectedOptions: ["battery"] });
    expect(on.map((l) => l.description)).toEqual(["Always", "Battery", "Child option"]);
    expect(on[1]).toMatchObject({ optionalFlag: true, optionKey: "battery" });
  });

  it("skips inactive lines", async () => {
    const lines = await explodeNestedPackageLines(makeLoader({ root: [base({ active: false }), base({ description: "Keep" })] }), "root");
    expect(lines.map((l) => l.description)).toEqual(["Keep"]);
  });

  it("detects cycles, missing packages and depth overflow", async () => {
    await expect(
      explodeNestedPackageLines(makeLoader({ a: [base({ childPackageId: "b" })], b: [base({ childPackageId: "a" })] }), "a"),
    ).rejects.toThrow(/cycle/i);
    await expect(explodeNestedPackageLines(makeLoader({ a: [base({ childPackageId: "a" })] }), "a")).rejects.toThrow(/cycle/i);
    await expect(explodeNestedPackageLines(makeLoader({ a: [base({ childPackageId: "gone" })] }), "a")).rejects.toThrow(/not found/i);
    await expect(
      explodeNestedPackageLines(
        makeLoader({ a: [base({ childPackageId: "b" })], b: [base({ childPackageId: "c" })], c: [base({})] }),
        "a",
        { depthLimit: 1 },
      ),
    ).rejects.toThrow(/depth/i);
  });

  it("allows the same child twice (diamond) without flagging a cycle", async () => {
    const lines = await explodeNestedPackageLines(
      makeLoader({
        root: [base({ childPackageId: "c", description: "one" }), base({ childPackageId: "c", description: "two", qty: 2 })],
        c: [base({ description: "Leaf" })],
      }),
      "root",
    );
    expect(lines.map((l) => l.qty)).toEqual([1, 2]);
  });

  it("reports the offending line for bad formulas", async () => {
    await expect(
      explodeNestedPackageLines(makeLoader({ root: [base({ description: "Oops", qtyFormula: "unknownVar * 2" })] }), "root"),
    ).rejects.toThrow(/Oops/);
  });
});

describe("serial notes + issue state", () => {
  it("merges serial notes without duplicates", () => {
    expect(mergeSerialNotes(null, "SN1")).toBe("SN1");
    expect(mergeSerialNotes("SN1", "SN2")).toBe("SN1; SN2");
    expect(mergeSerialNotes("SN1; SN2", "SN2")).toBe("SN1; SN2");
    expect(mergeSerialNotes("SN1", "  ")).toBe("SN1");
    expect(mergeSerialNotes(null, null)).toBeNull();
  });

  it("detects legacy full issue (no per-line issued qty)", () => {
    expect(isLegacyFullIssue("2026-01-01", [{ issuedQty: 0 }, {}])).toBe(true);
    expect(isLegacyFullIssue("2026-01-01", [{ issuedQty: 0 }, { issuedQty: 2 }])).toBe(false);
    expect(isLegacyFullIssue(null, [{ issuedQty: 0 }])).toBe(false);
  });

  it("applyPartialIssue clamps to remaining and ignores empty requests", () => {
    const out = applyPartialIssue(
      [
        { id: "a", qty: 10, issuedQty: 4 },
        { id: "b", qty: 5, issuedQty: 5 },
      ],
      [
        { lineId: "a", qty: 100 },
        { lineId: "b", qty: 1 },
        { lineId: "zzz", qty: 1 },
      ],
    );
    expect(out).toEqual([{ lineId: "a", qty: 6, nextIssuedQty: 10 }]);
  });
});
