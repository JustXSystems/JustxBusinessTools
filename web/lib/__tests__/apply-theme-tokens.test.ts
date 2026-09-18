/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { applyThemeTokens, JUSTX_BOS_LIGHT, JUSTX_ELECTRIC } from "@/lib/theme";

describe("applyThemeTokens", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("style");
    document.documentElement.removeAttribute("data-scheme");
    document.documentElement.removeAttribute("data-pack");
    document.body.removeAttribute("style");
  });

  afterEach(() => {
    document.documentElement.removeAttribute("style");
    document.documentElement.removeAttribute("data-scheme");
    document.documentElement.removeAttribute("data-pack");
    document.body.removeAttribute("style");
  });

  it("applies color, radius, font, pack, and surface aliases", () => {
    applyThemeTokens(JUSTX_BOS_LIGHT);
    const root = document.documentElement;
    expect(root.dataset.scheme).toBe("light");
    expect(root.dataset.pack).toBe("bos");
    expect(root.style.getPropertyValue("--accent").trim()).toBe(JUSTX_BOS_LIGHT.accent);
    expect(root.style.getPropertyValue("--bg-0").trim()).toBe(JUSTX_BOS_LIGHT.bg0);
    expect(root.style.getPropertyValue("--radius").trim()).toBe(JUSTX_BOS_LIGHT.radius);
    expect(root.style.getPropertyValue("--font-sans").trim()).toBe(JUSTX_BOS_LIGHT.font);
    expect(root.style.getPropertyValue("--panel").trim()).toBe(JUSTX_BOS_LIGHT.bg1);
    expect(root.style.getPropertyValue("--panel-elevated").trim()).toBe(JUSTX_BOS_LIGHT.bg2);
    expect(root.style.getPropertyValue("--glass-1")).toBeTruthy();
    expect(root.style.getPropertyValue("--text-hi")).toBeTruthy();
    expect(root.style.colorScheme).toBe("light");
  });

  it("defaults pack to default for electric dark", () => {
    applyThemeTokens(JUSTX_ELECTRIC);
    expect(document.documentElement.dataset.pack).toBe("default");
    expect(document.documentElement.dataset.scheme).toBe("dark");
  });
});
