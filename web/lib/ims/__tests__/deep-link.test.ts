import { describe, expect, it } from "vitest";
import { applyIntentToSearchParams, bomDcLink, intentFromOpenField, intentFromUrlQuery } from "../deep-link";

describe("intentFromOpenField", () => {
  it("prefixes bare UUIDs with open:", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    expect(intentFromOpenField(id)).toBe(`open:${id}`);
  });

  it("preserves prefixed intents for returns and actions", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    expect(intentFromOpenField(`return:${id}`)).toBe(`return:${id}`);
    expect(intentFromOpenField("returns")).toBe("returns");
    expect(intentFromOpenField("new-return")).toBe("new-return");
    expect(intentFromOpenField(`new-return:${id}`)).toBe(`new-return:${id}`);
  });
});

describe("intentFromUrlQuery", () => {
  it("prefers intent over open", () => {
    expect(intentFromUrlQuery("abc", "returns")).toBe("returns");
  });

  it("maps open uuid and open return: prefix", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    expect(intentFromUrlQuery(id, null)).toBe(`open:${id}`);
    expect(intentFromUrlQuery(`return:${id}`, null)).toBe(`return:${id}`);
  });
});

describe("applyIntentToSearchParams", () => {
  it("writes open for classic entity opens and intent for richer links", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    const a = new URLSearchParams();
    applyIntentToSearchParams(a, `open:${id}`);
    expect(a.get("open")).toBe(id);
    expect(a.get("intent")).toBeNull();

    const b = new URLSearchParams();
    applyIntentToSearchParams(b, `return:${id}`);
    expect(b.get("intent")).toBe(`return:${id}`);
    expect(b.get("open")).toBeNull();
  });
});

describe("bomDcLink helpers", () => {
  it("builds stable deep-link intents", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    expect(bomDcLink.openDc(id)).toBe(`open:${id}`);
    expect(bomDcLink.openReturn(id)).toBe(`return:${id}`);
    expect(bomDcLink.createReturn(id)).toBe(`new-return:${id}`);
    expect(bomDcLink.returns()).toBe("returns");
  });
});
