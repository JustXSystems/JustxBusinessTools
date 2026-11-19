import { describe, expect, it } from "vitest";
import { coveragePct, snapshotFromStored } from "./types.js";
import { imsCapabilityAdapter } from "./ims-adapter.js";
import { getCapabilityAdapter, hasCapabilityCeiling } from "./registry.js";

describe("coveragePct", () => {
  const catalog = [
    { key: "dashboard", label: "Dashboard", section: "Inventory", required: true },
    { key: "sales", label: "Sales", section: "Sales" },
    { key: "stock", label: "Stock", section: "Inventory" },
  ];
  const alwaysOn = ["dashboard"];

  it("returns 100 when unrestricted", () => {
    expect(coveragePct(true, ["dashboard"], catalog, alwaysOn)).toBe(100);
  });

  it("scores optional modules only", () => {
    expect(coveragePct(false, ["dashboard", "sales"], catalog, alwaysOn)).toBe(50);
    expect(coveragePct(false, ["dashboard", "sales", "stock"], catalog, alwaysOn)).toBe(100);
  });
});

describe("snapshotFromStored", () => {
  it("treats null as unrestricted with full catalog", () => {
    const snap = snapshotFromStored(imsCapabilityAdapter, null);
    expect(snap.unrestricted).toBe(true);
    expect(snap.hasCeiling).toBe(true);
    expect(snap.enabled).toEqual(imsCapabilityAdapter.catalog.map((m) => m.key));
  });

  it("keeps curated enabled list", () => {
    const snap = snapshotFromStored(imsCapabilityAdapter, ["dashboard", "sales", "settings", "more", "helpdesk"]);
    expect(snap.unrestricted).toBe(false);
    expect(snap.enabled).toContain("sales");
  });
});

describe("registry", () => {
  it("registers IMS ceiling adapter", () => {
    expect(hasCapabilityCeiling("imsdealer")).toBe(true);
    expect(getCapabilityAdapter("imsdealer")?.toolId).toBe("imsdealer");
    expect(hasCapabilityCeiling("quotation")).toBe(false);
  });
});
