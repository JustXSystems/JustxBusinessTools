import { describe, expect, it } from "vitest";
import { isValidGstin, normalizeGstin, panFromGstin } from "../gstin.js";

describe("gstin helpers", () => {
  it("normalizes case and whitespace", () => {
    expect(normalizeGstin(" 29abcde1234f1z5 ")).toBe("29ABCDE1234F1Z5");
  });

  it("validates GSTIN shape", () => {
    expect(isValidGstin("29ABCDE1234F1Z5")).toBe(true);
    expect(isValidGstin("29ABCDE1234F1Z")).toBe(false);
  });

  it("extracts PAN from GSTIN", () => {
    expect(panFromGstin("29ABCDE1234F1Z5")).toBe("ABCDE1234F");
  });
});
