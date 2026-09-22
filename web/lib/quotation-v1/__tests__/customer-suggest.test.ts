import { describe, expect, it } from "vitest";
import { newQuotationDraft } from "@/lib/quotation-v1";
import {
  CUSTOMER_SUGGEST_MIN_CHARS,
  customerFromSuggestion,
  matchCustomersByName,
  suggestCustomersFromQuotations,
  uniqueCustomersFromQuotations,
} from "@/lib/quotation-v1/customer-suggest";

function quoteWithCustomer(
  id: string,
  customer: Partial<ReturnType<typeof newQuotationDraft>["customer"]>,
  updatedAt: string,
) {
  const q = newQuotationDraft("solar", "epc");
  q.id = id;
  q.updatedAt = updatedAt;
  q.customer = { ...q.customer, ...customer };
  return q;
}

describe("quotation-v1 customer suggest", () => {
  it("dedupes by phone and keeps the newest fields", () => {
    const older = quoteWithCustomer(
      "a",
      { name: "Ravi", phone: "9876543210", city: "Mysuru", email: "old@ex.com" },
      "2024-01-01T00:00:00.000Z",
    );
    const newer = quoteWithCustomer(
      "b",
      { name: "Ravi Kumar", phone: "98765-43210", city: "Bengaluru", email: "new@ex.com" },
      "2025-06-01T00:00:00.000Z",
    );
    const unique = uniqueCustomersFromQuotations([older, newer]);
    expect(unique).toHaveLength(1);
    expect(unique[0].name).toBe("Ravi Kumar");
    expect(unique[0].city).toBe("Bengaluru");
    expect(unique[0].email).toBe("new@ex.com");
    expect(unique[0].sourceQuoteId).toBe("b");
  });

  it("dedupes 91-prefixed phone with 10-digit phone", () => {
    const a = quoteWithCustomer(
      "1",
      { name: "Asha", phone: "919876543210" },
      "2024-01-01T00:00:00.000Z",
    );
    const b = quoteWithCustomer(
      "2",
      { name: "Asha R", phone: "9876543210" },
      "2025-01-01T00:00:00.000Z",
    );
    expect(uniqueCustomersFromQuotations([a, b])).toHaveLength(1);
  });

  it("dedupes same customer name even when phones differ", () => {
    const a = quoteWithCustomer(
      "1",
      { name: "  ACME Power  ", phone: "9000000001" },
      "2024-01-01T00:00:00.000Z",
    );
    const b = quoteWithCustomer(
      "2",
      { name: "acme power", phone: "9000000099" },
      "2025-06-01T00:00:00.000Z",
    );
    const unique = uniqueCustomersFromQuotations([a, b]);
    expect(unique).toHaveLength(1);
    expect(unique[0].phone).toBe("9000000099");
  });

  it("dedupes by gstin across name variants", () => {
    const a = quoteWithCustomer(
      "1",
      { name: "Site A", phone: "", gstin: "29AAAAA0000A1Z5" },
      "2024-01-01T00:00:00.000Z",
    );
    const b = quoteWithCustomer(
      "2",
      { name: "Site B", phone: "", gstin: "29AAAAA0000A1Z5" },
      "2025-01-01T00:00:00.000Z",
    );
    expect(uniqueCustomersFromQuotations([a, b])).toHaveLength(1);
  });

  it("requires min chars before matching", () => {
    const list = [
      quoteWithCustomer("1", { name: "Acme Solar", phone: "9000000001" }, "2025-01-01T00:00:00.000Z"),
    ];
    expect(suggestCustomersFromQuotations(list, "Ac").length).toBe(0);
    expect(CUSTOMER_SUGGEST_MIN_CHARS).toBe(3);
    const hits = suggestCustomersFromQuotations(list, "Acm");
    expect(hits).toHaveLength(1);
    expect(hits[0].name).toBe("Acme Solar");
  });

  it("matches company name as well as site owner name", () => {
    const customers = uniqueCustomersFromQuotations([
      quoteWithCustomer(
        "1",
        { name: "Owner", company: "Zigma Power", phone: "9000000002" },
        "2025-01-01T00:00:00.000Z",
      ),
    ]);
    expect(matchCustomersByName(customers, "zig")).toHaveLength(1);
  });

  it("maps suggestion into QuoteCustomer fields", () => {
    const [s] = uniqueCustomersFromQuotations([
      quoteWithCustomer(
        "1",
        {
          name: "Site Owner",
          company: "Acme",
          address: "12 Road",
          city: "Hubli",
          state: "Karnataka",
          gstin: "29AAAAA0000A1Z5",
          phone: "9000000003",
          email: "a@ex.com",
        },
        "2025-01-01T00:00:00.000Z",
      ),
    ]);
    expect(customerFromSuggestion(s)).toEqual({
      name: "Site Owner",
      company: "Acme",
      address: "12 Road",
      city: "Hubli",
      state: "Karnataka",
      gstin: "29AAAAA0000A1Z5",
      phone: "9000000003",
      email: "a@ex.com",
    });
  });
});
