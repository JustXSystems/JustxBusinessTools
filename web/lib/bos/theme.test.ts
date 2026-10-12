import { describe, expect, it } from "vitest";
import { isBosTheme, resolveBosSkin, resolveInitialBosTheme } from "./theme";

describe("resolveInitialBosTheme", () => {
  it("prefers the stored user choice", () => {
    expect(resolveInitialBosTheme({ stored: "dark", hostPack: "bos", hostScheme: "light" })).toBe("dark");
  });

  it("follows the host scheme only when a kit pack (BOS or IMS) is active", () => {
    expect(resolveInitialBosTheme({ hostPack: "bos", hostScheme: "dark" })).toBe("dark");
    expect(resolveInitialBosTheme({ hostPack: "ims", hostScheme: "dark" })).toBe("dark");
    expect(resolveInitialBosTheme({ hostPack: "classic", hostScheme: "dark" })).toBe("light");
  });

  it("ignores garbage values and defaults to light", () => {
    expect(resolveInitialBosTheme({ stored: "purple", hostScheme: "neon" })).toBe("light");
    expect(resolveInitialBosTheme({})).toBe("light");
  });

  it("guards theme values", () => {
    expect(isBosTheme("light")).toBe(true);
    expect(isBosTheme("Dark")).toBe(false);
    expect(isBosTheme(null)).toBe(false);
  });
});

describe("resolveBosSkin", () => {
  it("honours an explicit skin over the host pack", () => {
    expect(resolveBosSkin({ explicit: "ims", hostPack: "bos" })).toBe("ims");
    expect(resolveBosSkin({ explicit: "bos", hostPack: "ims" })).toBe("bos");
  });

  it("follows the IMS pack, otherwise stays on the BOS skin", () => {
    expect(resolveBosSkin({ hostPack: "ims" })).toBe("ims");
    expect(resolveBosSkin({ hostPack: "bos" })).toBe("bos");
    expect(resolveBosSkin({ hostPack: null })).toBe("bos");
    expect(resolveBosSkin({})).toBe("bos");
  });
});
