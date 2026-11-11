import { describe, expect, it } from "vitest";
import { findMatchingParty, phoneKey } from "../match.js";
import { mergeKinds, toBosKind, toRegistryKind } from "../kinds.js";

describe("party match helpers", () => {
  it("normalizes Indian phone variants", () => {
    expect(phoneKey("+91 98765 43210")).toBe("9876543210");
    expect(phoneKey("09876543210")).toBe("9876543210");
    expect(phoneKey("919876543210")).toBe("9876543210");
  });

  it("matches GSTIN before phone/name", () => {
    const list = [
      { id: "a", name: "Acme", mobile: "9999999999", gstin: "29ABCDE1234F1Z5", active: 1 },
      { id: "b", name: "Acme", mobile: "9876543210", gstin: null, active: 1 },
    ];
    const hit = findMatchingParty(list, { name: "Other", phone: "9876543210", gstin: "29ABCDE1234F1Z5" });
    expect(hit?.id).toBe("a");
  });

  it("matches phone when GSTIN absent", () => {
    const list = [{ id: "b", name: "Beta", mobile: "9876543210", gstin: null, active: 1 }];
    expect(findMatchingParty(list, { name: "Beta Pvt", phone: "9876543210" })?.id).toBe("b");
  });
});

describe("party kinds", () => {
  it("maps BOS vendor ↔ registry supplier", () => {
    expect(toRegistryKind("vendor")).toBe("supplier");
    expect(toBosKind("supplier")).toBe("vendor");
  });

  it("merges customer + supplier into both", () => {
    expect(mergeKinds("customer", "supplier")).toBe("both");
    expect(mergeKinds("both", "supplier")).toBe("both");
  });
});
