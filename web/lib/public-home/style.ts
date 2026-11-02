import type { CSSProperties } from "react";
import { publicAssetUrl } from "@/lib/base-path";
import type { MediaRef, PublicHomeTheme, SectionStyle } from "./types";

export function resolveMediaUrl(url: string): string {
  return publicAssetUrl(String(url || "").trim());
}

export function sectionCssVars(style: SectionStyle): CSSProperties {
  const vars: Record<string, string> = {};
  if (style.textColor) vars["--ph-section-text"] = style.textColor;
  if (style.mutedColor) vars["--ph-section-muted"] = style.mutedColor;
  if (style.accentColor) vars["--ph-section-accent"] = style.accentColor;
  if (style.fontFamily) vars["--ph-section-font"] = style.fontFamily;
  if (style.fontSize) vars["--ph-section-size"] = style.fontSize;
  if (style.fontWeight) vars["--ph-section-weight"] = style.fontWeight;
  return vars as CSSProperties;
}

export function sectionInlineStyle(style: SectionStyle): CSSProperties {
  const css: CSSProperties = {
    ...sectionCssVars(style),
    textAlign: style.textAlign || undefined,
    paddingTop: style.paddingY || undefined,
    paddingBottom: style.paddingY || undefined,
    paddingLeft: style.paddingX || undefined,
    paddingRight: style.paddingX || undefined,
    minHeight: style.minHeight || undefined,
    fontFamily: style.fontFamily || undefined,
    fontSize: style.fontSize || undefined,
    fontWeight: (style.fontWeight as CSSProperties["fontWeight"]) || undefined,
    color: style.textColor || undefined,
    position: "relative",
  };

  if (style.backgroundType === "color" && style.backgroundValue) {
    css.background = style.backgroundValue;
  } else if (style.backgroundType === "gradient" && style.backgroundValue) {
    css.background = style.backgroundValue;
  } else if (
    (style.backgroundType === "image" || style.backgroundType === "video") &&
    style.backgroundValue
  ) {
    css.backgroundImage = `url(${JSON.stringify(resolveMediaUrl(style.backgroundValue)).slice(1, -1)})`;
    css.backgroundSize = "cover";
    css.backgroundPosition = "center";
  }

  return css;
}

export function themeCssVars(theme: PublicHomeTheme): CSSProperties {
  return {
    ["--ph-bg0" as string]: theme.bg0,
    ["--ph-bg1" as string]: theme.bg1,
    ["--ph-accent" as string]: theme.accent,
    ["--ph-accent-strong" as string]: theme.accentStrong,
    ["--ph-text" as string]: theme.textHi,
    ["--ph-muted" as string]: theme.textMid,
    ["--ph-font-sans" as string]: theme.fontSans,
    ["--ph-font-display" as string]: theme.fontDisplay,
    ["--ph-radius" as string]: theme.radius,
    colorScheme: theme.colorScheme,
  } as CSSProperties;
}

export function hasRenderableMedia(media?: MediaRef | null): boolean {
  return Boolean(media && media.kind !== "none" && media.url);
}
