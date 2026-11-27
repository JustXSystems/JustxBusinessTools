"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useToolIconConfig } from "@/components/config/ConfigProvider";
import {
  isImageIcon,
  resolveIconAssetUrl,
  resolveToolIconSize,
  resolveToolIconSource,
  toolIconTileStyle,
  type ToolIconConfig,
  type ToolIconSizeHint,
} from "@/lib/tool-icons";

function readColorMode(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  const root = document.documentElement;
  const bosTheme = root.getAttribute("data-bos-theme") || document.querySelector(".bos[data-bos-theme]")?.getAttribute("data-bos-theme");
  const appTheme = root.getAttribute("data-theme");
  if (bosTheme === "dark" || appTheme === "dark" || root.classList.contains("dark")) return "dark";
  if (bosTheme === "light" || appTheme === "light") return "light";
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

/** Tracks active light/dark mode across JBT and BOS/IMS skins. */
export function useActiveColorMode(): "light" | "dark" {
  const [mode, setMode] = useState<"light" | "dark">("light");

  useEffect(() => {
    const sync = () => setMode(readColorMode());
    sync();

    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-bos-theme", "class"],
    });
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    mq?.addEventListener?.("change", sync);
    return () => {
      observer.disconnect();
      mq?.removeEventListener?.("change", sync);
    };
  }, []);

  return mode;
}

/**
 * Renders a tool's configured icon (light/dark-aware, image or emoji) with
 * optional admin-configured tile background, shape, and padding.
 */
export function ToolIconMark({
  toolId,
  fallback,
  size = 40,
  sizeHint = "md",
  className,
  style,
  override,
  themeOverride,
}: {
  toolId: string;
  fallback: string;
  size?: number;
  sizeHint?: ToolIconSizeHint;
  className?: string;
  style?: CSSProperties;
  override?: ToolIconConfig | null;
  themeOverride?: "light" | "dark";
}) {
  const configured = useToolIconConfig(toolId);
  const detectedTheme = useActiveColorMode();
  const cfg = override !== undefined ? override : configured;
  const theme = themeOverride ?? detectedTheme;
  const raw = resolveToolIconSource(cfg, fallback, { theme, size: sizeHint });
  const tileStyle = toolIconTileStyle(cfg);
  const effectiveSize = resolveToolIconSize(size, cfg, sizeHint);

  if (isImageIcon(raw)) {
    const src = resolveIconAssetUrl(raw);
    return (
      // eslint-disable-next-line @next/next/no-img-element -- static public or signed uploaded tool icon
      <img
        className={className}
        src={src}
        alt=""
        width={effectiveSize}
        height={effectiveSize}
        style={{
          width: effectiveSize,
          height: effectiveSize,
          objectFit: "contain",
          boxSizing: "border-box",
          ...tileStyle,
          ...style,
        }}
      />
    );
  }

  if (tileStyle) {
    return (
      <span
        className={className}
        style={{
          display: "inline-grid",
          placeItems: "center",
          width: effectiveSize,
          height: effectiveSize,
          fontSize: Math.round(effectiveSize * 0.6),
          lineHeight: 1,
          boxSizing: "border-box",
          ...tileStyle,
          ...style,
        }}
        aria-hidden
      >
        {raw}
      </span>
    );
  }

  if (className || style) {
    return (
      <span
        className={className}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          lineHeight: 1,
          ...style,
        }}
        aria-hidden
      >
        {raw}
      </span>
    );
  }

  return <>{raw}</>;
}

/**
 * Dynamically updates browser `<link rel="icon">` and `<link rel="apple-touch-icon">`
 * while a tool route (e.g. `/ims` or `/tools/<id>`) is mounted, restoring the
 * previous favicon on unmount.
 */
export function useDynamicToolFavicon(toolId: string, fallbackFavicon?: string): void {
  const cfg = useToolIconConfig(toolId);
  const theme = useActiveColorMode();

  useEffect(() => {
    if (typeof document === "undefined") return;
    const rawFav = resolveToolIconSource(cfg, fallbackFavicon ?? "", { theme, size: "favicon" });
    const rawApple = resolveToolIconSource(cfg, "", { theme, size: "apple" });
    const favUrl = isImageIcon(rawFav) ? resolveIconAssetUrl(rawFav) : "";
    const appleUrl = isImageIcon(rawApple) ? resolveIconAssetUrl(rawApple) : "";
    if (!favUrl && !appleUrl) return;

    const created: HTMLLinkElement[] = [];
    const prev: Array<{ el: HTMLLinkElement; href: string }> = [];

    if (favUrl) {
      const existing = Array.from(
        document.head.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="shortcut icon"]'),
      );
      if (existing.length) {
        for (const el of existing) {
          prev.push({ el, href: el.href });
          el.href = favUrl;
        }
      } else {
        const link = document.createElement("link");
        link.rel = "icon";
        link.href = favUrl;
        document.head.appendChild(link);
        created.push(link);
      }
    }

    if (appleUrl) {
      const existing = document.head.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
      if (existing) {
        prev.push({ el: existing, href: existing.href });
        existing.href = appleUrl;
      } else {
        const link = document.createElement("link");
        link.rel = "apple-touch-icon";
        link.href = appleUrl;
        document.head.appendChild(link);
        created.push(link);
      }
    }

    return () => {
      for (const { el, href } of prev) el.href = href;
      for (const el of created) el.remove();
    };
  }, [cfg, theme, fallbackFavicon]);
}
