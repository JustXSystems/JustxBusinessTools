import { describe, expect, it } from "vitest";
import { inventBarcode, inventItemFromBomLine, inventSku } from "./item-invent.js";

describe("inventItemFromBomLine", () => {
  it("maps Excel anchors and invents the rest stably", () => {
    const a = inventItemFromBomLine({
      name: "Solar Panel 540W",
      brand: "Acme",
      unit: "Nos",
      sellingPrice: 10000,
      section: "Main Items",
      typicalQty: 10,
      defaultGstRate: 18,
    });
    const b = inventItemFromBomLine({
      name: "Solar Panel 540W",
      brand: "Acme",
      unit: "Nos",
      sellingPrice: 10000,
      typicalQty: 10,
    });

    expect(a.name).toBe("Solar Panel 540W");
    expect(a.brand).toBe("Acme");
    expect(a.unit).toBe("nos");
    expect(a.sellingPrice).toBe(10000);
    expect(a.category).toBe("Solar Modules");
    expect(a.hsn).toBe("854142");
    expect(a.purchasePrice).toBe(7800);
    expect(a.minStock).toBe(5);
    expect(a.sku).toBe(b.sku);
    expect(a.barcode).toBe(b.barcode);
    expect(a.sku).toMatch(/^ACME-/);
  });

  it("uses Vendor/Make-less brand and BOM Materials fallback category", () => {
    const item = inventItemFromBomLine({ name: "Miscellaneous bracket", unit: "pcs", sellingPrice: 50 });
    expect(item.brand).toBeNull();
    expect(item.category).toBe("BOM Materials");
    expect(item.unit).toBe("nos");
  });

  it("keeps inventSku / inventBarcode deterministic", () => {
    expect(inventSku("DC Cable 4sqmm", "Reputed")).toBe(inventSku("DC Cable 4sqmm", "Reputed"));
    expect(inventBarcode("sku:TEST")).toMatch(/^\d{13}$/);
  });
});
