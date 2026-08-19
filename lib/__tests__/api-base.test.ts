import { describe, expect, it } from "vitest";
import { apiUrl, getApiBase } from "@/lib/api-base";

describe("apiUrl", () => {
  it("uses relative path when base unset", () => {
    expect(getApiBase()).toBe("");
    expect(apiUrl("/api/profile")).toBe("/api/profile");
  });
});
