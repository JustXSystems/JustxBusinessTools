import { describe, expect, it } from "vitest";
import { normalizeAccountType, validateRegisterPayload } from "./register-input.js";

describe("normalizeAccountType", () => {
  it("accepts individual", () => {
    expect(normalizeAccountType("individual")).toBe("individual");
    expect(normalizeAccountType("Individual")).toBe("individual");
  });

  it("defaults unknown values to business", () => {
    expect(normalizeAccountType("business")).toBe("business");
    expect(normalizeAccountType("")).toBe("business");
    expect(normalizeAccountType(null)).toBe("business");
    expect(normalizeAccountType("corp")).toBe("business");
  });
});

describe("validateRegisterPayload", () => {
  const base = {
    email: "Alex@Example.com",
    password: "secret123",
    name: "Alex Rao",
    phone: "9876543210",
  };

  it("validates individual registration without GSTIN", () => {
    const result = validateRegisterPayload({ ...base, accountType: "individual" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.accountType).toBe("individual");
    expect(result.data.email).toBe("alex@example.com");
    expect(result.data.name).toBe("Alex Rao");
    expect(result.data.gstin).toBe("");
    expect(result.data.phone).toBe("9876543210");
  });

  it("requires name for individual", () => {
    const result = validateRegisterPayload({
      accountType: "individual",
      email: "a@b.co",
      password: "secret123",
      name: "  ",
    });
    expect(result).toEqual({ ok: false, error: "Your name is required" });
  });

  it("requires GSTIN for business", () => {
    const result = validateRegisterPayload({ ...base, accountType: "business" });
    expect(result).toEqual({ ok: false, error: "A valid 15-character GSTIN is required" });
  });

  it("accepts business with valid GSTIN", () => {
    const result = validateRegisterPayload({
      ...base,
      accountType: "business",
      gstin: "29ABCDE1234F1Z5",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.gstin).toBe("29ABCDE1234F1Z5");
    expect(result.data.accountType).toBe("business");
  });

  it("rejects short passwords", () => {
    const result = validateRegisterPayload({
      accountType: "individual",
      email: "a@b.co",
      password: "short",
      name: "Alex",
    });
    expect(result).toEqual({ ok: false, error: "Email and password (min 8 chars) required" });
  });

  it("defaults missing accountType to business rules", () => {
    const result = validateRegisterPayload({
      email: "a@b.co",
      password: "secret123",
      name: "Alex",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/GSTIN/i);
  });
});
