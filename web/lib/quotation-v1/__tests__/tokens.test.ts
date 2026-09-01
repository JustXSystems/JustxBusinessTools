import { describe, expect, it } from "vitest";
import { newApprovalToken, uid } from "../compute";

describe("quotation tokens", () => {
  it("approval tokens are long hex from CSPRNG", () => {
    const a = newApprovalToken();
    const b = newApprovalToken();
    expect(a).toMatch(/^[0-9a-f]{48}$/);
    expect(b).toMatch(/^[0-9a-f]{48}$/);
    expect(a).not.toBe(b);
  });

  it("uid is opaque hex", () => {
    expect(uid()).toMatch(/^[0-9a-f]{16}$/);
  });
});
