"use client";

import "./styles/bos.tokens.css";
import "./styles/bos.components.css";
import "./styles/bos.patterns.css";
import "./styles/bos.skin-ims.css";

import { useCallback, useMemo, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import type { BosSkin, BosTheme } from "./tokens";
import { BosThemeContext, type BosThemeContextValue } from "./theme-context";
import { ToastProvider } from "./overlays/Toast";
import { cx } from "./cx";
import { readStoredBosTheme, resolveBosSkin, resolveInitialBosTheme, writeStoredBosTheme } from "@/lib/bos/theme";

function initialTheme(fallback?: BosTheme): BosTheme {
  if (typeof document === "undefined") return fallback ?? "light";
  const root = document.documentElement;
  return resolveInitialBosTheme({
    stored: readStoredBosTheme() ?? fallback ?? null,
    hostScheme: root.dataset.scheme ?? null,
    hostPack: root.dataset.pack ?? null,
  });
}

function subscribeHostPack(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-pack"] });
  return () => observer.disconnect();
}

/** The org's JBT design pack (`<html data-pack>`), live as admins switch presets. */
function useHostPack(): string | null {
  return useSyncExternalStore(
    subscribeHostPack,
    () => document.documentElement.dataset.pack ?? null,
    () => null,
  );
}

export type BosRootProps = {
  children: ReactNode;
  /** Controlled theme. When omitted, BosRoot owns and persists the theme. */
  theme?: BosTheme;
  onThemeChange?: (theme: BosTheme) => void;
  /** Theme to use when nothing is persisted (uncontrolled mode). */
  defaultTheme?: BosTheme;
  /**
   * Visual skin. When omitted the kit follows the org's design pack
   * (`ims` pack → IMS skin, anything else → BOS skin).
   */
  skin?: BosSkin;
  /** Paint the BOS canvas background (full-page surfaces). */
  canvas?: boolean;
  className?: string;
  style?: CSSProperties;
};

/**
 * Opt-in boundary for the Justx BOS design system. Everything inside gets the
 * BOS tokens + classes; nothing outside is affected.
 */
export function BosRoot({
  children,
  theme: controlled,
  onThemeChange,
  defaultTheme,
  skin: explicitSkin,
  canvas = false,
  className,
  style,
}: BosRootProps) {
  const [owned, setOwned] = useState<BosTheme>(() => initialTheme(defaultTheme));
  const theme = controlled ?? owned;
  const hostPack = useHostPack();
  const skin = resolveBosSkin({ explicit: explicitSkin, hostPack });

  const setTheme = useCallback(
    (next: BosTheme) => {
      if (controlled === undefined) {
        setOwned(next);
        writeStoredBosTheme(next);
      }
      onThemeChange?.(next);
    },
    [controlled, onThemeChange],
  );

  const value = useMemo<BosThemeContextValue>(
    () => ({ theme, setTheme, toggleTheme: () => setTheme(theme === "dark" ? "light" : "dark"), skin }),
    [theme, setTheme, skin],
  );

  return (
    <BosThemeContext.Provider value={value}>
      <div
        className={cx("bos", canvas && "bos-canvas", className)}
        data-bos-theme={theme}
        data-bos-skin={skin === "bos" ? undefined : skin}
        style={style}
      >
        <ToastProvider>{children}</ToastProvider>
      </div>
    </BosThemeContext.Provider>
  );
}
