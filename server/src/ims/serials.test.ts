import { describe, expect, it } from "vitest";
import { groupSerializedImportRows, movingWeightedAvgCost, productGroupKey } from "./serials.js";

describe("IMS serialized inventory & weighted-average cost", () => {
  it("computes moving weighted-average purchase price accurately", () => {
    // 10 units @ ₹100 + 10 units @ ₹120 = 20 units @ ₹110
    expect(movingWeightedAvgCost(10, 100, 10, 120)).toBe(110);
    // 2 units @ ₹100 + 1 unit @ ₹130 = 3 units @ ₹110
    expect(movingWeightedAvgCost(2, 100, 1, 130)).toBe(110);
    // Zero existing stock adopts incoming unit cost directly
    expect(movingWeightedAvgCost(0, 50, 5, 180)).toBe(180);
    // Missing/zero incoming cost preserves existing cost
    expect(movingWeightedAvgCost(10, 100, 5, null)).toBe(100);
    expect(movingWeightedAvgCost(10, 100, 5, 0)).toBe(100);
  });

  it("normalizes product group keys across case and extra whitespace", () => {
    expect(productGroupKey({ name: "  Hikvision  2MP Dome ", category: "CCTV", brand: "Hikvision" })).toBe(
      productGroupKey({ name: "hikvision 2mp dome", category: " cctv ", brand: "HIKVISION" }),
    );
  });

  it("groups 1-row-per-unit Excel rows into products with unique scan codes and weighted avg cost", () => {
    const { groups, errors } = groupSerializedImportRows([
      { name: "Hikvision 2MP Dome", category: "CCTV", brand: "Hikvision", barcode: "SN-001", purchasePrice: 1200, sellingPrice: 1800 },
      { name: "Hikvision 2MP Dome", category: "CCTV", brand: "Hikvision", barcode: "SN-002", purchasePrice: 1200, sellingPrice: 1800 },
      { name: "Hikvision 2MP Dome", category: "CCTV", brand: "Hikvision", barcode: "SN-003", purchasePrice: 1500, sellingPrice: 1800 },
      { name: "CP Plus 4CH DVR", category: "CCTV", brand: "CP Plus", serialNo: "DVR-101", sku: "CP-4CH", purchasePrice: 3200, sellingPrice: 4500 },
    ]);

    expect(errors).toEqual([]);
    expect(groups).toHaveLength(2);

    const dome = groups[0];
    expect(dome.name).toBe("Hikvision 2MP Dome");
    expect(dome.units).toHaveLength(3);
    expect(dome.units.map((u) => u.serialNo)).toEqual(["SN-001", "SN-002", "SN-003"]);
    // (1200 + 1200 + 1500) / 3 = 1300
    expect(dome.purchasePrice).toBe(1300);
    expect(dome.sellingPrice).toBe(1800);
    expect(dome.sku).toBeNull();

    const dvr = groups[1];
    expect(dvr.name).toBe("CP Plus 4CH DVR");
    expect(dvr.sku).toBe("CP-4CH");
    expect(dvr.units).toHaveLength(1);
    expect(dvr.units[0].serialNo).toBe("DVR-101");
  });

  it("rejects duplicate scan codes and missing scan codes within the same upload", () => {
    const { groups, errors } = groupSerializedImportRows([
      { name: "Camera A", category: "CCTV", brand: "Hikvision", barcode: "DUP-1", purchasePrice: 1000 },
      { name: "Camera B", category: "CCTV", brand: "Dahua", barcode: "dup-1", purchasePrice: 1100 },
      { name: "Camera C", category: "CCTV", brand: "Dahua", purchasePrice: 1100 },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("Camera A");
    expect(groups[0].units).toHaveLength(1);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/Duplicate scan code "dup-1"/);
    expect(errors[1]).toMatch(/Scan code \/ serial number is required/);
  });
});
