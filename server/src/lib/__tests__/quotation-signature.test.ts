import { describe, expect, it } from "vitest";
import { signatureOf, signatureUpdateDecision } from "../quotation-signature.js";

const saved = signatureOf({ preparedBy: "Asha", preparedByPhone: "+91 90000 11111", preparedByEmail: "asha@x.in" });
const changed = { ...saved, preparedBy: "Ravi" };

function decide(overrides: Partial<Parameters<typeof signatureUpdateDecision>[0]>) {
  return signatureUpdateDecision({
    before: saved,
    after: changed,
    userId: 7,
    creatorUserId: 3,
    role: "staff",
    force: false,
    ...overrides,
  });
}

describe("signatureUpdateDecision", () => {
  it("ignores saves that keep the signature, including blank vs missing fields", () => {
    expect(decide({ after: signatureOf({ ...saved, preparedBy: " Asha " }) })).toBe("unchanged");
    expect(signatureOf({ preparedBy: "Asha" })).toEqual(
      signatureOf({ preparedBy: "Asha", preparedByPhone: "", preparedByEmail: undefined }),
    );
  });

  it("lets the creator change their own signature", () => {
    expect(decide({ userId: 3 })).toBe("allowed");
    expect(decide({ userId: 3, creatorUserId: "3" })).toBe("allowed");
  });

  it("locks other users, admins, and owners who did not ask to force", () => {
    expect(decide({})).toBe("locked");
    expect(decide({ role: "admin", force: true })).toBe("locked");
    expect(decide({ role: "owner" })).toBe("locked");
  });

  it("lets the Business Owner force an update explicitly", () => {
    expect(decide({ role: "owner", force: true })).toBe("forced");
  });

  it("locks quotations with no recorded creator except for a forced owner update", () => {
    expect(decide({ creatorUserId: undefined })).toBe("locked");
    expect(decide({ creatorUserId: undefined, role: "owner", force: true })).toBe("forced");
  });

  it("never locks single-user installs without a signed-in user", () => {
    expect(decide({ userId: null })).toBe("allowed");
  });
});
