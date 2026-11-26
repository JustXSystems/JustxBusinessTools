import { describe, expect, it } from "vitest";
import { compareRestockUrgency, reorderQty, stockStatus } from "./logic.js";

describe("redesigned stock status, availability, and reorder rules", () => {
  it("keeps physical zero/negative stock as OUT_OF_STOCK even with damaged units or min=0", () => {
    expect(stockStatus(0, 0)).toBe("OUT_OF_STOCK");
    expect(stockStatus(0, 5)).toBe("OUT_OF_STOCK");
    expect(stockStatus(-2, 5)).toBe("OUT_OF_STOCK");
    expect(stockStatus(0.0001, 5)).toBe("OUT_OF_STOCK");
  });

  it("never falsely marks min=0 items with positive unreserved stock as LOW", () => {
    expect(stockStatus(1, 0)).toBe("GOOD");
    expect(stockStatus(12, 0)).toBe("GOOD");
  });

  it("accounts for reserved commitments when deriving LOW and OVERSTOCK", () => {
    // 10 physical, 6 reserved => 4 free <= min 5 => LOW
    expect(stockStatus(10, 5, 20, { reserved: 6 })).toBe("LOW");
    // 10 physical, 10 reserved, min 0 => 0 free => LOW (fully allocated!)
    expect(stockStatus(10, 0, null, { reserved: 10 })).toBe("LOW");
    // 25 physical, 10 reserved, max 20 => 15 free <= max 20 => GOOD (not false OVERSTOCK!)
    expect(stockStatus(25, 5, 20, { reserved: 10 })).toBe("GOOD");
    // 35 physical, 10 reserved, max 20 => 25 free > max 20 => OVERSTOCK
    expect(stockStatus(35, 5, 20, { reserved: 10 })).toBe("OVERSTOCK");
  });

  it("subtracts open purchase orders and reserved commitments in reorderQty", () => {
    // 2 on hand, min 10, max 20, 18 already on open PO => projected 20 => 0 needed (no double-ordering!)
    expect(reorderQty({ current: 2, min: 10, max: 20, onOrder: 18 })).toBe(0);
    // 2 on hand, min 10, max 20, 10 on open PO => projected 12 => order 8 more
    expect(reorderQty({ current: 2, min: 10, max: 20, onOrder: 10 })).toBe(8);
    // 10 on hand, 8 reserved, min 5, max 20 => effective 2 => order 18
    expect(reorderQty({ current: 10, min: 5, max: 20, reserved: 8 })).toBe(18);
    // Fixed reorderQty suppressed when open PO already covers above min
    expect(reorderQty({ current: 2, min: 5, reorderQty: 24, onOrder: 10 })).toBe(0);
    // Fixed reorderQty still suggested when open PO doesn't clear min
    expect(reorderQty({ current: 2, min: 10, reorderQty: 24, onOrder: 5 })).toBe(24);
  });

  it("sorts restock urgency properly without NULL-first MySQL bias", () => {
    const list = [
      { status: "OUT_OF_STOCK" as const, currentStock: 0, minStock: 0, name: "One-off item (min 0)" },
      { status: "LOW" as const, currentStock: 4, minStock: 10, name: "Cable (40%)" },
      { status: "OUT_OF_STOCK" as const, currentStock: 0, minStock: 50, name: "Solar Panel (min 50)" },
      { status: "LOW" as const, currentStock: 1, minStock: 10, name: "Inverter (10%)" },
    ];
    list.sort(compareRestockUrgency);
    expect(list.map((x) => x.name)).toEqual([
      "Solar Panel (min 50)",
      "One-off item (min 0)",
      "Inverter (10%)",
      "Cable (40%)",
    ]);
  });
});
