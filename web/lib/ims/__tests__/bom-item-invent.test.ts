import { describe, expect, it } from "vitest";
import { BOM_TO_INVENTORY_MAP, bomLineToEnsurePayload } from "../bom-item-invent";

describe("bomLineToEnsurePayload", () => {
  it("maps the four Excel anchors for ensure API", () => {
    const payload = bomLineToEnsurePayload({
      name: "Solar Panel 540W",
      brand: "Acme",
      unit: "Nos",
      sellingPrice: 12500,
      section: "Main Items",
      typicalQty: 10,
      remarks: "Mono PERC",
    });
    expect(payload).toMatchObject({
      name: "Solar Panel 540W",
      brand: "Acme",
      unit: "Nos",
      sellingPrice: 12500,
      section: "Main Items",
      typicalQty: 10,
      remarks: "Mono PERC",
    });
  });

  it("documents the canonical Excel → inventory map", () => {
    expect(BOM_TO_INVENTORY_MAP.map((r) => r.inventory)).toEqual(["Item name", "Brand", "Unit", "Selling price"]);
  });
});
