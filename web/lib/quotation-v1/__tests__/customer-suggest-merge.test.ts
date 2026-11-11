import { describe, expect, it } from "vitest";
import { mergeCustomerSuggestions, type SuggestedCustomer } from "../customer-suggest";

const base = (over: Partial<SuggestedCustomer>): SuggestedCustomer => ({
  key: "k",
  sourceQuoteId: "",
  name: "Acme",
  company: "",
  address: "",
  city: "",
  state: "Karnataka",
  gstin: "",
  phone: "9876543210",
  email: "",
  ...over,
});

describe("mergeCustomerSuggestions", () => {
  it("prefers registry hits and collapses phone duplicates", () => {
    const registry = [base({ key: "reg", partyId: "p1", name: "Acme Industries", company: "Acme" })];
    const quotes = [base({ key: "q", sourceQuoteId: "q1", name: "Acme" })];
    const merged = mergeCustomerSuggestions(registry, quotes);
    expect(merged).toHaveLength(1);
    expect(merged[0].partyId).toBe("p1");
    expect(merged[0].company).toBe("Acme");
  });

  it("keeps quote-only customers when registry has no match", () => {
    const merged = mergeCustomerSuggestions(
      [base({ key: "reg", partyId: "p1", phone: "1111111111", name: "Alpha" })],
      [base({ key: "q", sourceQuoteId: "q1", phone: "2222222222", name: "Beta" })],
    );
    expect(merged.map((s) => s.name)).toEqual(["Alpha", "Beta"]);
  });
});
