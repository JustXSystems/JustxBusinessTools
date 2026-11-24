import { describe, expect, it } from "vitest";
import { normalizeAccountType, validateRegisterForm } from "./register-form";

describe("normalizeAccountType", () => {
  it("maps individual and defaults to business", () => {
    expect(normalizeAccountType("individual")).toBe("individual");
    expect(normalizeAccountType("BUSINESS")).toBe("business");
    expect(normalizeAccountType(undefined)).toBe("business");
  });
});

describe("validateRegisterForm", () => {
  const individual = {
    accountType: "individual" as const,
    name: "Alex Rao",
    phone: "9876543210",
    email: "alex@example.com",
    password: "secret123",
    gstin: "",
    businessName: "",
    joiningExisting: false,
    homeToolIds: [],
  };

  it("accepts basic individual details", () => {
    expect(validateRegisterForm(individual)).toEqual({ ok: true });
  });

  it("requires name for individual", () => {
    expect(validateRegisterForm({ ...individual, name: "" })).toEqual({
      ok: false,
      error: "Your name is required",
    });
  });

  it("requires name for business", () => {
    expect(
      validateRegisterForm({
        ...individual,
        accountType: "business",
        name: "  ",
        gstin: "29ABCDE1234F1Z5",
        businessName: "Acme",
        homeToolIds: ["gstcalc"],
      }),
    ).toEqual({ ok: false, error: "Your name is required" });
  });

  it("trims password before length check", () => {
    expect(validateRegisterForm({ ...individual, password: "  secret123  " })).toEqual({ ok: true });
  });

  it("requires GSTIN only for business", () => {
    expect(
      validateRegisterForm({
        ...individual,
        accountType: "business",
        homeToolIds: ["gstcalc"],
      }),
    ).toEqual({ ok: false, error: "Enter a valid 15-character GSTIN" });
  });

  it("accepts business create with GSTIN, name, and tools", () => {
    expect(
      validateRegisterForm({
        ...individual,
        accountType: "business",
        gstin: "29ABCDE1234F1Z5",
        businessName: "Acme Solar",
        homeToolIds: ["gstcalc"],
      }),
    ).toEqual({ ok: true });
  });

  it("allows joining existing without business name or tools", () => {
    expect(
      validateRegisterForm({
        ...individual,
        accountType: "business",
        gstin: "29ABCDE1234F1Z5",
        joiningExisting: true,
        businessName: "",
        homeToolIds: [],
      }),
    ).toEqual({ ok: true });
  });
});
