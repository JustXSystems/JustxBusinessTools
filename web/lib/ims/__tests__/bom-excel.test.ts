import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { inferBaseQty } from "../bom";
import { applyCatalogMatches, matchCatalogItem, parseBomPackageWorkbook } from "../bom-excel";

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
