import { describe, expect, it } from "vitest";
import { isBosTheme, resolveInitialBosTheme } from "./theme";

describe("resolveInitialBosTheme", () => {
  it("prefers the stored user choice", () => {
    expect(resolveInitialBosTheme({ stored: "dark", hostPack: "bos", hostScheme: "light" })).toBe("dark");
  });

  it("follows the host scheme only when the BOS pack is active", () => {
    expect(resolveInitialBosTheme({ hostPack: "bos", hostScheme: "dark" })).toBe("dark");
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
