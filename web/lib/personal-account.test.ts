import { describe, expect, it } from "vitest";
import {
  activeBranchGstin,
  hasValidGstin,
  isPersonalAccount,
} from "@/lib/personal-account";
import type { SessionUser } from "@/lib/types/auth";

function user(partial: Partial<SessionUser> & { branches?: SessionUser["branches"] }): SessionUser {
  return {
    id: 1,
    email: "a@b.c",
    name: "A",
    role: "owner",
    organizationId: 1,
    organizationName: "Org",
    businessProfileId: 1,
    branches: [],
    ...partial,
  };
}

describe("personal account detection", () => {
  it("accepts a valid GSTIN", () => {
    expect(hasValidGstin("29ABCDE1234F1Z5")).toBe(true);
    expect(hasValidGstin("")).toBe(false);
    expect(hasValidGstin(null)).toBe(false);
  });

  it("treats active branch without GSTIN as personal", () => {
    const u = user({
      branches: [{ id: 1, businessName: "Me", gstin: null, isDefault: true }],
    });
    expect(isPersonalAccount(u)).toBe(true);
    expect(activeBranchGstin(u)).toBeNull();
  });

  it("treats active branch with GSTIN as business", () => {
    const u = user({
      branches: [{ id: 1, businessName: "Co", gstin: "29ABCDE1234F1Z5", isDefault: true }],
    });
    expect(isPersonalAccount(u)).toBe(false);
    expect(isPersonalAccount(u, "")).toBe(false);
  });

  it("profile GSTIN overrides empty branch GSTIN", () => {
    const u = user({
      branches: [{ id: 1, businessName: "Co", gstin: null, isDefault: true }],
    });
    expect(isPersonalAccount(u, "29ABCDE1234F1Z5")).toBe(false);
  });

  it("does not assume personal when branches are missing", () => {
    expect(isPersonalAccount(user({ branches: [] }))).toBe(false);
    expect(isPersonalAccount(null)).toBe(false);
  });
});
