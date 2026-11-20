import { describe, expect, it } from "vitest";
import { isDcReturnBlocked, parseBomDcIntent } from "../bom-dc-intent";

describe("isDcReturnBlocked", () => {
  it("blocks when the server reports a live invoice link", () => {
    expect(isDcReturnBlocked({ id: "dc1", invoiceLinked: true }, { allowInvoiceLink: false, selectedDcIds: [] })).toBe(true);
    expect(isDcReturnBlocked({ id: "dc1", invoiceLinked: true }, { allowInvoiceLink: true, selectedDcIds: [] })).toBe(true);
  });

  it("blocks Builder pre-link selection even before invoiceLinked is set", () => {
    expect(isDcReturnBlocked({ id: "dc1", invoiceLinked: false }, { allowInvoiceLink: true, selectedDcIds: ["dc1"] })).toBe(true);
    expect(isDcReturnBlocked({ id: "dc1", invoiceLinked: false }, { allowInvoiceLink: true, selectedDcIds: ["other"] })).toBe(false);
  });

  it("allows return in standalone when not invoice-linked", () => {
    expect(isDcReturnBlocked({ id: "dc1", invoiceLinked: false }, { allowInvoiceLink: false, selectedDcIds: ["dc1"] })).toBe(false);
  });
});

describe("parseBomDcIntent", () => {
  it("opens the BOM picker for new", () => {
    expect(parseBomDcIntent("new")).toEqual({ mode: "pick-bom" });
  });

  it("creates against a specific BOM", () => {
    expect(parseBomDcIntent("new:abc-bom")).toEqual({
      mode: "workspace",
      bomId: "abc-bom",
      workspace: { kind: "create" },
    });
  });

  it("opens a DC by open: prefix or bare UUID", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    expect(parseBomDcIntent(`open:${id}`)).toEqual({
      mode: "workspace",
      bomId: "",
      workspace: { kind: "manage", dcId: id },
    });
    expect(parseBomDcIntent(id)).toEqual({
      mode: "workspace",
      bomId: "",
      workspace: { kind: "manage", dcId: id },
    });
  });

  it("opens the returns list or a single RTN document", () => {
    expect(parseBomDcIntent("returns")).toEqual({ mode: "list" });
    expect(parseBomDcIntent("return")).toEqual({ mode: "list" });
    const id = "550e8400-e29b-41d4-a716-446655440000";
    expect(parseBomDcIntent(`return:${id}`)).toEqual({ mode: "return", returnId: id });
    expect(parseBomDcIntent(`open-return:${id}`)).toEqual({ mode: "return", returnId: id });
  });

  it("starts create-return pick or against a DC", () => {
    expect(parseBomDcIntent("new-return")).toEqual({ mode: "pick-dc-return" });
    const id = "550e8400-e29b-41d4-a716-446655440000";
    expect(parseBomDcIntent(`new-return:${id}`)).toEqual({ mode: "create-return", dcId: id });
  });

  it("ignores empty / unknown intents", () => {
    expect(parseBomDcIntent(null)).toBeNull();
    expect(parseBomDcIntent("")).toBeNull();
    expect(parseBomDcIntent("new:")).toBeNull();
    expect(parseBomDcIntent("open:")).toBeNull();
    expect(parseBomDcIntent("garbage")).toBeNull();
  });
});
