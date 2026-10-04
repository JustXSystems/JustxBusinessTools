"use client";

import "./styles/bos.tokens.css";
import "./styles/bos.components.css";
import "./styles/bos.patterns.css";

import { useCallback, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { BosTheme } from "./tokens";
import { BosThemeContext, type BosThemeContextValue } from "./theme-context";
import { ToastProvider } from "./overlays/Toast";
import { cx } from "./cx";
import { readStoredBosTheme, resolveInitialBosTheme, writeStoredBosTheme } from "@/lib/bos/theme";

function initialTheme(fallback?: BosTheme): BosTheme {
  if (typeof document === "undefined") return fallback ?? "light";
  const root = document.documentElement;
  return resolveInitialBosTheme({
    stored: readStoredBosTheme() ?? fallback ?? null,
    hostScheme: root.dataset.scheme ?? null,
    hostPack: root.dataset.pack ?? null,
  });
}

export type BosRootProps = {
  children: ReactNode;
  /** Controlled theme. When omitted, BosRoot owns and persists the theme. */
  theme?: BosTheme;
  onThemeChange?: (theme: BosTheme) => void;
  /** Theme to use when nothing is persisted (uncontrolled mode). */
  defaultTheme?: BosTheme;
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
  canvas = false,
  className,
  style,
}: BosRootProps) {
  const [owned, setOwned] = useState<BosTheme>(() => initialTheme(defaultTheme));
  const theme = controlled ?? owned;

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
    () => ({ theme, setTheme, toggleTheme: () => setTheme(theme === "dark" ? "light" : "dark") }),
    [theme, setTheme],
  );

  return (
    <BosThemeContext.Provider value={value}>
      <div className={cx("bos", canvas && "bos-canvas", className)} data-bos-theme={theme} style={style}>
        <ToastProvider>{children}</ToastProvider>
      </div>
    </BosThemeContext.Provider>
  );
}
