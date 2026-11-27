import { describe, expect, it } from "vitest";
import {
  BUILTIN_TOOL_ICON_DEFAULTS,
  isImageIcon,
  normalizeToolIconsMap,
  resolveToolIconSize,
  resolveToolIconSource,
  toolIconTileStyle,
  type ToolIconConfig,
} from "@/lib/tool-icons";

describe("tool-icons", () => {
  const cfg: ToolIconConfig = {
    light: "/icons/IMS/justx-invoice-icon.svg",
    dark: "/icons/IMS/justx-invoice-icon-dark.svg",
    favicon: "/icons/IMS/favicon.ico",
    appleTouch: "/icons/IMS/justx-invoice-icon-512.png",
    size192: "/icons/IMS/justx-invoice-icon-192.png",
    size512: "/icons/IMS/justx-invoice-icon-512.png",
    size1024: "/icons/IMS/justx-invoice-icon-1024.png",
    bg: "#091758",
    shape: "circle",
    paddingPx: 4,
  };

  it("picks light vs dark mode icons properly", () => {
    expect(resolveToolIconSource(cfg, "📦", { theme: "light", size: "md" })).toBe(cfg.light);
    expect(resolveToolIconSource(cfg, "📦", { theme: "dark", size: "md" })).toBe(cfg.dark);
    expect(resolveToolIconSource({ light: cfg.light }, "📦", { theme: "dark", size: "md" })).toBe(cfg.light);
  });

  it("picks favicon, appleTouch, and xl size variants with fallbacks", () => {
    expect(resolveToolIconSource(cfg, "📦", { size: "favicon" })).toBe(cfg.favicon);
    expect(resolveToolIconSource(cfg, "📦", { size: "apple" })).toBe(cfg.appleTouch);
    expect(resolveToolIconSource(cfg, "📦", { size: "xl" })).toBe(cfg.size1024);
    expect(resolveToolIconSource(undefined, "📦", { size: "md" })).toBe("📦");
  });

  it("provides built-in light/dark defaults for BOS and IMS", () => {
    expect(resolveToolIconSource(BUILTIN_TOOL_ICON_DEFAULTS.bos, "🏢", { theme: "light" })).toBe(
      "/icons/BOS/svg/bos-app-light.svg",
    );
    expect(resolveToolIconSource(BUILTIN_TOOL_ICON_DEFAULTS.bos, "🏢", { theme: "dark" })).toBe(
      "/icons/BOS/svg/bos-app-dark.svg",
    );
    expect(resolveToolIconSource(BUILTIN_TOOL_ICON_DEFAULTS.bos, "🏢", { size: "favicon" })).toBe(
      "/icons/BOS/web/bos-favicon.svg",
    );
    expect(resolveToolIconSource(BUILTIN_TOOL_ICON_DEFAULTS.imsdealer, "📦", { size: "favicon" })).toBe(
      "/icons/IMS/favicon.ico",
    );
  });

  it("computes tile styles from bg, shape, and padding", () => {
    expect(toolIconTileStyle(cfg)).toEqual({
      background: "#091758",
      borderRadius: "50%",
      padding: 4,
    });
    expect(toolIconTileStyle({ bg: "transparent" })).toBeUndefined();
  });

  it("computes per-surface scaled icon display sizes and clamps bounds", () => {
    expect(resolveToolIconSize(40, undefined, "md")).toBe(40);
    expect(resolveToolIconSize(40, { scaleMd: 125 }, "md")).toBe(50);
    expect(resolveToolIconSize(24, { scaleSm: 150, scaleMd: 125 }, "sm")).toBe(36);
    expect(resolveToolIconSize(64, { scaleLg: 75 }, "lg")).toBe(48);
    expect(resolveToolIconSize(16, { scaleSm: 150, scale: 150 }, "favicon")).toBe(16);
    expect(resolveToolIconSize(40, { scaleMd: 300 }, "md")).toBe(80);
    expect(resolveToolIconSize(40, { scaleMd: 10 }, "md")).toBe(20);
  });

  it("detects image icons vs emojis and normalizes map payloads", () => {
    expect(isImageIcon("/icons/IMS/justx-invoice-icon.svg")).toBe(true);
    expect(isImageIcon("https://cdn.example.com/icon.png")).toBe(true);
    expect(isImageIcon("data:image/png;base64,abc")).toBe(true);
    expect(isImageIcon("📦")).toBe(false);

    const normalized = normalizeToolIconsMap({
      imsdealer: {
        light: "  /icons/IMS/justx-invoice-icon.svg  ",
        shape: "rounded",
        paddingPx: 20,
      },
      empty: {},
    });
    expect(normalized).toEqual({
      imsdealer: {
        light: "/icons/IMS/justx-invoice-icon.svg",
        shape: "rounded",
        paddingPx: 12,
      },
    });
  });
});
