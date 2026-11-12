import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { inferBaseQty } from "../bom";
import {
  applyCatalogMatches,
  buildPackagesWorkbook,
  customerBomFromGrid,
  formatCatalogEnsureSummary,
  importCustomerBomExcel,
  matchCatalogItem,
  packageSheetRows,
  parseBomPackageWorkbook,
} from "../bom-excel";

describe("inferBaseQty", () => {
  it("unscales saved qty using capacity", () => {
    expect(inferBaseQty(30, true, "3KW")).toBe(10);
    expect(inferBaseQty(30, false, "3KW")).toBe(30);
    expect(inferBaseQty(30, true, "Size S")).toBe(30);
  });
});

describe("matchCatalogItem", () => {
  const catalog = [
    { id: "1", name: "Solar Panel 540W", sku: "SP-540", barcode: "8901", brand: "Acme", unit: "nos", sellingPrice: 100 },
    { id: "2", name: "DC Cable 4sqmm", sku: "CABLE-4", barcode: null, brand: "Reputed", unit: "mtr", sellingPrice: 40 },
    { id: "3", name: "DC Cable 4sqmm", sku: "CABLE-4B", barcode: null, brand: "Other", unit: "mtr", sellingPrice: 42 },
  ];

  it("matches exact SKU", () => {
    const hit = matchCatalogItem({ description: "anything", skuHint: "SP-540" }, catalog);
    expect(hit.confidence).toBe("exact");
    expect(hit.item?.id).toBe("1");
  });

  it("marks duplicate names without make as ambiguous", () => {
    const hit = matchCatalogItem({ description: "DC Cable 4sqmm" }, catalog);
    expect(hit.confidence).toBe("ambiguous");
    expect(hit.item).toBeNull();
  });

  it("applies only exact/strong links", () => {
    const { packages, summary } = applyCatalogMatches(
      [
        {
          name: "Kit",
          lines: [
            { section: "Main", lineKind: "stock", description: "Solar Panel 540W", qty: 1, unit: "nos", defaultRate: 0 },
            { section: "Main", lineKind: "stock", description: "DC Cable 4sqmm", qty: 10, unit: "mtr", defaultRate: 0 },
            { section: "Svc", lineKind: "service", description: "Install", qty: 1, unit: "job", defaultRate: 0 },
          ],
        },
      ],
      catalog,
    );
    expect(summary.matched).toBe(1);
    expect(summary.ambiguous).toBe(1);
    expect(packages[0]!.lines![0]!.itemId).toBe("1");
    expect(packages[0]!.lines![1]!.itemId).toBeFalsy();
  });

  it("formats ensure summary for toasts", () => {
    expect(formatCatalogEnsureSummary({ matched: 3, created: 5, ambiguous: 1, unmatched: 0 })).toContain("5 created");
    expect(formatCatalogEnsureSummary({ matched: 3, created: 5, ambiguous: 1, unmatched: 0 })).toContain("need a pick");
  });
});

function workbookFile(sheets: Record<string, unknown[][]>): File {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name.slice(0, 31));
  }
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([buf], "sample-bom.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("parseBomPackageWorkbook", () => {
  it("imports sectioned sheets into packages", async () => {
    const file = workbookFile({
      "Size S": [
        ["Acme Tools"],
        ["BILL OF MATERIALS", "", "", "CAPACITY :", "Size S Kit"],
        ["Customer Name :", "", "", "Location :"],
        ["SL.NO", "ITEM DESCRIPTION", "Make", "QTY", "UNITS", "PRICE/UNIT", "TOTAL", "REMARKS"],
        ["I", "Main Items"],
        [1, "Primary component", "Brand A", 1, "Nos", 100, 100, ""],
        [2, "Cable", "Reputed", 50, "Mtrs", 10, 500, ""],
        ["II", "Accessories & Services"],
        [1, "Installation Charges", "Third Party", 1, "job", 200, 200, ""],
        ["", "", "", "", "", "Margin 10%", 80, ""],
        ["", "", "", "", "", "Tax 18%", 0, ""],
      ],
    });
    const pkgs = await parseBomPackageWorkbook(file);
    expect(pkgs).toHaveLength(1);
    expect(pkgs[0]!.capacityLabel).toContain("Size S");
    expect(pkgs[0]!.lines!.length).toBeGreaterThanOrEqual(3);
    expect(pkgs[0]!.lines!.some((l) => /install/i.test(l.description) && l.lineKind === "service")).toBe(true);
  });
});

function fileFromBuffer(buf: ArrayBuffer): File {
  return new File([buf], "out.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

describe("exportPackagesExcel (buildPackagesWorkbook) round trip", () => {
  const pkgs = [
    {
      code: "PKG-S",
      name: "Kit S",
      capacityLabel: "Size S",
      defaultMarginPct: 10,
      defaultTaxPct: 18,
      lines: [
        { section: "Main Items", lineKind: "stock" as const, description: "Primary component", makeText: "Brand A", qty: 2, unit: "nos", defaultRate: 100, itemSku: "PRI-1" },
        { section: "Main Items", lineKind: "stock" as const, description: "Cable", makeText: "Reputed", qty: 50, unit: "mtr", defaultRate: 10 },
        { section: "Accessories & Services", lineKind: "service" as const, description: "Installation Charges", qty: 1, unit: "job", defaultRate: 200, remarks: "On site" },
        { section: "Accessories & Services", lineKind: "stock" as const, description: "Hidden", qty: 1, unit: "nos", defaultRate: 5, active: false },
      ],
    },
    { name: "Kit L", capacityLabel: "Size S", lines: [{ section: "Main Items", lineKind: "stock" as const, description: "Large part", qty: 1, unit: "nos", defaultRate: 50 }] },
  ];

  it("writes one sheet per package with unique names and skips inactive lines", () => {
    const rows = packageSheetRows(pkgs[0]!);
    const text = rows.map((r) => r.join("|")).join("\n");
    expect(text).toContain("SKU");
    expect(text).toContain("PRI-1");
    expect(text).not.toContain("Hidden");
    expect(text).toContain("Margin 10%");
  });

  it("re-imports through parseBomPackageWorkbook with lines, sku hints, margin and tax", async () => {
    const parsed = await parseBomPackageWorkbook(fileFromBuffer(await buildPackagesWorkbook(pkgs)));
    expect(parsed).toHaveLength(2);
    const first = parsed[0]!;
    expect(first.capacityLabel).toBe("Size S");
    expect(first.defaultMarginPct).toBe(10);
    expect(first.defaultTaxPct).toBe(18);
    expect(first.lines).toHaveLength(3);
    expect(first.lines![0]).toMatchObject({ description: "Primary component", qty: 2, unit: "nos", defaultRate: 100, makeText: "Brand A" });
    expect((first.lines![0] as { skuHint?: string }).skuHint).toBe("PRI-1");
    expect(first.lines![2]).toMatchObject({ lineKind: "service", section: "Accessories & Services", remarks: "On site" });
  });

  it("produces a placeholder workbook for an empty list", async () => {
    const buf = await buildPackagesWorkbook([]);
    expect(buf.byteLength).toBeGreaterThan(0);
  });
});

describe("importCustomerBomExcel", () => {
  const customerSheet: unknown[][] = [
    ["Acme Tools"],
    ["BILL OF MATERIALS", "", "", "CAPACITY / PACKAGE:", "3 kW Kit"],
    ["Customer: Jane Doe", "", "", "Location: Pune"],
    ["Document: BOM-0007", "", "", "Date: 2026-11-01"],
    [],
    ["SL.NO", "ITEM DESCRIPTION", "Make", "QTY", "UNITS", "PRICE/UNIT", "TOTAL", "REMARKS"],
    ["A", "Main Items", "", "", "", "", "", ""],
    [1, "Panel 550W", "Acme", 6, "nos", 100, 600, ""],
    [2, "DC Cable", "Reputed", 40, "mtr", 10, 400, "4 sqmm"],
    ["B", "Services", "", "", "", "", "", ""],
    [1, "Installation Charges", "", 1, "job", 200, 200, ""],
    [],
    ["", "", "", "", "", "Materials total", 1200, ""],
    ["", "", "", "", "", "Margin 10%", 120, ""],
    ["", "", "", "", "", "Subtotal", 1320, ""],
    ["", "", "", "", "", "Tax 18%", 237.6, ""],
    ["", "", "", "", "", "Grand total", 1557.6, ""],
    [],
    ["Notes", "Site visit done"],
    ["Prepared by", "Sam"],
  ];

  it("maps header fields, footer percentages and draft lines", () => {
    const draft = customerBomFromGrid(customerSheet, "BOM-0007");
    expect(draft).not.toBeNull();
    expect(draft).toMatchObject({
      docNo: "BOM-0007",
      customerName: "Jane Doe",
      location: "Pune",
      capacityLabel: "3 kW Kit",
      marginPct: 10,
      taxPct: 18,
      notes: "Site visit done",
      preparedBy: "Sam",
    });
    expect(draft!.lines.map((l) => [l.section, l.description, l.qty, l.rate])).toEqual([
      ["Main Items", "Panel 550W", 6, 100],
      ["Main Items", "DC Cable", 40, 10],
      ["Services", "Installation Charges", 1, 200],
    ]);
    expect(draft!.lines.every((l) => l.scaleByCapacity === false && !l.itemId)).toBe(true);
    expect(draft!.lines[1]).toMatchObject({ makeText: "Reputed", remarks: "4 sqmm", unit: "mtr" });
    expect(draft!.lines[2]!.lineKind).toBe("service");
  });

  it("reads an uploaded workbook and rejects sheets without a BOM header", async () => {
    const draft = await importCustomerBomExcel(workbookFile({ "BOM-0007": customerSheet }));
    expect(draft.customerName).toBe("Jane Doe");
    expect(draft.lines).toHaveLength(3);
    await expect(importCustomerBomExcel(workbookFile({ Empty: [["nothing here"]] }))).rejects.toThrow(/No BOM sheet/);
  });
});