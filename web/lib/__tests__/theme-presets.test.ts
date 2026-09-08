import { describe, expect, it } from "vitest";
import {
  findThemePresetTokens,
  normalizeThemePreset,
  parseSavedThemeId,
  savedThemePresetKey,
  THEME_PRESETS,
} from "../theme-presets";

describe("theme presets", () => {
  it("treats empty/default as organization inherit", () => {
    expect(normalizeThemePreset(null)).toBeNull();
    expect(normalizeThemePreset("")).toBeNull();
    expect(normalizeThemePreset("default")).toBeNull();
    expect(normalizeThemePreset("__org_default__")).toBeNull();
    expect(normalizeThemePreset("JustXSystems Electric")).toBe("JustXSystems Electric");
  });

  it("resolves built-in preset tokens", () => {
    expect(THEME_PRESETS.length).toBeGreaterThan(3);
    const tokens = findThemePresetTokens("JustX BOS (Light)");
    expect(tokens?.scheme).toBe("light");
    expect(tokens?.pack).toBe("bos");
  });

  it("parses saved org theme keys", () => {
    expect(parseSavedThemeId("saved:42")).toBe(42);
    expect(parseSavedThemeId("JustXSystems Electric")).toBeNull();
    expect(savedThemePresetKey(7)).toBe("saved:7");
  });
});
