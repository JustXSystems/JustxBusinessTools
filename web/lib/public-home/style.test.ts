import { describe, expect, it } from "vitest";
import { hasRenderableMedia, sectionInlineStyle, themeCssVars } from "./style";
import { EMPTY_MEDIA, EMPTY_STYLE } from "./types";

describe("public-home style helpers", () => {
  it("detects renderable media", () => {
    expect(hasRenderableMedia(EMPTY_MEDIA)).toBe(false);
    expect(hasRenderableMedia({ ...EMPTY_MEDIA, kind: "image", url: "/x.png" })).toBe(true);
    expect(hasRenderableMedia({ ...EMPTY_MEDIA, kind: "none", url: "/x.png" })).toBe(false);
  });

  it("maps theme tokens to CSS variables", () => {
    const vars = themeCssVars({
      colorScheme: "dark",
      bg0: "#050b14",
      bg1: "#0a1628",
      accent: "#00dfff",
      accentStrong: "#1a6fd4",
      textHi: "#fff",
      textMid: "#ccc",
      fontSans: "Outfit",
      fontDisplay: "Space Grotesk",
      radius: "18px",
    }) as Record<string, string>;
    expect(vars["--ph-bg0"]).toBe("#050b14");
    expect(vars["--ph-accent"]).toBe("#00dfff");
    expect(vars["--ph-font-display"]).toBe("Space Grotesk");
  });

  it("applies gradient backgrounds without forcing a media url()", () => {
    const css = sectionInlineStyle({
      ...EMPTY_STYLE,
      backgroundType: "gradient",
      backgroundValue: "linear-gradient(red, blue)",
      textAlign: "center",
    });
    expect(css.background).toContain("linear-gradient");
    expect(css.textAlign).toBe("center");
  });
});
