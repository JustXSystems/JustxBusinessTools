"use client";

import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { BosSkin, BosTheme } from "./tokens";

export type BosThemeContextValue = {
  theme: BosTheme;
  setTheme: (theme: BosTheme) => void;
  toggleTheme: () => void;
  skin: BosSkin;
};

export const BosThemeContext = createContext<BosThemeContextValue | null>(null);

export function useBosTheme(): BosThemeContextValue {
  const ctx = useContext(BosThemeContext);
  if (!ctx) throw new Error("useBosTheme must be used inside <BosRoot>");
  return ctx;
}

/**
 * Renders overlays (dialogs, toasts, palettes) into document.body while keeping
 * the BOS scope + active theme, so fixed layers escape any clipping ancestors.
 */
export function BosPortal({ children }: { children: ReactNode }) {
  const { theme, skin } = useBosTheme();
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="bos" data-bos-theme={theme} data-bos-skin={skin === "bos" ? undefined : skin}>
      {children}
    </div>,
    document.body,
  );
}
