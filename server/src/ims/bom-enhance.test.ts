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
  planProposalShare,
  proposalWhatsAppUrl,
  availableDcQty,
  minBomQtyWithLiveDcs,
  netDcLineQty,
  planBomIssuedSync,
  remainingIssueQty,
  returnableDcQty,
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

  it("availableDcQty blocks double stock-out after invoice explode / DC commit", () => {
    // Open BOM — full qty available
    expect(availableDcQty(10, 0, 0, null)).toBe(10);
    // Draft/verified DCs reserve capacity
    expect(availableDcQty(10, 4, 0, null)).toBe(6);
    // Approved DC issued_qty sync
    expect(availableDcQty(10, 4, 4, "2026-01-01")).toBe(6);
    // Invoice explode set stock_issued_at without per-line issued_qty — nothing left for DCs
    expect(availableDcQty(10, 0, 0, "2026-01-01")).toBe(0);
    // Invoice explode that also wrote issued_qty
    expect(availableDcQty(10, 0, 10, "2026-01-01")).toBe(0);
    // Partial issued via DCs still leaves remainder (stock_issued_at alone must not zero other lines)
    expect(availableDcQty(10, 0, 0, null)).toBe(10);
    expect(availableDcQty(10, 3, 3, null)).toBe(7);
    expect(availableDcQty(10, 3, 3, "2026-01-01")).toBe(7);
    // Over-commit: requested qty must not exceed remaining (verify/approve re-check)
    expect(8 > availableDcQty(10, 4, 0, null) + 1e-9).toBe(true);
    expect(6 <= availableDcQty(10, 4, 0, null) + 1e-9).toBe(true);
  });

  it("isLegacyFullIssue distinguishes invoice/BOM explode from DC-backed issue", () => {
    expect(isLegacyFullIssue("2026-01-01", [{ issuedQty: 0 }, { issuedQty: 0 }])).toBe(true);
    expect(isLegacyFullIssue("2026-01-01", [{ issuedQty: 4 }, { issuedQty: 0 }])).toBe(false);
    expect(isLegacyFullIssue(null, [{ issuedQty: 0 }])).toBe(false);
  });

  it("planBomIssuedSync handles partial / multi-DC / reverse / full coverage", () => {
    const lines = [
      { id: "a", qty: 10 },
      { id: "b", qty: 5 },
    ];

    // DC1 approves A=4 only — partial across BOM
    const p1 = planBomIssuedSync(lines, new Map([["a", 4]]), 1);
    expect(p1.lineIssued).toEqual([
      { lineId: "a", issued: 4 },
      { lineId: "b", issued: 0 },
    ]);
    expect(p1.anyIssued).toBe(true);
    expect(p1.fullyCovered).toBe(false);
    expect(p1.stockIssuedAt).toBe("clear");
    expect(p1.stockIssueCount).toBe(1);
    expect(availableDcQty(10, 4, 4, null)).toBe(6);
    expect(availableDcQty(5, 0, 0, null)).toBe(5);

    // DC2 approves A=3 + B=2 — still partial (B has 3 left)
    const p2 = planBomIssuedSync(lines, { a: 7, b: 2 }, 2);
    expect(p2.lineIssued).toEqual([
      { lineId: "a", issued: 7 },
      { lineId: "b", issued: 2 },
    ]);
    expect(p2.fullyCovered).toBe(false);
    expect(p2.stockIssuedAt).toBe("clear");
    expect(p2.stockIssueCount).toBe(2);
    expect(availableDcQty(10, 7, 7, null)).toBe(3);
    expect(availableDcQty(5, 2, 2, null)).toBe(3);

    // DC3 finishes both lines
    const p3 = planBomIssuedSync(lines, { a: 10, b: 5 }, 3);
    expect(p3.fullyCovered).toBe(true);
    expect(p3.stockIssuedAt).toBe("set");
    expect(p3.stockIssueCount).toBe(3);
    expect(availableDcQty(10, 10, 10, "2026-01-01")).toBe(0);
    expect(availableDcQty(5, 5, 5, "2026-01-01")).toBe(0);

    // Reverse DC2-equivalent — back to A=4 only (as if one approved DC remains)
    const p4 = planBomIssuedSync(lines, { a: 4 }, 1);
    expect(p4.stockIssuedAt).toBe("clear");
    expect(p4.stockIssueCount).toBe(1);
    expect(p4.lineIssued.find((x) => x.lineId === "b")?.issued).toBe(0);

    // Reverse last DC — empty
    const p5 = planBomIssuedSync(lines, {}, 0);
    expect(p5.anyIssued).toBe(false);
    expect(p5.stockIssuedAt).toBe("clear");
    expect(p5.stockIssueCount).toBe(0);
    expect(p5.lineIssued.every((x) => x.issued === 0)).toBe(true);

    // Fractional accumulation on one line
    const frac = planBomIssuedSync([{ id: "a", qty: 5 }], { a: 2.5 }, 1);
    expect(frac.lineIssued[0]?.issued).toBe(2.5);
    expect(frac.fullyCovered).toBe(false);
    expect(availableDcQty(5, 2.5, 2.5, null)).toBe(2.5);
    const fracDone = planBomIssuedSync([{ id: "a", qty: 5 }], { a: 5 }, 2);
    expect(fracDone.fullyCovered).toBe(true);

    // Same item split across two BOM lines — tracked per line, not merged
    const split = planBomIssuedSync(
      [
        { id: "l1", qty: 5 },
        { id: "l2", qty: 3 },
      ],
      { l1: 2, l2: 1 },
      1,
    );
    expect(split.lineIssued).toEqual([
      { lineId: "l1", issued: 2 },
      { lineId: "l2", issued: 1 },
    ]);
    expect(split.fullyCovered).toBe(false);
  });

  it("availableDcQty enforces BOM ceiling; bump + returns free capacity for next DC", () => {
    // BOM 100, DC1 approved 100 — nothing left for DC2 (need +25 without BOM update)
    expect(availableDcQty(100, 100, 100, null)).toBe(0);
    expect(25 > availableDcQty(100, 100, 100, null) + 1e-9).toBe(true);
    // After amend to 125 + reconfirm — 25 available
    expect(availableDcQty(125, 100, 100, null)).toBe(25);
    // Partial unused return of 10 on DC1 frees capacity without BOM bump
    expect(availableDcQty(100, 90, 90, null)).toBe(10);
  });

  it("multi-DC + draft reserve + return + reverse scenarios stay under BOM qty", () => {
    // DC1 approved 60 + DC2 draft 40 on BOM 100 — nothing left
    expect(availableDcQty(100, 100, 60, null)).toBe(0);
    // DC2 draft cancelled — 40 free
    expect(availableDcQty(100, 60, 60, null)).toBe(40);
    // DC1 return 15 → committed/issued net 45 → 55 free
    expect(availableDcQty(100, 45, 45, null)).toBe(55);
    // After full reverse of remaining on DC1 (net 0) — full BOM free
    expect(availableDcQty(100, 0, 0, null)).toBe(100);
    // Two approved partials: 70 + 30 = full
    expect(availableDcQty(100, 100, 100, "2026-01-01")).toBe(0);
    // Bump BOM to 125 with 100 still out → 25 for DC3
    expect(availableDcQty(125, 100, 100, null)).toBe(25);
    // Over-approve attempt blocked
    expect(30 > availableDcQty(125, 100, 100, null) + 1e-9).toBe(true);
  });

  it("returnable / net DC qty and min BOM floor with live DCs", () => {
    expect(netDcLineQty(100, 0)).toBe(100);
    expect(netDcLineQty(100, 25)).toBe(75);
    expect(returnableDcQty(100, 25)).toBe(75);
    expect(returnableDcQty(100, 100)).toBe(0);
    expect(returnableDcQty(100, 110)).toBe(0);
    // Cannot shrink BOM below net committed on live DCs
    expect(minBomQtyWithLiveDcs(100)).toBe(100);
    expect(minBomQtyWithLiveDcs(75)).toBe(75);
    // After return frees committed net, floor drops
    expect(minBomQtyWithLiveDcs(75) <= 100).toBe(true);
  });

  it("planBomIssuedSync after return clears full-cover flag until BOM bump is filled", () => {
    const lines = [{ id: "a", qty: 100 }];
    const full = planBomIssuedSync(lines, { a: 100 }, 1);
    expect(full.fullyCovered).toBe(true);
    expect(full.stockIssuedAt).toBe("set");
    // Return 25 → net 75 out; not fully covered
    const afterReturn = planBomIssuedSync(lines, { a: 75 }, 1);
    expect(afterReturn.fullyCovered).toBe(false);
    expect(afterReturn.stockIssuedAt).toBe("clear");
    // Amend BOM to 125 conceptually — still 75 of 125 out
    const bumped = planBomIssuedSync([{ id: "a", qty: 125 }], { a: 75 }, 1);
    expect(bumped.fullyCovered).toBe(false);
    expect(availableDcQty(125, 75, 75, null)).toBe(50);
  });
});

describe("proposalWhatsAppUrl", () => {
  it("encodes customer and link", () => {
    const url = proposalWhatsAppUrl("https://example.com/p/abc", "Riya");
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(url.split("text=")[1]!)).toContain("Riya");
  });
});

describe("planProposalShare", () => {
  it("reuses open links and blocks silent wipe of acceptance", () => {
    expect(planProposalShare("sent", "tok", false)).toEqual({ action: "reuse", previousStatus: "sent" });
    expect(planProposalShare("viewed", "tok", false)).toEqual({ action: "reuse", previousStatus: "viewed" });
    expect(planProposalShare("accepted", "tok", false)).toEqual({ action: "block_accepted", previousStatus: "accepted" });
    expect(planProposalShare("accepted", "tok", true)).toEqual({ action: "renew", previousStatus: "accepted" });
    expect(planProposalShare("rejected", null, false).action).toBe("create");
    expect(planProposalShare("revoked", "tok", false).action).toBe("create");
    expect(planProposalShare(null, null, false).action).toBe("create");
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
