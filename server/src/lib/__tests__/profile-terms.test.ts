import { describe, expect, it } from "vitest";
import { normalizeQuoteTerms, serializeQuoteTerms } from "../profile-terms.js";

describe("profile quote terms", () => {
  it("keeps known For keys with text and drops the rest", () => {
    expect(
      normalizeQuoteTerms({ amc: "AMC terms", sale: "  ", bogus: "x", epc: 5 }),
    ).toEqual({ amc: "AMC terms" });
  });

  it("parses JSON text and tolerates junk", () => {
    expect(normalizeQuoteTerms('{"srv":"Repair terms"}')).toEqual({ srv: "Repair terms" });
    expect(normalizeQuoteTerms("not json")).toEqual({});
    expect(normalizeQuoteTerms(null)).toEqual({});
    expect(normalizeQuoteTerms(["amc"])).toEqual({});
  });

  it("caps very long terms", () => {
    expect(normalizeQuoteTerms({ pm: "x".repeat(25_000) }).pm).toHaveLength(20_000);
  });

  it("serializes to null when nothing is customised", () => {
    expect(serializeQuoteTerms({ amc: "" })).toBeNull();
    expect(serializeQuoteTerms({ amc: "A" })).toBe('{"amc":"A"}');
  });
});
